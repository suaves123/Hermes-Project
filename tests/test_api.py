"""Hermes API regression checks. Run with: python tests/test_api.py (requires httpx)."""
import importlib
import math
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        os.environ['HERMES_DB_PATH'] = str(Path(cls.tmp.name) / 'history.db')
        cls.api = importlib.import_module('server.api')
        cls.api.BASE_DIR = Path(cls.tmp.name)
        cls.generator = importlib.import_module('server.generator')
        cls.client = TestClient(cls.api.app)
        cls.headers = {'X-API-Key': cls.api.API_KEY}
        state = {1: {'vals': dict(cls.generator.SCENARIOS['1']['targets']), 'steps': 0, 'cal': 0, 'ex': 0}}
        cls.prototype = cls.generator.step_all_astronauts(state, cls.generator.SCENARIOS['1'], 1)[0][0]
        rows = []
        start = datetime(2026, 11, 1, tzinfo=timezone.utc)
        for i in range(2105):
            row = dict(cls.prototype, id=i+1, heart_rate=70+math.sin(i), recorded_at=(start+timedelta(seconds=i)).isoformat())
            rows.append(row)
        for start in range(0, len(rows), 100):
            response = cls.client.post('/api/telemetry/batch', headers=cls.headers, json={'source': 'test', 'records': rows[start:start+100]})
            assert response.status_code == 200, response.text

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.tmp.cleanup()

    def test_full_history_pagination(self):
        records, before = [], None
        while True:
            params = {'astronaut_id': 1, 'limit': 1000}
            if before:
                params['before_id'] = before
            data = self.client.get('/api/history', params=params, headers=self.headers).json()
            records.extend(data['records'])
            if not data['has_more']:
                break
            before = data['next_before_id']
        self.assertEqual(len(records), 2105)
        self.assertEqual(len({r['id'] for r in records}), 2105)
        self.assertEqual(records[0]['id'], 2105)
        self.assertEqual(records[-1]['id'], 1)
        self.assertTrue(all(set(self.api.TELEMETRY_FIELDS).issubset(r) for r in records))

    def test_filters_and_crew_isolation(self):
        response = self.client.get('/api/history', params={'astronaut_id': 1, 'start': '2026-11-01 00:10:00', 'end': '2026-11-01 00:10:09'}, headers=self.headers)
        self.assertEqual(len(response.json()['records']), 10)
        self.assertEqual(self.client.get('/api/history?astronaut_id=2', headers=self.headers).json()['records'], [])
        records = self.client.get('/api/history?astronaut_id=1&after_id=2100', headers=self.headers).json()['records']
        self.assertEqual([r['id'] for r in records], [2105, 2104, 2103, 2102, 2101])
        self.assertEqual(self.client.get('/api/history?start=garbage', headers=self.headers).status_code, 422)
        self.assertEqual(self.client.get('/api/history?date=2026-99-99', headers=self.headers).status_code, 422)

    def test_validation_and_authentication(self):
        self.assertEqual(self.client.get('/api/history').status_code, 401)
        row = dict(self.prototype, recorded_at='not a date')
        self.assertEqual(self.client.post('/api/telemetry/batch', headers=self.headers, json={'source': 'bad', 'records': [row]}).status_code, 422)
        row = dict(self.prototype, heart_rate=True)
        self.assertEqual(self.client.post('/api/telemetry/batch', headers=self.headers, json={'source': 'bad', 'records': [row]}).status_code, 422)
        row = dict(self.prototype, recorded_at='2026-11-01T05:00:00-07:00')
        self.api.validate_record(row)
        self.assertEqual(row['recorded_at'], '2026-11-01 12:00:00')

    def test_scenario_is_per_astronaut(self):
        r = self.client.post('/api/scenario', headers=self.headers, json={'scenario': '3', 'astronaut_id': 2})
        self.assertEqual(r.json()['astronaut_id'], 2)
        self.assertEqual((self.api.BASE_DIR/'active_scenario_2.txt').read_text(), '3')
        self.assertFalse((self.api.BASE_DIR/'active_scenario_1.txt').exists())
        self.assertEqual(self.client.post('/api/scenario', headers=self.headers, json={'scenario': '3', 'astronaut_id': 'x'}).status_code, 422)
        original = self.generator.SCENARIO_FILE
        try:
            self.generator.SCENARIO_FILE = self.api.BASE_DIR/'active_scenario.txt'
            self.assertEqual(self.generator.read_active_scenario(2), '3')
            self.assertEqual(self.generator.read_active_scenario(1), '1')
        finally:
            self.generator.SCENARIO_FILE = original
            (self.api.BASE_DIR/'active_scenario_2.txt').unlink(missing_ok=True)

    def test_checkins_store_latest_and_clear(self):
        def record(cid, astro, when):
            return {'id': cid, 'astronaut_id': astro, 'timestamp_utc': when, 'assessment': {'flag_status': 'NOMINAL'}}
        for cid, astro, when in [('a' * 16, 1, '2026-11-10T08:00:00Z'), ('b' * 16, 1, '2026-11-11T08:00:00Z'), ('c' * 16, 2, '2026-11-11T09:00:00Z')]:
            self.assertEqual(self.client.post('/api/checkins', headers=self.headers, json=record(cid, astro, when)).status_code, 200)
        self.assertEqual(self.client.get('/api/checkins').status_code, 401)
        self.assertEqual(self.client.get('/api/latest', headers=self.headers).json()['records'][0]['astronaut_id'], 1)
        everything = self.client.get('/api/checkins', headers=self.headers).json()['checkins']
        self.assertEqual([r['id'][0] for r in everything], ['c', 'b', 'a'])
        latest = self.client.get('/api/checkins?latest=1', headers=self.headers).json()['checkins']
        self.assertEqual(sorted(r['id'][0] for r in latest), ['b', 'c'])
        self.assertEqual(len(self.client.get('/api/checkins?astronaut_id=1', headers=self.headers).json()['checkins']), 2)
        bad = dict(record('d' * 16, 1, 'yesterday'))
        self.assertEqual(self.client.post('/api/checkins', headers=self.headers, json=bad).status_code, 422)
        self.assertEqual(self.client.post('/api/checkins', headers=self.headers, json={'id': 'e' * 16}).status_code, 422)
        self.assertEqual(self.client.post('/api/checkins/clear', headers=self.headers).status_code, 200)
        self.assertEqual(self.client.get('/api/checkins', headers=self.headers).json()['checkins'], [])

    def test_legacy_database_is_renamed(self):
        import sqlite3
        path = Path(self.tmp.name) / 'legacy.db'
        con = sqlite3.connect(path)
        con.execute('CREATE TABLE astronautas (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL)')
        con.execute("INSERT INTO astronautas VALUES (7, 'Legacy Member')")
        con.execute('CREATE TABLE ai_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, astronaut_id INTEGER NOT NULL, alert_type TEXT NOT NULL, category TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (astronaut_id) REFERENCES astronautas(id))')
        con.commit(); con.close()
        original = self.api.DB_PATH
        try:
            self.api.DB_PATH = path
            self.api.initialize_database()
            names = {a['id']: a['name'] for a in self.client.get('/api/astronauts', headers=self.headers).json()['astronauts']}
            self.assertEqual(names[7], 'Legacy Member')
            with self.api.database() as connection:
                connection.execute("INSERT INTO ai_alerts (astronaut_id, alert_type, category, message, created_at) VALUES (7, 'ok', 'c', 'm', 't')")
        finally:
            self.api.DB_PATH = original

    def test_english_scenarios_and_names(self):
        self.addCleanup((self.api.BASE_DIR/'active_scenario.txt').unlink, missing_ok=True)
        self.assertEqual(self.client.post('/api/scenario', headers=self.headers, json={'scenario':'4'}).json()['active_scenario'], '4')
        self.assertEqual((self.api.BASE_DIR/'active_scenario.txt').read_text(), '4')
        self.assertEqual(self.client.post('/api/scenario', headers=self.headers, json={'scenario':'9'}).status_code, 422)
        roster = self.client.get('/api/astronauts', headers=self.headers).json()['astronauts']
        self.assertEqual({row['id']: row['name'] for row in roster}, {
            1: 'Avery Sinclair', 2: 'Maya Okafor', 3: 'Samir Rahman',
        })
        alerts = self.api.evaluate_alerts(dict(self.prototype, body_temp=39, hydration=50))
        self.assertTrue(any('Elevated body temperature' in message for _, _, message in alerts))
        self.assertTrue(any('Critically low hydration' in message for _, _, message in alerts))


if __name__ == '__main__':
    unittest.main(verbosity=2)
