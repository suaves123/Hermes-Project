import os
import random
import time
from datetime import datetime, timezone
from pathlib import Path
import requests

BASE_DIR = Path(__file__).resolve().parent if "__file__" in globals() else Path.cwd()
SCENARIO_FILE = BASE_DIR / "active_scenario.txt"

API_BASE_URL = os.getenv("HERMES_API_URL", "http://127.0.0.1:8000")
API_KEY = os.getenv("HERMES_API_KEY", "hermes-local-demo-key")
SOURCE_NAME = "hermes-generator"
INTERVAL_SECONDS = 1.0  # one sample per second

# Four simulation scenarios for three crew members
SCENARIOS = {
    "1": {
        "name": "nominal",
        "description": "Crew at rest / Nominal",
        "targets": {
            "heart_rate": 72.0, "spo2": 98.0, "bp_systolic": 118.0, "bp_diastolic": 76.0,
            "respiratory_rate": 15.0, "body_temp": 36.7, "hrv_rmssd": 48.0, "stress_level": 28.0,
            "hydration": 82.0, "eda": 3.1, "cortisol": 12.5, "emg_activity": 22.0,
            "cabin_temp": 22.2, "cabin_humidity": 45.0, "cabin_co2": 2.6, "cabin_o2": 20.9,
            "cabin_pressure": 101.3, "radiation": 0.38, "sensor_availability": 99.6
        },
        "step_rate": 4, "cal_rate": 1.4, "ex_rate": 0.0
    },
    "2": {
        "name": "eva_exertion",
        "description": "High physical activity / EVA exertion",
        "targets": {
            "heart_rate": 136.0, "spo2": 96.0, "bp_systolic": 144.0, "bp_diastolic": 86.0,
            "respiratory_rate": 26.0, "body_temp": 37.4, "hrv_rmssd": 26.0, "stress_level": 54.0,
            "hydration": 63.0, "eda": 6.8, "cortisol": 18.0, "emg_activity": 74.0,
            "cabin_temp": 22.8, "cabin_humidity": 49.0, "cabin_co2": 3.2, "cabin_o2": 20.7,
            "cabin_pressure": 101.1, "radiation": 0.55, "sensor_availability": 99.2
        },
        "step_rate": 38, "cal_rate": 9.5, "ex_rate": 0.5
    },
    "3": {
        "name": "eclss_hypoxia",
        "description": "ECLSS fault / Hypoxia and low cabin oxygen",
        "targets": {
            "heart_rate": 124.0, "spo2": 88.5, "bp_systolic": 138.0, "bp_diastolic": 88.0,
            "respiratory_rate": 28.0, "body_temp": 36.4, "hrv_rmssd": 19.0, "stress_level": 84.0,
            "hydration": 68.0, "eda": 8.4, "cortisol": 24.5, "emg_activity": 18.0,
            "cabin_temp": 24.5, "cabin_humidity": 56.0, "cabin_co2": 6.4, "cabin_o2": 18.2,
            "cabin_pressure": 96.8, "radiation": 0.42, "sensor_availability": 97.5
        },
        "step_rate": 1, "cal_rate": 2.2, "ex_rate": 0.0
    },
    "4": {
        "name": "immune_radiation",
        "description": "Fever / Elevated radiation",
        "targets": {
            "heart_rate": 108.0, "spo2": 94.0, "bp_systolic": 132.0, "bp_diastolic": 85.0,
            "respiratory_rate": 21.0, "body_temp": 38.6, "hrv_rmssd": 22.0, "stress_level": 78.0,
            "hydration": 58.0, "eda": 7.5, "cortisol": 27.0, "emg_activity": 15.0,
            "cabin_temp": 23.1, "cabin_humidity": 44.0, "cabin_co2": 3.0, "cabin_o2": 20.8,
            "cabin_pressure": 101.2, "radiation": 1.45, "sensor_availability": 98.8
        },
        "step_rate": 2, "cal_rate": 1.9, "ex_rate": 0.0
    }
}

def read_active_scenario(astro_id: int | None = None) -> str:
    # A per-astronaut file wins; the global file is the fallback for everyone else.
    candidates = []
    if astro_id is not None:
        candidates.append(SCENARIO_FILE.with_name(f"active_scenario_{astro_id}.txt"))
    candidates.append(SCENARIO_FILE)
    for path in candidates:
        if path.exists():
            val = path.read_text(encoding="utf-8").strip()
            if val in SCENARIOS:
                return val
    return "1"

def step_all_astronauts(states: dict, sc: dict, next_id: int) -> tuple[list[dict], int]:
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    batch = []

    for astro_id, st in states.items():
        for k, target in sc["targets"].items():
            noise = max(0.02, abs(target) * 0.008)
            st["vals"][k] += 0.25 * (target - st["vals"][k]) + random.gauss(0, noise)

        st["steps"] += sc["step_rate"]
        st["cal"] += sc["cal_rate"]
        st["ex"] += sc["ex_rate"]
        v = st["vals"]

        batch.append({
            "id": int(next_id),
            "astronaut_id": int(astro_id),
            "scenario": str(sc["name"]),
            "heart_rate": float(round(max(40.0, min(210.0, v["heart_rate"])), 1)),
            "spo2": float(round(max(70.0, min(100.0, v["spo2"])), 1)),
            "bp_systolic": int(round(max(80, min(200, v["bp_systolic"])))),
            "bp_diastolic": int(round(max(50, min(130, v["bp_diastolic"])))),
            "respiratory_rate": int(round(max(8, min(45, v["respiratory_rate"])))),
            "body_temp": float(round(max(34.5, min(41.5, v["body_temp"])), 1)),
            "hrv_rmssd": int(round(max(10, min(120, v["hrv_rmssd"])))),
            "stress_level": int(round(max(5, min(100, v["stress_level"])))),
            "steps": int(st["steps"]),
            "calories": int(round(st["cal"])),
            "sleep_hours": 7.2,
            "sleep_quality": 85,
            "hydration": int(round(max(30, min(100, v["hydration"])))),
            "eda": float(round(max(0.5, min(20.0, v["eda"])), 1)),
            "cortisol": float(round(max(2.0, min(45.0, v["cortisol"])), 1)),
            "emg_activity": int(round(max(5, min(100, v["emg_activity"])))),
            "exercise_minutes": int(round(st["ex"])),
            "bone_loss_rate": 0.8,
            "grip_strength": 42.0,
            "cabin_temp": float(round(v["cabin_temp"], 1)),
            "cabin_humidity": int(round(v["cabin_humidity"])),
            "cabin_co2": float(round(v["cabin_co2"], 2)),
            "cabin_o2": float(round(v["cabin_o2"], 1)),
            "cabin_pressure": float(round(v["cabin_pressure"], 1)),
            "radiation": float(round(v["radiation"], 2)),
            "sensor_availability": float(round(max(0, min(100, v["sensor_availability"])), 1)),
            "recorded_at": now_str,
        })
        next_id += 1

    return batch, next_id

def main():
    endpoint = f"{API_BASE_URL.rstrip('/')}/api/telemetry/batch"
    headers = {"Content-Type": "application/json", "X-API-Key": API_KEY}
    next_id = time.time_ns() // 1000

    states = {
        1: {"vals": dict(SCENARIOS["1"]["targets"]), "steps": 6240, "cal": 1830.0, "ex": 95.0},
        2: {"vals": dict(SCENARIOS["1"]["targets"]), "steps": 5410, "cal": 1690.0, "ex": 70.0},
        3: {"vals": dict(SCENARIOS["1"]["targets"]), "steps": 7120, "cal": 2010.0, "ex": 110.0},
    }

    while True:
        batch = []
        names = []
        for astro_id, st in states.items():
            sc = SCENARIOS[read_active_scenario(astro_id)]
            rows, next_id = step_all_astronauts({astro_id: st}, sc, next_id)
            batch.extend(rows)
            names.append(f"{astro_id}:{sc['name']}")

        try:
            resp = requests.post(endpoint, json={"source": SOURCE_NAME, "records": batch}, headers=headers, timeout=3.0)
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Scenarios: {', '.join(names)} | HTTP {resp.status_code}")
        except requests.RequestException as err:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Connection error: {err}")

        time.sleep(INTERVAL_SECONDS)

if __name__ == "__main__":
    main()
