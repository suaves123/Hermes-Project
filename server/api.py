"""Hermes SQLite ingestion and query server for LAN / Cloudflare telemetry."""

import hmac
import json
import math
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("HERMES_DB_PATH", str(BASE_DIR / "hermes_received.db")))
API_KEY = os.getenv("HERMES_API_KEY", "hermes-local-demo-key")
DEMO_CREW = json.loads((BASE_DIR.parent / "crew.json").read_text(encoding="utf-8"))
LEGACY_CREW_NAMES = {1: "Cmdr. A. Rivera", 2: "Astronaut B", 3: "Astronaut C"}

TELEMETRY_FIELDS = (
    "astronaut_id", "scenario", "heart_rate", "spo2", "bp_systolic",
    "bp_diastolic", "respiratory_rate", "body_temp", "hrv_rmssd",
    "stress_level", "steps", "calories", "sleep_hours", "sleep_quality",
    "hydration", "eda", "cortisol", "emg_activity", "exercise_minutes",
    "bone_loss_rate", "grip_strength", "cabin_temp", "cabin_humidity",
    "cabin_co2", "cabin_o2", "cabin_pressure", "radiation",
    "sensor_availability", "recorded_at",
)

INTEGER_FIELDS = {
    "astronaut_id", "bp_systolic", "bp_diastolic", "respiratory_rate",
    "hrv_rmssd", "stress_level", "steps", "calories", "sleep_quality",
    "hydration", "emg_activity", "exercise_minutes", "cabin_humidity",
}

TEXT_FIELDS = {"scenario", "recorded_at"}


class BatchRequest(BaseModel):
    source: str = Field(min_length=1, max_length=100)
    records: list[dict] = Field(min_length=1, max_length=100)


@contextmanager
def database():
    connection = sqlite3.connect(DB_PATH, timeout=20)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 20000")

    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database():
    with database() as connection:
        connection.execute("PRAGMA journal_mode = WAL")

        # Databases created by earlier versions used non-English table and column names; rename them in place.
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        if "astronautas" in tables and "astronauts" not in tables:
            connection.execute("PRAGMA foreign_keys = OFF")
            connection.execute("ALTER TABLE astronautas RENAME TO astronauts")
            connection.execute("ALTER TABLE astronauts RENAME COLUMN nombre TO name")
            connection.execute("PRAGMA foreign_keys = ON")

        connection.execute("""
            CREATE TABLE IF NOT EXISTS astronauts (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL
            )
        """)

        connection.executemany(
            "INSERT OR IGNORE INTO astronauts (id, name) VALUES (?, ?)",
            [(member["id"], member["name"]) for member in DEMO_CREW],
        )
        # Rename the original demo identities in existing databases without changing their IDs.
        connection.executemany(
            "UPDATE astronauts SET name = ? WHERE id = ? AND name IN (?, ?)",
            [
                (member["name"], member["id"], LEGACY_CREW_NAMES.get(member["id"], ""), f"Astronaut {member['id']}")
                for member in DEMO_CREW
            ],
        )

        definitions = []
        for field in TELEMETRY_FIELDS:
            sql_type = (
                "TEXT" if field in TEXT_FIELDS
                else "INTEGER" if field in INTEGER_FIELDS
                else "REAL"
            )
            definitions.append(f"{field} {sql_type} NOT NULL")

        connection.execute(
            "CREATE TABLE IF NOT EXISTS telemetry ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            + ", ".join(definitions)
            + ", FOREIGN KEY (astronaut_id) REFERENCES astronauts(id))"
        )

        connection.execute("""
            CREATE TABLE IF NOT EXISTS ai_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                astronaut_id INTEGER NOT NULL,
                alert_type TEXT NOT NULL,
                category TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (astronaut_id) REFERENCES astronauts(id)
            )
        """)

        connection.execute("""
            CREATE TABLE IF NOT EXISTS received_records (
                source TEXT NOT NULL,
                source_record_id INTEGER NOT NULL,
                telemetry_id INTEGER NOT NULL,
                PRIMARY KEY (source, source_record_id),
                FOREIGN KEY (telemetry_id) REFERENCES telemetry(id)
            )
        """)

        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_telemetry_astronaut_time "
            "ON telemetry(astronaut_id, recorded_at)"
        )
        connection.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_crew_id ON telemetry(astronaut_id, id)")

        # Health check-ins arrive already validated and assessed by the web app; the full record is kept as JSON.
        connection.execute("""
            CREATE TABLE IF NOT EXISTS checkins (
                id TEXT PRIMARY KEY,
                astronaut_id INTEGER NOT NULL,
                timestamp_utc TEXT NOT NULL,
                data TEXT NOT NULL
            )
        """)
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_checkins_crew_time ON checkins(astronaut_id, timestamp_utc)"
        )


def evaluate_alerts(data: dict) -> list[tuple[str, str, str]]:
    alerts = []

    if data["spo2"] < 92.0 or data["cabin_o2"] < 19.5:
        alerts.append((
            "crit", "ECLSS / Hypoxia",
            f"Low blood oxygen ({data['spo2']}%) or low cabin oxygen ({data['cabin_o2']}%)."
        ))

    if data["hydration"] < 65:
        alerts.append((
            "crit", "Hydration",
            f"Critically low hydration ({data['hydration']}%)."
        ))
    elif data["hydration"] < 72:
        alerts.append((
            "warn", "Hydration",
            f"Hydration below the target range ({data['hydration']}%)."
        ))

    if data["body_temp"] >= 38.0:
        alerts.append((
            "crit", "Immune / Fever",
            f"Elevated body temperature ({data['body_temp']} °C)."
        ))

    if data["radiation"] >= 1.0:
        alerts.append((
            "warn", "Radiation",
            f"Elevated cabin radiation ({data['radiation']} mSv/day)."
        ))

    if data["stress_level"] >= 55 or data["hrv_rmssd"] < 30:
        alerts.append((
            "warn", "Stress / HRV",
            f"Elevated stress ({data['stress_level']}/100) or reduced HRV ({data['hrv_rmssd']} ms)."
        ))

    if not alerts:
        alerts.append((
            "ok", "Nominal",
            "All physiological and cabin measurements are in the nominal range."
        ))

    return alerts


def validate_record(record: dict) -> int:
    if not isinstance(record, dict):
        raise ValueError("Each record must be an object")

    record_id = record.get("id")
    if isinstance(record_id, bool) or not isinstance(record_id, int) or record_id < 1:
        raise ValueError("Each record must have a positive integer id")

    missing = [field for field in TELEMETRY_FIELDS if field not in record]
    if missing:
        raise ValueError("Missing fields: " + ", ".join(missing))

    for field in TELEMETRY_FIELDS:
        value = record[field]
        if field in TEXT_FIELDS:
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"Invalid text value for {field}")
        elif field in INTEGER_FIELDS:
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(f"Invalid integer value for {field}")
        elif isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"Invalid numeric value for {field}")

    for field in TELEMETRY_FIELDS:
        if field not in TEXT_FIELDS and not math.isfinite(record[field]):
            raise ValueError(f"Non-finite number for {field}")

    try:
        timestamp = datetime.fromisoformat(record["recorded_at"].replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        record["recorded_at"] = timestamp.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    except ValueError as error:
        raise ValueError("recorded_at must be a valid ISO timestamp") from error

    if record["astronaut_id"] < 1:
        raise ValueError("astronaut_id must be positive")

    return record_id


app = FastAPI(
    title="Hermes Telemetry API",
    description="API for receiving, storing, and monitoring astronaut telemetry.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

initialize_database()


def require_key(received_key: str | None):
    if not API_KEY:
        raise HTTPException(status_code=503, detail="Server API key is not configured")
    if not received_key or not hmac.compare_digest(received_key, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid API key")


@app.get("/", tags=["System"])
def root():
    return {
        "service": "Hermes Telemetry API",
        "documentation": "/docs",
        "health": "/health",
    }


@app.get("/health", tags=["System"])
def health():
    return {
        "status": "ok",
        "server_time": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/telemetry/batch", tags=["Telemetry"])
def receive_telemetry(
    payload: BatchRequest,
    x_api_key: str | None = Header(default=None),
):
    require_key(x_api_key)

    try:
        record_ids = [validate_record(record) for record in payload.records]
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    if len(record_ids) != len(set(record_ids)):
        raise HTTPException(status_code=422, detail="Duplicate source record ids in request")

    inserted = 0
    duplicates = 0

    columns = ", ".join(TELEMETRY_FIELDS)
    placeholders = ", ".join("?" for _ in TELEMETRY_FIELDS)

    with database() as connection:
        for record in payload.records:
            existing = connection.execute(
                "SELECT 1 FROM received_records WHERE source = ? AND source_record_id = ?",
                (payload.source, record["id"]),
            ).fetchone()

            if existing:
                duplicates += 1
                continue

            astronaut_id = record["astronaut_id"]

            connection.execute(
                "INSERT OR IGNORE INTO astronauts (id, name) VALUES (?, ?)",
                (astronaut_id, f"Astronaut {astronaut_id}"),
            )

            cursor = connection.execute(
                f"INSERT INTO telemetry ({columns}) VALUES ({placeholders})",
                tuple(record[field] for field in TELEMETRY_FIELDS),
            )

            connection.execute(
                "INSERT INTO received_records (source, source_record_id, telemetry_id) VALUES (?, ?, ?)",
                (payload.source, record["id"], cursor.lastrowid),
            )

            connection.execute(
                "DELETE FROM ai_alerts WHERE astronaut_id = ?",
                (astronaut_id,),
            )

            for level, category, message in evaluate_alerts(record):
                connection.execute(
                    """
                    INSERT INTO ai_alerts (astronaut_id, alert_type, category, message, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (astronaut_id, level, category, message, record["recorded_at"]),
                )

            inserted += 1

    return {"status": "ok", "inserted": inserted, "duplicates": duplicates}


@app.get("/api/latest", tags=["Telemetry"])
def latest(
    astronaut_id: int | None = None,
    x_api_key: str | None = Header(default=None),
):
    require_key(x_api_key)

    with database() as connection:
        if astronaut_id is None:
            rows = connection.execute("""
                SELECT t.*
                FROM astronauts AS a
                JOIN telemetry AS t ON t.id = (
                    SELECT id FROM telemetry
                    WHERE astronaut_id = a.id
                    ORDER BY id DESC
                    LIMIT 1
                )
                ORDER BY a.id
            """).fetchall()
            return {"records": [dict(row) for row in rows]}

        row = connection.execute(
            "SELECT * FROM telemetry WHERE astronaut_id = ? ORDER BY id DESC LIMIT 1",
            (astronaut_id,),
        ).fetchone()
        return {"record": dict(row) if row else None}


@app.get("/api/history", tags=["Telemetry"])
def history(
    astronaut_id: int | None = Query(default=None, ge=1),
    date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    start: str | None = None,
    end: str | None = None,
    before_id: int | None = Query(default=None, ge=0),
    after_id: int | None = Query(default=None, ge=0),
    limit: int = Query(default=300, ge=1, le=2000),
    x_api_key: str | None = Header(default=None),
):
    require_key(x_api_key)
    conditions, params = [], []
    for value in (start, end):
        if value is not None:
            try:
                if datetime.strptime(value, "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S") != value:
                    raise ValueError()
            except ValueError:
                raise HTTPException(status_code=422, detail="Date filters must use UTC YYYY-MM-DD HH:MM:SS")
    if start and end and start > end:
        raise HTTPException(status_code=422, detail="The start date must precede the end date")
    if date:
        try:
            datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid date")
        conditions.append("recorded_at LIKE ?")
        params.append(f"{date}%")
    for column, operator, value in (
        ("astronaut_id", "=", astronaut_id), ("id", "<", before_id),
        ("id", ">", after_id), ("recorded_at", ">=", start), ("recorded_at", "<=", end),
    ):
        if value is not None:
            conditions.append(f"{column} {operator} ?")
            params.append(value)
    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    with database() as connection:
        rows = connection.execute(
            f"SELECT * FROM telemetry {where} ORDER BY id DESC LIMIT ?", (*params, limit + 1)
        ).fetchall()
    more = len(rows) > limit
    records = [dict(row) for row in rows[:limit]]
    return {"records": records, "has_more": more,
            "next_before_id": records[-1]["id"] if more else None}


@app.get("/api/alerts", tags=["Alerts"])
def alerts(x_api_key: str | None = Header(default=None)):
    require_key(x_api_key)

    with database() as connection:
        rows = connection.execute(
            "SELECT * FROM ai_alerts ORDER BY astronaut_id, id"
        ).fetchall()
        return {"alerts": [dict(row) for row in rows]}


@app.get("/api/astronauts", tags=["Astronauts"])
def astronauts(x_api_key: str | None = Header(default=None)):
    require_key(x_api_key)

    with database() as connection:
        rows = connection.execute(
            "SELECT id, name FROM astronauts ORDER BY id"
        ).fetchall()
        return {"astronauts": [dict(row) for row in rows]}


@app.get("/api/stats", tags=["System"])
def stats(x_api_key: str | None = Header(default=None)):
    require_key(x_api_key)

    with database() as connection:
        total = connection.execute("SELECT COUNT(*) FROM telemetry").fetchone()[0]
        last = connection.execute(
            "SELECT recorded_at FROM telemetry ORDER BY id DESC LIMIT 1"
        ).fetchone()
        sources = connection.execute(
            "SELECT source, COUNT(*) AS records FROM received_records GROUP BY source ORDER BY source"
        ).fetchall()
        per_astronaut = connection.execute(
            "SELECT astronaut_id, COUNT(*) AS records FROM telemetry GROUP BY astronaut_id ORDER BY astronaut_id"
        ).fetchall()

        return {
            "total_records": total,
            "latest_recorded_at": last["recorded_at"] if last else None,
            "sources": [dict(row) for row in sources],
            "astronauts": [dict(row) for row in per_astronaut],
        }
@app.get("/api/checkins", tags=["Check-ins"])
def list_checkins(
    astronaut_id: int | None = Query(default=None, ge=1),
    latest: bool = False,
    limit: int = Query(default=500, ge=1, le=1000),
    x_api_key: str | None = Header(default=None),
):
    """Stored health check-ins, newest first. With latest=1 only the newest one per crew member."""
    require_key(x_api_key)

    with database() as connection:
        if astronaut_id is None:
            rows = connection.execute("SELECT astronaut_id, data FROM checkins ORDER BY timestamp_utc DESC, id DESC").fetchall()
        else:
            rows = connection.execute(
                "SELECT astronaut_id, data FROM checkins WHERE astronaut_id = ? ORDER BY timestamp_utc DESC, id DESC",
                (astronaut_id,),
            ).fetchall()

    records, seen = [], set()
    for row in rows:
        if latest:
            if row["astronaut_id"] in seen:
                continue
            seen.add(row["astronaut_id"])
        records.append(json.loads(row["data"]))
        if len(records) >= limit:
            break
    return {"checkins": records}


@app.post("/api/checkins", tags=["Check-ins"])
def store_checkin(payload: dict, x_api_key: str | None = Header(default=None)):
    require_key(x_api_key)
    checkin_id, astronaut_id, timestamp = payload.get("id"), payload.get("astronaut_id"), payload.get("timestamp_utc")
    if (
        not isinstance(checkin_id, str) or not 8 <= len(checkin_id) <= 64
        or isinstance(astronaut_id, bool) or not isinstance(astronaut_id, int) or astronaut_id < 1
        or not isinstance(timestamp, str) or not isinstance(payload.get("assessment"), dict)
    ):
        raise HTTPException(status_code=422, detail="Invalid check-in record")
    try:
        datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid timestamp_utc")

    with database() as connection:
        connection.execute(
            "INSERT OR REPLACE INTO checkins (id, astronaut_id, timestamp_utc, data) VALUES (?, ?, ?, ?)",
            (checkin_id, astronaut_id, timestamp, json.dumps(payload, ensure_ascii=False)),
        )
    return {"status": "ok", "id": checkin_id}


@app.post("/api/checkins/clear", tags=["Check-ins"])
def clear_checkins(x_api_key: str | None = Header(default=None)):
    require_key(x_api_key)

    with database() as connection:
        connection.execute("DELETE FROM checkins")
    return {"status": "ok"}


@app.post("/api/scenario", tags=["System"])
def set_scenario(
    payload: dict,
    x_api_key: str | None = Header(default=None),
):
    require_key(x_api_key)
    sc = payload.get("scenario")
    if str(sc) not in ["1", "2", "3", "4"]:
        raise HTTPException(status_code=422, detail="Invalid scenario (expected 1, 2, 3, or 4)")
    
    # The generator reads these scenario files before producing its next batch.
    # With an astronaut_id only that crew member changes (one file per astronaut avoids
    # read-modify-write races between viewers). Without it, every crew member changes.
    SCENARIO_FILE = BASE_DIR / "active_scenario.txt"
    astro = payload.get("astronaut_id")
    if astro is None:
        SCENARIO_FILE.write_text(str(sc), encoding="utf-8")
        for old in BASE_DIR.glob("active_scenario_*.txt"):
            old.unlink(missing_ok=True)
        return {"status": "ok", "active_scenario": str(sc)}
    try:
        astro_id = int(astro)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Invalid astronaut_id")
    if astro_id < 1:
        raise HTTPException(status_code=422, detail="Invalid astronaut_id")
    (BASE_DIR / f"active_scenario_{astro_id}.txt").write_text(str(sc), encoding="utf-8")
    return {"status": "ok", "active_scenario": str(sc), "astronaut_id": astro_id}
