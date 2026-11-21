import socket
from pathlib import Path
from typing import Any

import pytest
from app.playground import server
from fastapi.testclient import TestClient

ORIGIN = "https://playground.example.com"
HEADERS = {"origin": ORIGIN}
DAY = "2026-11-10"
API = "/playground/api"


@pytest.fixture
def app(tmp_path: Path) -> Any:
    return server.create_app(tmp_path / "sessions.sqlite3", ORIGIN)


def start(client: TestClient) -> dict[str, Any]:
    response = client.post(f"{API}/session", headers=HEADERS)
    assert response.status_code == 200
    return dict(response.json())


def mutate(client: TestClient, revision: int, action: str, **args: Any) -> Any:
    return client.post(f"{API}/mutate", json={"revision": revision, "action": action, **args}, headers=HEADERS)


def test_sessions_persist_and_reset_independently(app: Any) -> None:
    with TestClient(app, base_url=ORIGIN) as one, TestClient(app, base_url=ORIGIN) as two:
        first = start(one)
        assert len(first["state"]["properties"]) == 12
        assert len(first["state"]["cleaners"]) == 6
        assert len(first["state"]["reservations"]) == 24
        response = mutate(one, 0, "property", id="house-1", name="Blue House", duration=125)
        assert response.status_code == 200
        cookie = one.cookies.get(server.COOKIE)
        with TestClient(app, base_url=ORIGIN, cookies={server.COOKIE: cookie}) as reconnect:
            assert start(reconnect)["state"]["properties"][0]["name"] == "Blue House"
        assert start(two)["state"] == first["state"]
        assert mutate(two, 0, "property", id="house-1", name="Green House", duration=80).status_code == 200
        assert mutate(one, 0, "reset").status_code == 409
        assert mutate(one, 1, "reset").json()["state"] == first["state"]
        assert start(two)["state"]["properties"][0]["name"] == "Green House"


def test_generate_assign_publish_cancel_and_conflicts(app: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    # Exercise the actual scheduling path with outbound sockets blocked.
    def deny(*args: Any, **kwargs: Any) -> None:
        pytest.fail("Unexpected outbound socket")

    monkeypatch.setattr(socket.socket, "connect", deny)
    with TestClient(app, base_url=ORIGIN) as client:
        start(client)
        generated = mutate(client, 0, "generate", day=DAY)
        assert generated.status_code == 200
        preview = generated.json()["state"]["days"][DAY]["preview"]
        assert len(preview["rows"]) == 8
        assert preview["valid"]
        assert not preview["conflicts"]
        assigned = mutate(client, 1, "assign", day=DAY, id="house-1-stay-1", cleaner_id="cleaner-2")
        assert assigned.json()["state"]["days"][DAY]["preview"]["rows"][0]["cleaner_name"] == "Morgan Vale"
        reassigned = mutate(client, 2, "assign", day=DAY, id="house-1-stay-1", cleaner_id="cleaner-1")
        assert reassigned.json()["state"]["days"][DAY]["preview"]["rows"][0]["cleaner_name"] == "Alex Reed"
        assert mutate(client, 3, "publish", day=DAY).json()["state"]["days"][DAY]["published"]
        edited = mutate(client, 4, "availability", day=DAY, id="cleaner-1", available=False, start="09:00", end="17:00")
        assert edited.json()["state"]["days"][DAY]["stale"]
        assert mutate(client, 5, "publish", day=DAY).status_code == 409
        preview = mutate(client, 5, "generate", day=DAY).json()["state"]["days"][DAY]["preview"]
        assert preview["blocked"] and preview["conflicts"]
        assert mutate(client, 6, "publish", day=DAY).status_code == 409
        canceled = mutate(client, 6, "cancel", id="house-1-stay-1")
        assert canceled.json()["state"]["reservations"][0]["status"] == "canceled"
        fresh = mutate(client, 7, "generate", day=DAY).json()["state"]["days"][DAY]["preview"]
        assert len(fresh["rows"]) == 7 and not fresh["blocked"]
        for path in ["/v1/reservation-syncs", "/v1/demo/record-sms", "/v1/payments", "/v1/workspace/setup"]:
            assert client.post(path, headers=HEADERS).status_code == 404
        for action in ["send_sms", "payment", "hospitable"]:
            assert mutate(client, 8, action).status_code == 422


def test_origin_cookie_rate_limits_and_expiration(app: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    now = 60_000
    monkeypatch.setattr(server.time, "time", lambda: now)
    with TestClient(app, base_url=ORIGIN) as client:
        assert client.post(f"{API}/session", headers={"origin": "https://other.example"}).status_code == 403
        assert mutate(client, 0, "reset").status_code == 401
        response = client.post(f"{API}/session", headers=HEADERS)
        assert response.status_code == 200
        for flag in ["HttpOnly", "Secure", "SameSite=strict", "Path=/playground"]:
            assert flag in response.headers["set-cookie"]
        assert response.headers["cache-control"] == "no-store"
        assert mutate(client, 0, "reset", guest_name="test").status_code == 422
        for revision in range(24):
            assert mutate(client, revision, "reset").status_code == 200
        assert mutate(client, 24, "reset").status_code == 429
        now += server.TTL
        assert mutate(client, 24, "reset").status_code == 401
        assert start(client)["revision"] == 0
