#!/usr/bin/env python3
"""
Unit tests for Curator Studio Discovered Venues & Add Venue API.
Verifies authenticated venue enrollment, safety backups, load_venues() integration,
and AI instruction + screenshot queueing with actions (queue_and_approve, queue_only, queue_and_dismiss).
"""

import os
import sys
import json
import unittest
import urllib.request
import urllib.error
import base64
import time

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))

from universal_venue_crawler import UniversalVenueCrawler
import curator_auth

# 1x1 transparent PNG Base64 for testing
TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="


class TestDiscoveredVenuesPipeline(unittest.TestCase):
    BASE_URL = "http://127.0.0.1:8080"
    TOKEN = None

    @classmethod
    def setUpClass(cls):
        # Authenticate to retrieve token
        try:
            req = urllib.request.Request(
                f"{cls.BASE_URL}/api/curator/auth",
                data=json.dumps({"password": "Professor-Urban-Freebase9"}).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            res = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
            cls.TOKEN = res.get("token")
        except Exception as e:
            print(f"[WARN] Failed authenticating against curator_server: {e}")

    def setUp(self):
        self.venues_path = os.path.join(DATA_DIR, "venue_directory.json")
        self.disc_path = os.path.join(DATA_DIR, "discovered_venues.json")
        self.instructions_path = os.path.join(DATA_DIR, "curator_instructions.json")
        
        # Verify files exist
        self.assertTrue(os.path.exists(self.venues_path))
        self.assertTrue(os.path.exists(self.disc_path))

    def test_load_venues_includes_registered_venues(self):
        """Tests that UniversalVenueCrawler.load_venues() loads all venues properly."""
        venues = UniversalVenueCrawler.load_venues()
        self.assertIsInstance(venues, dict)
        self.assertIn("The Rickshaw Theatre", venues)

    def test_discovered_venues_structure(self):
        """Tests that discovered_venues.json has valid structure and pending candidates."""
        with open(self.disc_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        self.assertIn("discoveredVenues", data)
        candidates = data["discoveredVenues"]
        self.assertIsInstance(candidates, list)
        if candidates:
            first = candidates[0]
            self.assertIn("name", first)
            self.assertIn("status", first)
            self.assertIn("discoveredVia", first)

    def test_add_venue_with_instruction_and_screenshots(self):
        """Tests adding a venue with action=queue_and_approve, plain-English instructions and screenshots."""
        if not self.TOKEN:
            self.skipTest("Curator server not running or token unavailable")

        test_venue_name = f"Test QA Cellar {int(time.time())}"
        payload = {
            "name": test_venue_name,
            "address": "123 Test St, Vancouver, BC",
            "calendarUrl": "https://testcellar.example.com/events",
            "neighborhood": "Gastown / Chinatown",
            "category": "music",
            "action": "queue_and_approve",
            "instructionText": "Scrape live jazz sets only. Cover is $15 at door.",
            "screenshotsBase64": [
                f"data:image/png;base64,{TINY_PNG_B64}"
            ]
        }

        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/venues/add",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.TOKEN
            }
        )

        resp = urllib.request.urlopen(req)
        self.assertEqual(resp.status, 200)
        data = json.loads(resp.read().decode("utf-8"))
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("action"), "queue_and_approve")
        self.assertIsNotNone(data.get("instructionId"))
        self.assertTrue(len(data.get("screenshotPaths", [])) > 0)

        # Verify saved screenshot file exists on disk
        saved_shot = data["screenshotPaths"][0]
        full_shot_path = os.path.join(BASE_DIR, saved_shot)
        self.assertTrue(os.path.exists(full_shot_path))

        # Verify venue was enrolled into venue_directory.json
        with open(self.venues_path, "r", encoding="utf-8") as vf:
            v_dir = json.load(vf)
        self.assertIn(test_venue_name, v_dir.get("venues", {}))

        # Verify instruction was recorded in curator_instructions.json
        with open(self.instructions_path, "r", encoding="utf-8") as inf:
            inst_db = json.load(inf)
        matched_inst = next((i for i in inst_db.get("instructions", []) if i.get("id") == data["instructionId"]), None)
        self.assertIsNotNone(matched_inst)
        self.assertEqual(matched_inst["venueName"], test_venue_name)
        self.assertEqual(matched_inst["actionTaken"], "queue_and_approve")

        # Cleanup test venue and screenshot
        del v_dir["venues"][test_venue_name]
        v_dir["metadata"]["totalVenues"] = len(v_dir["venues"])
        with open(self.venues_path, "w", encoding="utf-8") as vf:
            json.dump(v_dir, vf, indent=2, ensure_ascii=False)
        try:
            os.remove(full_shot_path)
        except Exception:
            pass

    def test_add_venue_queue_only(self):
        """Tests action=queue_only: records instruction and screenshots without enrolling into directory."""
        if not self.TOKEN:
            self.skipTest("Curator server not running or token unavailable")

        test_venue_name = f"Pending Venue Candidate {int(time.time())}"
        payload = {
            "name": test_venue_name,
            "address": "456 Pending Ave, Vancouver, BC",
            "calendarUrl": "https://pendingvenue.example.com",
            "neighborhood": "Mount Pleasant",
            "category": "shows",
            "action": "queue_only",
            "instructionText": "Wait for season schedule announcement before scraping.",
            "screenshotsBase64": [
                f"data:image/png;base64,{TINY_PNG_B64}"
            ]
        }

        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/venues/add",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.TOKEN
            }
        )

        resp = urllib.request.urlopen(req)
        self.assertEqual(resp.status, 200)
        data = json.loads(resp.read().decode("utf-8"))
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("action"), "queue_only")
        self.assertIsNotNone(data.get("instructionId"))

        # Verify venue was NOT added to venue_directory.json
        with open(self.venues_path, "r", encoding="utf-8") as vf:
            v_dir = json.load(vf)
        self.assertNotIn(test_venue_name, v_dir.get("venues", {}))

        # Cleanup saved screenshot
        if data.get("screenshotPaths"):
            for sp in data["screenshotPaths"]:
                try:
                    os.remove(os.path.join(BASE_DIR, sp))
                except Exception:
                    pass

    def test_add_venue_dismiss_with_instruction(self):
        """Tests action=queue_and_dismiss: dismisses candidate and records AI feedback."""
        if not self.TOKEN:
            self.skipTest("Curator server not running or token unavailable")

        # Temporarily insert dummy candidate into discovered_venues.json
        dummy_id = f"discovered-dummy-{int(time.time())}"
        dummy_name = f"Dummy Private Hall {int(time.time())}"
        with open(self.disc_path, "r", encoding="utf-8") as df:
            disc_data = json.load(df)
        disc_data.setdefault("discoveredVenues", []).append({
            "id": dummy_id,
            "name": dummy_name,
            "address": "789 Private Way, Vancouver, BC",
            "status": "pending",
            "discoveredVia": "Unit Test"
        })
        with open(self.disc_path, "w", encoding="utf-8") as df:
            json.dump(disc_data, df, indent=2, ensure_ascii=False)

        payload = {
            "discoveredId": dummy_id,
            "name": dummy_name,
            "action": "queue_and_dismiss",
            "instructionText": "This venue is strictly private rentals, never public shows."
        }

        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/venues/add",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.TOKEN
            }
        )

        resp = urllib.request.urlopen(req)
        self.assertEqual(resp.status, 200)
        data = json.loads(resp.read().decode("utf-8"))
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("action"), "queue_and_dismiss")

        # Verify candidate in discovered_venues.json is marked as dismissed
        with open(self.disc_path, "r", encoding="utf-8") as df:
            updated_disc = json.load(df)
        found = next((item for item in updated_disc.get("discoveredVenues", []) if item.get("id") == dummy_id), None)
        self.assertIsNotNone(found)
        self.assertEqual(found.get("status"), "dismissed")

        # Clean up dummy entry
        updated_disc["discoveredVenues"] = [item for item in updated_disc["discoveredVenues"] if item.get("id") != dummy_id]
        with open(self.disc_path, "w", encoding="utf-8") as df:
            json.dump(updated_disc, df, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    unittest.main()
