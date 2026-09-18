#!/usr/bin/env python3
"""
Unit Test Suite for Van50 Hands-Free Daily Automation Engine & Endpoints
Verifies:
- calculate_next_run time math
- create_safety_backup file creation & rotation
- status reading, writing & persistence
- API endpoints: /api/automation/status, /api/automation/toggle, /api/automation/trigger
- Authentication safeguards & unauthorized request rejection
"""

import unittest
import os
import sys
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(BASE_DIR, "scripts")
DATA_DIR = os.path.join(BASE_DIR, "data")
sys.path.insert(0, SCRIPTS_DIR)

import daily_automation
from curator_auth import generate_session_token


class TestDailyAutomationEngine(unittest.TestCase):
    BASE_URL = "http://127.0.0.1:8080"

    @classmethod
    def setUpClass(cls):
        cls.valid_token = generate_session_token()

    def test_01_calculate_next_run(self):
        next_dt = daily_automation.calculate_next_run("04:00")
        self.assertIsInstance(next_dt, datetime)
        self.assertEqual(next_dt.hour, 4)
        self.assertEqual(next_dt.minute, 0)
        self.assertGreaterEqual(next_dt, datetime.now())

    def test_02_create_safety_backup(self):
        backup_filename = daily_automation.create_safety_backup()
        self.assertIsNotNone(backup_filename)
        backup_path = os.path.join(DATA_DIR, "backups", backup_filename)
        self.assertTrue(os.path.exists(backup_path))
        with open(backup_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            self.assertIn("events", data)

    def test_03_status_lifecycle(self):
        test_payload = {
            "testKey": "automation_unit_test",
            "testTimestamp": datetime.now().isoformat()
        }
        daily_automation.update_automation_status(test_payload)
        status = daily_automation.get_automation_status()
        self.assertEqual(status.get("testKey"), "automation_unit_test")
        self.assertIn("updatedAt", status)

    def test_04_api_status_unauthenticated_accessible(self):
        req = urllib.request.Request(f"{self.BASE_URL}/api/automation/status")
        with urllib.request.urlopen(req) as response:
            self.assertEqual(response.status, 200)
            data = json.loads(response.read().decode("utf-8"))
            self.assertIn("automationEnabled", data)
            self.assertIn("nextRunAt", data)

    def test_05_api_trigger_unauthorized(self):
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/automation/trigger",
            data=b"{}",
            headers={"Content-Type": "application/json"}
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 403)

    def test_06_api_toggle_unauthorized(self):
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/automation/toggle",
            data=b"{}",
            headers={"Content-Type": "application/json"}
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 403)

    def test_07_api_toggle_authorized(self):
        # Read initial state
        s_initial = daily_automation.get_automation_status().get("automationEnabled", True)
        
        # Toggle once
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/automation/toggle",
            data=b"{}",
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.valid_token
            }
        )
        with urllib.request.urlopen(req) as response:
            self.assertEqual(response.status, 200)
            data = json.loads(response.read().decode("utf-8"))
            self.assertTrue(data["success"])
            self.assertEqual(data["automationEnabled"], not s_initial)

        # Toggle back to true
        req2 = urllib.request.Request(
            f"{self.BASE_URL}/api/automation/toggle",
            data=b"{}",
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.valid_token
            }
        )
        with urllib.request.urlopen(req2) as response2:
            data2 = json.loads(response2.read().decode("utf-8"))
            self.assertTrue(data2["automationEnabled"])

    def test_08_api_trigger_authorized(self):
        # Trigger endpoint with valid token
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/automation/trigger",
            data=b"{}",
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.valid_token
            }
        )
        try:
            with urllib.request.urlopen(req) as response:
                self.assertEqual(response.status, 200)
                data = json.loads(response.read().decode("utf-8"))
                self.assertTrue(data["success"])
                self.assertIn("timestamp", data)
        except urllib.error.HTTPError as e:
            # 409 Conflict is expected if an automated run is already actively executing
            if e.code == 409:
                err_data = json.loads(e.read().decode("utf-8"))
                self.assertIn("already", err_data.get("error", "").lower())
            else:
                raise


if __name__ == "__main__":
    unittest.main()
