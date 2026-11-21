"""Standalone sandbox API. It never constructs the operational application."""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter, ValidationError
from starlette.concurrency import run_in_threadpool

from app.playground.scenario import DAYS, jobs_for, plan, seed

COOKIE = "lucena-playground"
TTL = 3600
MAX_SESSIONS = 500
MAX_BODY = 2048
Day = Literal["2026-11-10", "2026-11-11"]
Clock = Annotated[str, StringConstraints(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")]


class Operation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    revision: int = Field(ge=0)


class PropertyEdit(Operation):
    action: Literal["property"]
    id: str
    name: str = Field(min_length=1, max_length=48, pattern=r"^[A-Za-z0-9][A-Za-z0-9 '&.-]*$")
    duration: int = Field(ge=30, le=360)


class AvailabilityEdit(Operation):
    action: Literal["availability"]
    id: str
    day: Day
    available: bool
    start: Clock
    end: Clock


class ReservationEdit(Operation):
    action: Literal["cancel"]
    id: str


class AssignmentEdit(Operation):
    action: Literal["assign"]
    day: Day
    id: str
    cleaner_id: str | None


class ScheduleEdit(Operation):
    action: Literal["generate", "publish"]
    day: Day


class Reset(Operation):
    action: Literal["reset"]


mutation = TypeAdapter(
    Annotated[
        PropertyEdit | AvailabilityEdit | ReservationEdit | AssignmentEdit | ScheduleEdit | Reset,
        Field(discriminator="action"),
    ]
)


def invalidate(state: dict[str, Any], days: tuple[str, ...] = DAYS) -> None:
    for day in days:
        schedule = state["days"][day]
        schedule["preview"] = None
        schedule["stale"] = schedule["published"] is not None


def apply(state: dict[str, Any], op: Operation) -> dict[str, Any]:
    if isinstance(op, Reset):
        return seed()
    if isinstance(op, PropertyEdit):
        row = find(state["properties"], op.id)
        row.update(name=op.name.strip(), duration=op.duration)
        invalidate(state)
    elif isinstance(op, AvailabilityEdit):
        if op.start >= op.end:
            raise HTTPException(422, "Shift end must be after the start.")
        row = find(state["cleaners"], op.id)
        row["availability"][op.day] = {"available": op.available, "start": op.start, "end": op.end}
        invalidate(state, (op.day,))
    elif isinstance(op, ReservationEdit):
        find(state["reservations"], op.id)["status"] = "canceled"
        invalidate(state)
        for day in DAYS:
            state["days"][day]["pins"].pop(op.id, None)
    elif isinstance(op, AssignmentEdit):
        if not any(job.task_id == op.id for job in jobs_for(state, op.day)):
            raise HTTPException(404, "Job unavailable.")
        schedule = state["days"][op.day]
        if op.cleaner_id is None:
            schedule["pins"].pop(op.id, None)
        else:
            find(state["cleaners"], op.cleaner_id)
            schedule["pins"][op.id] = op.cleaner_id
        invalidate(state, (op.day,))
        schedule["preview"] = plan(state, op.day)
    elif isinstance(op, ScheduleEdit):
        schedule = state["days"][op.day]
        if op.action == "generate":
            schedule["preview"] = plan(state, op.day)
        else:
            preview = schedule["preview"]
            if preview is None:
                raise HTTPException(409, "Generate a fresh preview first.")
            if not preview["valid"] or preview["blocked"]:
                raise HTTPException(409, "Resolve conflicting manual assignments before publishing.")
            schedule.update(published=preview, preview=None, stale=False)
    return state


def find(rows: list[dict[str, Any]], identifier: str) -> dict[str, Any]:
    for row in rows:
        if row["id"] == identifier:
            return row
    raise HTTPException(404, "Item unavailable.")


def create_app(database: Path, origin: str, *, local: bool = False) -> FastAPI:
    parsed = urlsplit(origin)
    if not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise RuntimeError("Set PLAYGROUND_ORIGIN to the exact staging origin.")
    if parsed.scheme != "https" and not (
        local and parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}
    ):
        raise RuntimeError("The public playground requires HTTPS.")

    def connect() -> sqlite3.Connection:
        connection = sqlite3.connect(database, timeout=5)
        connection.row_factory = sqlite3.Row
        return connection

    with closing(connect()) as db, db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute(
            "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires INTEGER, revision INTEGER, state TEXT)"
        )
        db.execute("CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires)")
        db.execute("CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, bucket INTEGER, count INTEGER)")

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def no_cache(request: Request, call_next: Any) -> Response:
        response: Response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    def require_origin(request: Request) -> None:
        if request.headers.get("origin") != origin:
            raise HTTPException(403, "Open the playground directly to make changes.")

    def limit(db: sqlite3.Connection, key: str, bucket: int, allowance: int) -> None:
        result = db.execute(
            "INSERT INTO limits VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET "
            "count = CASE WHEN bucket = excluded.bucket THEN count + 1 ELSE 1 END, bucket = excluded.bucket "
            "WHERE bucket != excluded.bucket OR count < ?",
            (key, bucket, allowance),
        )
        if result.rowcount == 0:
            raise HTTPException(429, "Too many requests. Try again shortly.", headers={"Retry-After": "60"})

    def session_id(request: Request) -> str:
        token = request.cookies.get(COOKIE, "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            return ""
        return hashlib.sha256(token.encode()).hexdigest()

    def load(db: sqlite3.Connection, key: str, now: int) -> sqlite3.Row:
        row: sqlite3.Row | None = db.execute(
            "SELECT * FROM sessions WHERE id = ? AND expires > ?", (key, now)
        ).fetchone()
        if row is None:
            raise HTTPException(401, "Start a new sandbox session.")
        return row

    def snapshot(row: sqlite3.Row) -> dict[str, Any]:
        return {"revision": row["revision"], "expires": row["expires"], "state": json.loads(row["state"])}

    @app.post("/playground/api/session")
    def start(request: Request, response: Response) -> dict[str, Any]:
        require_origin(request)
        now = int(time.time())
        with closing(connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            key = session_id(request)
            existing = db.execute("SELECT * FROM sessions WHERE id = ? AND expires > ?", (key, now)).fetchone()
            if existing is not None:
                limit(db, "resume", now // 60, 180)
                limit(db, f"resume:{key}", now // 60, 24)
                saved = snapshot(existing)
                if saved["revision"] == 0 and all(item["preview"] is None for item in saved["state"]["days"].values()):
                    state = seed()
                    db.execute("UPDATE sessions SET state = ? WHERE id = ?", (json.dumps(state), key))
                    saved["state"] = state
                return saved
            db.execute("DELETE FROM sessions WHERE expires <= ?", (now,))
            db.execute("DELETE FROM limits WHERE bucket < ?", (now // 60 - 1,))
            # Public staging overwrites this header at its private reverse proxy.
            peer = request.headers.get("x-playground-client", "") if not local else "local"
            peer_hash = hashlib.sha256(peer.encode()).hexdigest()
            limit(db, "create", now // 60, 40)
            limit(db, f"create:{peer_hash}", now // 60, 8)
            if db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] >= MAX_SESSIONS:
                raise HTTPException(503, "The sandbox is busy. Try again later.")
            token = secrets.token_urlsafe(32)
            state = seed()
            db.execute(
                "INSERT INTO sessions VALUES (?, ?, 0, ?)",
                (hashlib.sha256(token.encode()).hexdigest(), now + TTL, json.dumps(state)),
            )
        response.set_cookie(
            COOKIE, token, max_age=TTL, httponly=True, secure=not local, samesite="strict", path="/playground"
        )
        return {"revision": 0, "expires": now + TTL, "state": state}

    @app.post("/playground/api/mutate")
    async def mutate(request: Request) -> dict[str, Any]:
        require_origin(request)
        if request.headers.get("content-type", "").split(";")[0] != "application/json":
            raise HTTPException(415, "JSON is required.")
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > MAX_BODY:
                raise HTTPException(413, "Request is too large.")
            body.extend(chunk)
        try:
            op = mutation.validate_json(body)
        except ValidationError as exc:
            raise HTTPException(422, "Invalid sandbox action.") from exc
        return await run_in_threadpool(change, request, op)

    def change(request: Request, op: Operation) -> dict[str, Any]:
        key = session_id(request)
        now = int(time.time())
        with closing(connect()) as db, db:
            row = load(db, key, now)
            limit(db, "write", now // 60, 180)
            limit(db, key, now // 60, 24)
        if row["revision"] != op.revision:
            raise HTTPException(409, "Sandbox changed in another tab. Reload before continuing.")
        state = apply(json.loads(row["state"]), op)
        with closing(connect()) as db, db:
            result = db.execute(
                "UPDATE sessions SET revision = revision + 1, state = ? WHERE id = ? AND revision = ? AND expires > ?",
                (json.dumps(state), key, op.revision, int(time.time())),
            )
            if result.rowcount != 1:
                raise HTTPException(409, "Sandbox changed or expired. Reload before continuing.")
        return {"revision": op.revision + 1, "expires": row["expires"], "state": state}

    return app


def factory() -> FastAPI:
    os.umask(0o077)
    return create_app(
        Path(os.environ["PLAYGROUND_DB"]),
        os.environ["PLAYGROUND_ORIGIN"],
        local=os.environ.get("PLAYGROUND_LOCAL") == "1",
    )
