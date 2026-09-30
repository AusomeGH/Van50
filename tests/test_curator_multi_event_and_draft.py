#!/usr/bin/env python3
"""
Test Suite: Curator Draft State Persistence & Interactive Multi-Event Decomposition
Validates:
1. Draft state retention across navigation and accidental dismissals.
2. 'Detect & Split Multiple Events' button integration and AI interpretation.
3. Strict unique title enforcement across all decomposed child events.
4. Preview staging before quarantine submission, ensuring events remain in quarantine for Antigravity review.
"""

import json
import os
import re
import sys
import unittest
import urllib.request
import urllib.error

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
CURATOR_HTML = os.path.join(ROOT_DIR, "curator.html")
CURATOR_JS = os.path.join(ROOT_DIR, "js", "curator.js")

sys.path.insert(0, os.path.join(ROOT_DIR, "scripts"))
from ai_feedback_synthesizer import decompose_multi_events, synthesize_proof_and_comments


class TestCuratorMultiEventAndDraft(unittest.TestCase):
    BASE_URL = "http://127.0.0.1:8080"
    TOKEN = None

    @classmethod
    def setUpClass(cls):
        # Authenticate with curator server to obtain session token
        auth_url = f"{cls.BASE_URL}/api/curator/auth"
        req = urllib.request.Request(
            auth_url,
            data=json.dumps({"password": "Professor-Urban-Freebase9"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        try:
            res = json.loads(urllib.request.urlopen(req, timeout=3).read().decode("utf-8"))
            if res.get("success"):
                cls.TOKEN = res.get("token")
        except Exception as e:
            cls.TOKEN = None

    def test_01_curator_html_contains_draft_and_split_elements(self):
        """curator.html must contain the draft badge, clear button, and multi-event split button."""
        with open(CURATOR_HTML, "r", encoding="utf-8") as f:
            html = f.read()

        self.assertIn("ai-modal-draft-status", html, "Missing #ai-modal-draft-status badge in curator.html")
        self.assertIn("btn-clear-modal-draft", html, "Missing #btn-clear-modal-draft button in curator.html")
        self.assertIn("btn-detect-multiple-events", html, "Missing #btn-detect-multiple-events button in curator.html")
        self.assertIn("Detect &amp; Split Multiple Events", html, "Missing label for multi-event split button")

    def test_02_curator_js_draft_persistence_and_preview_logic(self):
        """js/curator.js contains draft storage functions, interactive multi-event preview, and unique title validator."""
        with open(CURATOR_JS, "r", encoding="utf-8") as f:
            js = f.read()

        # Draft persistence functions
        self.assertIn("saveInstructionDraft", js)
        self.assertIn("loadSavedInstructionDrafts", js)
        self.assertIn("clearInstructionDraft", js)
        self.assertIn("persistInstructionDrafts", js)
        self.assertIn("van50_curator_instruction_drafts", js)

        # Multi-event interactive preview functions
        self.assertIn("renderInteractiveMultiEventPreview", js)
        self.assertIn("attachMultiEventPreviewListeners", js)
        self.assertIn("updateSplitTitleWarnings", js)
        self.assertIn("btn-detect-multiple-events", js)
        self.assertIn("btn-clear-modal-draft", js)
        self.assertIn("Duplicate", js)

    def test_03_ai_feedback_synthesizer_decomposes_with_unique_titles(self):
        """decompose_multi_events decomposes multi-show text and enforces strictly unique event titles."""
        instruction = (
            "This is multiple events:\n"
            "1. Frankie's Early Set - Thursdays at 7pm, $15\n"
            "2. Frankie's Late Jam - Thursdays at 10pm, $10\n"
            "3. Frankie's Early Set - Fridays at 7pm, $20\n"
        )
        card_data = {
            "id": "test-frankies-multi",
            "title": "Frankie's Jazz Club Live Series",
            "venue": "Frankie's Jazz Club",
            "price": 20.0
        }

        sub_events = decompose_multi_events(instruction, [], card_data)
        self.assertGreaterEqual(len(sub_events), 2)

        # Enforce that every single sub-event has a strictly unique title
        titles = [s["title"].lower().strip() for s in sub_events]
        self.assertEqual(len(titles), len(set(titles)), f"Sub-event titles must be unique: {titles}")

        # Check price budgets
        for s in sub_events:
            self.assertLessEqual(s["price"], 50.0)
            self.assertGreaterEqual(s["price"], 0.0)

    def test_04_interpret_instruction_api_with_force_multi_split(self):
        """POST /api/curator/interpret-instruction with forceMultiSplit flag decomposes into discrete events."""
        if not self.TOKEN:
            self.skipTest("Curator server not running or unauthenticated")

        payload = {
            "eventId": "test-guilt-split",
            "instructionText": "Daily sets at Guilt & Company",
            "forceMultiSplit": True,
            "event": {
                "id": "test-guilt-split",
                "title": "Guilt & Company Music Nights",
                "venue": "Guilt & Company",
                "price": 12.0,
                "quarantineReason": "Venue has per-set cover: $7 early acoustic set, $12 late night funk set."
            }
        }

        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/interpret-instruction",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.TOKEN
            }
        )
        res = json.loads(urllib.request.urlopen(req, timeout=5).read().decode("utf-8"))
        self.assertTrue(res.get("success"))
        self.assertTrue(res.get("isMultiEventSplit"))
        sub_events = res.get("subEvents", [])
        self.assertGreaterEqual(len(sub_events), 2)

        # Ensure all titles in interpretation are strictly unique
        titles = [s["title"].lower().strip() for s in sub_events]
        self.assertEqual(len(titles), len(set(titles)), f"Decomposed titles must be distinct: {titles}")

    def test_05_curator_instruction_api_queues_decomposed_events_in_quarantine(self):
        """POST /api/curator/instruction with subEvents decomposes the event into discrete quarantine entries."""
        if not self.TOKEN:
            self.skipTest("Curator server not running or unauthenticated")

        test_parent_id = "test-multi-parent-event"

        # Ensure parent event exists in manual_review_queue.json
        with open(QUEUE_PATH, "r", encoding="utf-8") as f:
            queue_db = json.load(f)

        parent_record = {
            "id": test_parent_id,
            "title": "Multi-Part Comedy Showcase",
            "venue": "Little Mountain Gallery",
            "price": 25.0,
            "category": "shows",
            "dateSchedule": "Friday Oct 2"
        }
        queue_db["quarantinedEvents"] = [e for e in queue_db.get("quarantinedEvents", []) if e.get("id") != test_parent_id]
        queue_db["quarantinedEvents"].append(parent_record)
        with open(QUEUE_PATH, "w", encoding="utf-8") as f:
            json.dump(queue_db, f, indent=2)

        # Submit decomposition instruction with 2 discrete sub-events with unique names
        payload = {
            "eventId": test_parent_id,
            "eventTitle": "Multi-Part Comedy Showcase",
            "venueName": "Little Mountain Gallery",
            "instructionText": "Split this into early improv and late standup.",
            "action": "queue_only",
            "subEvents": [
                {
                    "title": "Little Mountain Gallery - Early Improv Showcase",
                    "price": 12.0,
                    "category": "shows",
                    "dateSchedule": "Friday Oct 2 • 7:00 PM",
                    "venue": "Little Mountain Gallery"
                },
                {
                    "title": "Little Mountain Gallery - Late Night Standup Jam",
                    "price": 15.0,
                    "category": "shows",
                    "dateSchedule": "Friday Oct 2 • 9:30 PM",
                    "venue": "Little Mountain Gallery"
                }
            ]
        }

        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/instruction",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.TOKEN
            }
        )
        res = json.loads(urllib.request.urlopen(req, timeout=5).read().decode("utf-8"))
        self.assertTrue(res.get("success"))

        # Verify in manual_review_queue.json:
        # 1. Parent is removed.
        # 2. Both children are added under pending_antigravity_review.
        # 3. Both children have strictly unique titles.
        with open(QUEUE_PATH, "r", encoding="utf-8") as f:
            updated_queue = json.load(f)

        q_list = updated_queue.get("quarantinedEvents", [])
        parent_in_q = next((e for e in q_list if e.get("id") == test_parent_id), None)
        self.assertIsNone(parent_in_q, "Parent event should be replaced by discrete child events")

        child_events = [e for e in q_list if e.get("parentEventId") == test_parent_id or str(e.get("id", "")).startswith(test_parent_id)]
        self.assertEqual(len(child_events), 2)
        self.assertEqual(child_events[0]["reviewStatus"], "pending_antigravity_review")
        self.assertEqual(child_events[1]["reviewStatus"], "pending_antigravity_review")
        self.assertNotEqual(child_events[0]["title"], child_events[1]["title"])

        # Clean up test events
        updated_queue["quarantinedEvents"] = [e for e in q_list if e.get("id") != test_parent_id and e.get("parentEventId") != test_parent_id and not str(e.get("id", "")).startswith(test_parent_id)]
        with open(QUEUE_PATH, "w", encoding="utf-8") as f:
            json.dump(updated_queue, f, indent=2)


if __name__ == "__main__":
    unittest.main()
