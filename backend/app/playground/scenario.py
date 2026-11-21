"""Fictional reservation fixtures and scheduling through the shared domain engine."""

from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from app.adapters.reservations.mock import MockReservationProvider
from app.domain.scheduling import Job, Shift, solve, validate
from app.domain.tasks import readiness_deadline, turnover_deadline

EASTERN = ZoneInfo("America/New_York")
DAYS = ("2026-11-10", "2026-11-11")
PROPERTIES = (
    "Willow Cottage",
    "Juniper House",
    "Maple Loft",
    "Cedar Retreat",
    "Magnolia Studio",
    "Oak Terrace",
    "Birch Bungalow",
    "Dogwood Flat",
    "Pine Landing",
    "Cypress Nook",
    "Hawthorn House",
    "Elm Courtyard",
)
CLEANERS = ("Alex Reed", "Morgan Vale", "Jordan Lake", "Taylor Moon", "Casey Hill", "Riley Finch")


def local(day: str, wall_time: str) -> datetime:
    return datetime.combine(date.fromisoformat(day), time.fromisoformat(wall_time), EASTERN)


def seed() -> dict[str, Any]:
    properties = []
    reservations = []
    provider = MockReservationProvider()
    for index, name in enumerate(PROPERTIES):
        property_id = f"house-{index + 1}"
        properties.append(
            {
                "id": property_id,
                "name": name,
                "duration": (75, 90, 120, 150)[index % 4],
                "area": index // 4,
            }
        )
        turnover = date.fromisoformat(DAYS[index // 8])
        arrival = turnover + timedelta(days=int(index % 5 == 4))
        windows = [
            (turnover - timedelta(days=2 + index % 3), "16:00", turnover, ("10:00", "11:00")[index % 2]),
            (arrival, ("15:00", "16:00", "17:00")[index % 3], arrival + timedelta(days=2 + index % 2), "10:00"),
        ]
        for number, (arrive, checkin, depart, checkout) in enumerate(windows):
            (record,) = provider.normalize_event(
                {
                    "provider": "mock",
                    "external_id": f"{property_id}-stay-{number + 1}",
                    "property_external_id": property_id,
                    "status": "active",
                    "checkin_at": local(str(arrive), checkin).isoformat(),
                    "checkout_at": local(str(depart), checkout).isoformat(),
                }
            )
            reservations.append(
                {
                    "id": record.external_id,
                    "property_id": record.property_external_id,
                    "checkin": record.checkin_at.isoformat(),
                    "checkout": record.checkout_at.isoformat(),
                    "status": record.status,
                }
            )
    cleaners = [
        {
            "id": f"cleaner-{index + 1}",
            "name": name,
            "area": index // 2,
            "availability": {day: {"available": index != 5, "start": "09:00", "end": "17:00"} for day in DAYS},
        }
        for index, name in enumerate(CLEANERS)
    ]
    state: dict[str, Any] = {
        "properties": properties,
        "reservations": reservations,
        "cleaners": cleaners,
        "days": {day: {"pins": {}, "preview": None, "published": None, "stale": False} for day in DAYS},
    }

    for day in DAYS:
        state["days"][day]["preview"] = plan(state, day)
    return state


def jobs_for(state: dict[str, Any], day: str) -> list[Job]:
    jobs = []
    for prop in state["properties"]:
        stays = sorted(
            (row for row in state["reservations"] if row["property_id"] == prop["id"] and row["status"] == "active"),
            key=lambda row: row["checkin"],
        )
        for index, stay in enumerate(stays):
            checkout = datetime.fromisoformat(stay["checkout"])
            if checkout.astimezone(EASTERN).date().isoformat() != day:
                continue
            next_arrival = datetime.fromisoformat(stays[index + 1]["checkin"]) if index + 1 < len(stays) else None
            deadline = turnover_deadline(checkout, readiness_deadline(next_arrival, 30) if next_arrival else None)
            jobs.append(
                Job(
                    stay["id"],
                    prop["id"],
                    checkout,
                    deadline,
                    timedelta(minutes=prop["duration"]),
                    prop["id"],
                    next_checkin=next_arrival,
                    checkout_at=checkout,
                )
            )
    return jobs


def plan(state: dict[str, Any], day: str) -> dict[str, Any]:
    jobs = jobs_for(state, day)
    pins = state["days"][day]["pins"]
    # A pin limits eligibility for the job while leaving the solver free to choose its time.
    # The fixture has at most one departure per house per day.
    pins_by_place = {job.place: pins[job.task_id] for job in jobs if job.task_id in pins}
    areas = {p["id"]: p["area"] for p in state["properties"]}
    shifts = []
    for cleaner in state["cleaners"]:
        cleaner_id = cleaner["id"]
        areas[cleaner_id] = cleaner["area"]
        hours = cleaner["availability"][day]
        if hours["available"]:
            places = frozenset(p for p in pins_by_place if pins_by_place[p] == cleaner_id)
            places |= areas.keys() & {j.place for j in jobs if j.place not in pins_by_place}
            shifts.append(
                Shift(
                    cleaner_id,
                    cleaner_id,
                    local(day, hours["start"]),
                    local(day, hours["end"]),
                    (),
                    3,
                    timedelta(hours=6),
                    timedelta(hours=8),
                    places,
                )
            )

    def travel(origin: str, destination: str) -> int:
        return 0 if origin == destination else (8 + 10 * abs(areas[origin] - areas[destination])) * 60

    result = solve(jobs, shifts, travel, time_limit_seconds=2)
    errors = sorted(set(validate(result, jobs, shifts, travel)))
    placed = {row.task_id: row for row in result.placed} if not errors else {}
    conflicts = [{"job": job, "code": code} for job, code in result.uncovered]
    if errors:
        conflicts = [{"job": job.task_id, "code": "VALIDATION_FAILED"} for job in jobs]
    rows = []
    names = {p["id"]: p["name"] for p in state["properties"]}
    cleaner_names = {c["id"]: c["name"] for c in state["cleaners"]}
    for job in jobs:
        assignment = placed.get(job.task_id)
        rows.append(
            {
                "id": job.task_id,
                "property_name": names[job.property_id],
                "release_at": job.release.isoformat(),
                "deadline_at": job.deadline.isoformat(),
                "duration_minutes": int(job.duration.total_seconds() / 60),
                "cleaner_name": cleaner_names[assignment.cleaner_id] if assignment else None,
                "planned_start": assignment.start.isoformat() if assignment else None,
                "planned_end": assignment.end.isoformat() if assignment else None,
                "travel_before_seconds": int(assignment.travel_before.total_seconds()) if assignment else None,
                "travel_from": "fictional route" if assignment else None,
                "acknowledged": False,
                "pending": False,
                "status": "ready",
            }
        )
    return {
        "rows": rows,
        "conflicts": conflicts,
        "valid": not errors,
        "blocked": any(conflict["job"] in pins for conflict in conflicts),
    }
