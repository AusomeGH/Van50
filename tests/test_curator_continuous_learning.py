#!/usr/bin/env python3
"""
Unit Test Suite for Curator Continuous Learning & Startup Summary Helper
Verifies:
1. /api/curator/approve records reinforcement learning signals in data/curator_instructions.json
2. scripts/curator_queue_summary.py generates correct metrics
3. curator.html & js/curator.js have 'Approve As-Is' and 'Instruct AI' labels
"""

import unittest
import urllib.request
import urllib.error
import json
import os
import sys
import time

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(ROOT_DIR, "scripts")
DATA_DIR = os.path.join(ROOT_DIR, "data")
INSTRUCTIONS_PATH = os.path.join(DATA_DIR, "curator_instructions.json")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
CURATOR_HTML_PATH = os.path.join(ROOT_DIR, "curator.html")
CURATOR_JS_PATH = os.path.join(ROOT_DIR, "js", "curator.js")

if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from curator_queue_summary import get_queue_summary, format_summary_text


class TestCuratorContinuousLearning(unittest.TestCase):
    BASE_URL = "http://127.0.0.1:8080"
    TOKEN = None

    @classmethod
    def setUpClass(cls):
        req = urllib.request.Request(
            f"{cls.BASE_URL}/api/curator/auth",
            data=json.dumps({"password": "Professor-Urban-Freebase9"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        res = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
        cls.TOKEN = res["token"]

    def test_01_approve_creates_reinforcement_learning_entry(self):
        """Approving an event as-is registers a reinforcement learning record in curator_instructions.json."""
        test_ev_id = f"test-reinforce-{int(time.time())}"
        # Seed test quarantined event
        with open(QUEUE_PATH, "r", encoding="utf-8") as f:
            q_data = json.load(f)
        q_data["quarantinedEvents"].append({
            "id": test_ev_id,
            "title": "Continuous Learning Jazz Showcase",
            "venue": "Frankie's Jazz Club",
            "price": 20.0,
            "priceLabel": "$20.00 door",
            "category": "music",
            "coordinates": [49.281, -123.111],
            "url": "https://frankiesjazzclub.com/events"
        })
        with open(QUEUE_PATH, "w", encoding="utf-8") as f:
            json.dump(q_data, f, indent=2, ensure_ascii=False)

        try:
            # Call approve API
            payload = {
                "event": {
                    "id": test_ev_id,
                    "title": "Continuous Learning Jazz Showcase",
                    "venue": "Frankie's Jazz Club",
                    "price": 20.0,
                    "priceLabel": "$20.00 CAD",
                    "category": "music",
                    "coordinates": [49.281, -123.111],
                    "websiteUrl": "https://frankiesjazzclub.com/events"
                },
                "curatorNote": "Curator verified as-is"
            }
            req = urllib.request.Request(
                f"{self.BASE_URL}/api/curator/approve",
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Curator-Token": self.TOKEN
                }
            )
            res = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
            self.assertTrue(res["success"])
            self.assertIn("queued for ai learning", res["message"].lower())

            # Verify entry exists in curator_instructions.json
            with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
                inst_db = json.load(f)
            saved = next((i for i in inst_db.get("instructions", []) if i.get("eventId") == test_ev_id), None)
            self.assertIsNotNone(saved)
            self.assertEqual(saved["type"], "reinforcement_learning")
            self.assertEqual(saved["actionTaken"], "approved_as_is")
            self.assertEqual(saved["status"], "pending")
            self.assertEqual(saved["approvedPrice"], 20.0)
        finally:
            # Clean up test event from events.json
            with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                ev_db = json.load(f)
            ev_db["events"] = [e for e in ev_db["events"] if e["id"] != test_ev_id]
            ev_db["metadata"]["totalEvents"] = len(ev_db["events"])
            with open(EVENTS_PATH, "w", encoding="utf-8") as f:
                json.dump(ev_db, f, indent=2, ensure_ascii=False)

    def test_02_queue_summary_helper(self):
        """get_queue_summary returns accurate counts and format_summary_text produces markdown."""
        summary = get_queue_summary()
        self.assertIn("pendingTotal", summary)
        self.assertIn("screenshotCount", summary)
        self.assertIn("reinforcementCount", summary)
        self.assertIn("quarantineTotal", summary)
        self.assertGreaterEqual(summary["pendingTotal"], 1)

        text = format_summary_text(summary)
        self.assertIn("Curator Studio Status Report", text)
        self.assertIn("Pending AI Queue Items", text)

    def test_03_ui_button_labels(self):
        """curator.html and curator.js include 'Approve As-Is' and 'Instruct AI' button text."""
        with open(CURATOR_HTML_PATH, "r", encoding="utf-8") as f:
            html_content = f.read()
        self.assertIn("🤖 Instruct AI", html_content)
        self.assertIn("✅ Approve As-Is", html_content)

        with open(CURATOR_JS_PATH, "r", encoding="utf-8") as f:
            js_content = f.read()
        self.assertIn("✅ Approve As-Is", js_content)
        self.assertIn("🤖 Instruct AI", js_content)


if __name__ == "__main__":
    unittest.main()
