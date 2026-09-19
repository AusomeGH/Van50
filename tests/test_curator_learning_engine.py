#!/usr/bin/env python3
"""
Unit tests for CuratorLearningEngine
Verifies that curator comments and guidance are ingested, policy rules are distilled,
and manual review queue items are automatically triaged.
"""

import unittest
import os
import json
import tempfile
import shutil
from datetime import datetime, timezone

import sys
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))

from curator_learning_engine import CuratorLearningEngine


class TestCuratorLearningEngine(unittest.TestCase):

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.orig_data_dir = os.environ.get("VAN50_DATA_DIR")
        
        # Patch paths inside CuratorLearningEngine
        self.orig_queue_path = CuratorLearningEngine.QUEUE_PATH if hasattr(CuratorLearningEngine, "QUEUE_PATH") else None
        
        self.queue_path = os.path.join(self.test_dir, "manual_review_queue.json")
        self.events_path = os.path.join(self.test_dir, "events.json")
        self.archive_path = os.path.join(self.test_dir, "archived_events.json")
        self.rules_path = os.path.join(self.test_dir, "curator_learned_rules.json")
        self.inst_path = os.path.join(self.test_dir, "curator_instructions.json")

        import curator_learning_engine
        curator_learning_engine.QUEUE_PATH = self.queue_path
        curator_learning_engine.EVENTS_PATH = self.events_path
        curator_learning_engine.ARCHIVE_PATH = self.archive_path
        curator_learning_engine.RULES_PATH = self.rules_path
        curator_learning_engine.INSTRUCTIONS_PATH = self.inst_path

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)
        # Restore original paths
        import curator_learning_engine
        data_dir = os.path.join(BASE_DIR, "data")
        curator_learning_engine.QUEUE_PATH = os.path.join(data_dir, "manual_review_queue.json")
        curator_learning_engine.EVENTS_PATH = os.path.join(data_dir, "events.json")
        curator_learning_engine.ARCHIVE_PATH = os.path.join(data_dir, "archived_events.json")
        curator_learning_engine.RULES_PATH = os.path.join(data_dir, "curator_learned_rules.json")
        curator_learning_engine.INSTRUCTIONS_PATH = os.path.join(data_dir, "curator_instructions.json")

    def test_curator_guidance_auto_triage_archive(self):
        """Verify that an item flagged as 'sold out' or 'fake' is automatically archived."""
        # 1. Setup mock queue
        queue_data = {
            "pendingCount": 1,
            "quarantinedEvents": [
                {
                    "id": "test-soldout-gig-123",
                    "title": "Sold Out Test Concert",
                    "venue": "Test Music Lounge",
                    "price": 25.0
                }
            ]
        }
        with open(self.queue_path, "w", encoding="utf-8") as f:
            json.dump(queue_data, f)

        # 2. Setup mock instructions with curator guidance
        inst_data = {
            "instructions": [
                {
                    "eventId": "test-soldout-gig-123",
                    "venueName": "Test Music Lounge",
                    "instructionText": "This show is completely sold out. Please remove it.",
                    "applied": False
                }
            ]
        }
        with open(self.inst_path, "w", encoding="utf-8") as f:
            json.dump(inst_data, f)

        # 3. Setup empty rules, events, archive
        with open(self.events_path, "w", encoding="utf-8") as f:
            json.dump({"events": []}, f)
        with open(self.archive_path, "w", encoding="utf-8") as f:
            json.dump({"archivedEvents": []}, f)
        with open(self.rules_path, "w", encoding="utf-8") as f:
            json.dump({"archived_event_ids": []}, f)

        # Execute learning engine
        stats = CuratorLearningEngine.process_pending_feedback()

        self.assertEqual(stats["archived"], 1)
        self.assertEqual(stats["instructionsProcessed"], 1)

        # Verify queue was cleared
        with open(self.queue_path, "r", encoding="utf-8") as f:
            updated_queue = json.load(f)
        self.assertEqual(len(updated_queue["quarantinedEvents"]), 0)

        # Verify event was archived
        with open(self.archive_path, "r", encoding="utf-8") as f:
            updated_archive = json.load(f)
        self.assertEqual(len(updated_archive["archivedEvents"]), 1)
        self.assertEqual(updated_archive["archivedEvents"][0]["id"], "test-soldout-gig-123")
        self.assertTrue(updated_archive["archivedEvents"][0].get("isSoldOut"))

        # Verify ID is in rules archived_event_ids
        with open(self.rules_path, "r", encoding="utf-8") as f:
            updated_rules = json.load(f)
        self.assertIn("test-soldout-gig-123", updated_rules["archived_event_ids"])

    def test_distills_venue_policy_and_deep_links(self):
        """Verify that URLs and venue minimum spends are distilled into curator_learned_rules.json."""
        inst_data = {
            "instructions": [
                {
                    "venueName": "Game Night Pub",
                    "instructionText": "Check their calendar here: https://gamenightpub.example.com/events. Note there is a minimum spend of $20 per person.",
                    "applied": False
                }
            ]
        }
        with open(self.inst_path, "w", encoding="utf-8") as f:
            json.dump(inst_data, f)
        with open(self.rules_path, "w", encoding="utf-8") as f:
            json.dump({"venue_calendar_deep_links": {}, "venue_policy_rules": {}}, f)
        with open(self.queue_path, "w", encoding="utf-8") as f:
            json.dump({"quarantinedEvents": []}, f)
        with open(self.events_path, "w", encoding="utf-8") as f:
            json.dump({"events": []}, f)
        with open(self.archive_path, "w", encoding="utf-8") as f:
            json.dump({"archivedEvents": []}, f)

        stats = CuratorLearningEngine.process_pending_feedback()
        self.assertGreater(stats["rulesAdded"], 0)

        with open(self.rules_path, "r", encoding="utf-8") as f:
            rules = json.load(f)
        
        self.assertEqual(rules["venue_calendar_deep_links"].get("Game Night Pub"), "https://gamenightpub.example.com/events")
        self.assertIn("Game Night Pub", rules["venue_policy_rules"])
        self.assertEqual(rules["venue_policy_rules"]["Game Night Pub"]["minimumSpend"], 20.0)


if __name__ == "__main__":
    unittest.main()
