#!/usr/bin/env python3
"""
Unit Test Suite for Curator AI Instructions API & Screenshot Queue
Verifies endpoint security, plain-English instruction queueing,
screenshot base64 decoding/persistence, and quick-approval dual-actions.
"""

import unittest
import urllib.request
import urllib.error
import json
import base64
import os
import time

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")
INSTRUCTIONS_PATH = os.path.join(DATA_DIR, "curator_instructions.json")
SCREENSHOTS_DIR = os.path.join(DATA_DIR, "curator_screenshots")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")


class TestCuratorInstructionsAPI(unittest.TestCase):
    BASE_URL = "http://127.0.0.1:8080"
    TOKEN = None

    @classmethod
    def setUpClass(cls):
        # Authenticate to retrieve token
        req = urllib.request.Request(
            f"{cls.BASE_URL}/api/curator/auth",
            data=json.dumps({"password": "Professor-Urban-Freebase9"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        res = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
        cls.TOKEN = res["token"]

    def test_01_unauthenticated_blocked(self):
        """Unauthenticated requests to instructions endpoints are rejected with 401/403."""
        req_get = urllib.request.Request(f"{self.BASE_URL}/api/curator/instructions")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req_get)
        self.assertIn(ctx.exception.code, [401, 403])

        req_post = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/instruction",
            data=json.dumps({"instructionText": "Test instruction"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req_post)
        self.assertIn(ctx.exception.code, [401, 403])

    def test_02_validation_missing_text(self):
        """Posting without instructionText returns 400 Bad Request."""
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/instruction",
            data=json.dumps({"instructionText": "   "}).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.TOKEN
            }
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 400)

    def test_03_queue_only_instruction(self):
        """Curator can queue plain-English instructions without coding."""
        payload = {
            "eventId": "test-crawl-flag-01",
            "eventTitle": "Live Comedy Jam",
            "venueName": "Little Mountain Gallery",
            "sourceUrl": "https://littlemountaingallery.ca/events",
            "instructionText": "The scraper missed the $15 Early Bird student tier at the bottom of the page.",
            "action": "queue_only"
        }
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/instruction",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.TOKEN
            }
        )
        res = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
        self.assertTrue(res["success"])
        self.assertIn("instructionId", res)
        self.assertEqual(res["action"], "queue_only")

        # Verify saved in data/curator_instructions.json
        with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
            db = json.load(f)
        saved = next((i for i in db["instructions"] if i["id"] == res["instructionId"]), None)
        self.assertIsNotNone(saved)
        self.assertEqual(saved["instructionText"], payload["instructionText"])
        self.assertEqual(saved["status"], "pending")

    def test_04_queue_instruction_with_screenshot(self):
        """Curator can attach or paste a screenshot (Base64), which is saved to data/curator_screenshots/."""
        # 1x1 transparent PNG data URI
        sample_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        payload = {
            "eventId": "test-crawl-flag-02",
            "eventTitle": "Jazz Trio Night",
            "venueName": "Frankie's Jazz Club",
            "sourceUrl": "https://frankiesjazzclub.com",
            "instructionText": "Screenshot proves ticket price is $20 at door not $60.",
            "screenshotBase64": sample_b64,
            "action": "queue_only"
        }
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/instruction",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.TOKEN
            }
        )
        res = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
        self.assertTrue(res["success"])

        # Verify screenshot file was created on disk
        with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
            db = json.load(f)
        saved = next((i for i in db["instructions"] if i["id"] == res["instructionId"]), None)
        self.assertIsNotNone(saved)
        self.assertIsNotNone(saved["screenshotPath"])
        self.assertTrue(os.path.exists(os.path.join(ROOT_DIR, saved["screenshotPath"])))

    def test_05_queue_and_approve_with_curator_snapshot(self):
        """Queue & Approve immediately promotes event to catalog with curatorSnapshot while queueing instructions."""
        test_ev_id = f"test-qa-event-{int(time.time())}"
        # Seed into manual_review_queue.json
        with open(QUEUE_PATH, "r", encoding="utf-8") as f:
            q_data = json.load(f)
        q_data["quarantinedEvents"].append({
            "id": test_ev_id,
            "title": "Dual Action Test Event",
            "venue": "Rickshaw Theatre",
            "price": 25.0,
            "category": "shows",
            "websiteUrl": "https://rickshawtheatre.com/test-event"
        })
        with open(QUEUE_PATH, "w", encoding="utf-8") as f:
            json.dump(q_data, f, indent=2)

        payload = {
            "eventId": test_ev_id,
            "instructionText": "Fix scraper to target General Admission tier.",
            "action": "queue_and_approve",
            "approvedPrice": 25.00,
            "approvedCategory": "shows",
            "curatorNote": "Curator verified door price"
        }
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/instruction",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.TOKEN
            }
        )
        res = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
        self.assertTrue(res["success"])
        self.assertIn("approved", res["message"].lower())

        # Verify event was added to events.json with curatorSnapshot
        with open(EVENTS_PATH, "r", encoding="utf-8") as f:
            events_db = json.load(f)
        approved_ev = next((e for e in events_db["events"] if e["id"] == test_ev_id), None)
        self.assertIsNotNone(approved_ev)
        self.assertEqual(approved_ev["price"], 25.0)
        self.assertIn("curatorSnapshot", approved_ev["checkoutVerification"])
        snap = approved_ev["checkoutVerification"]["curatorSnapshot"]
        self.assertEqual(snap["approvedPrice"], 25.0)
        self.assertEqual(snap["curatorNote"], "Curator verified door price")

        # Cleanup test event
        events_db["events"] = [e for e in events_db["events"] if e["id"] != test_ev_id]
        with open(EVENTS_PATH, "w", encoding="utf-8") as f:
            json.dump(events_db, f, indent=2)

    def test_06_get_instructions_and_status_count(self):
        """GET /api/curator/instructions and status endpoint report pending counts."""
        req_inst = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/instructions",
            headers={"Curator-Token": self.TOKEN}
        )
        inst_res = json.loads(urllib.request.urlopen(req_inst).read().decode("utf-8"))
        self.assertIn("instructions", inst_res)
        self.assertGreaterEqual(len(inst_res["instructions"]), 2)

        req_status = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/status",
            headers={"Curator-Token": self.TOKEN}
        )
        status_res = json.loads(urllib.request.urlopen(req_status).read().decode("utf-8"))
        self.assertIn("instructionsPendingCount", status_res)
        self.assertGreaterEqual(status_res["instructionsPendingCount"], 2)

    def test_07_multiple_screenshots_queue(self):
        """Curator can attach multiple screenshots, saved and tracked in screenshotPaths."""
        sample_b64_1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        sample_b64_2 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAE4wH5pZqYFAAAAABJRU5ErkJggg=="
        payload = {
            "eventId": "test-crawl-flag-03",
            "eventTitle": "Multi-Image Proof Event",
            "venueName": "Fox Cabaret",
            "instructionText": "Attached 2 screenshots: one showing the poster price, one showing checkout tier.",
            "screenshotsBase64": [sample_b64_1, sample_b64_2],
            "action": "queue_only"
        }
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/instruction",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.TOKEN
            }
        )
        res = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
        self.assertTrue(res["success"])
        self.assertIn("screenshotPaths", res)
        self.assertEqual(len(res["screenshotPaths"]), 2)
        self.assertEqual(res["screenshotPath"], res["screenshotPaths"][0])

        # Verify disk persistence for both files
        for p in res["screenshotPaths"]:
            self.assertTrue(os.path.exists(os.path.join(ROOT_DIR, p)))

        # Verify record in curator_instructions.json
        with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
            db = json.load(f)
        saved = next((i for i in db["instructions"] if i["id"] == res["instructionId"]), None)
        self.assertIsNotNone(saved)
        self.assertEqual(saved["screenshotCount"], 2)
        self.assertEqual(len(saved["screenshotPaths"]), 2)
        self.assertTrue(saved["hasScreenshot"])

    def test_08_interpret_instruction_valid_event_with_link_and_card_preview(self):
        """AI Assistant parses notes, extracts dropped ticketing links, and generates a valid card preview under $50."""
        payload = {
            "eventId": "test-interpret-01",
            "instructionText": "Title is 'East Van Indie Comedy', happening Saturday at 8pm. Door rate is $15. Ticket link: https://www.eventbrite.com/e/east-van-indie-comedy-tickets-99999",
            "venueName": "Fox Cabaret"
        }
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/interpret-instruction",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.TOKEN
            }
        )
        res = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
        self.assertTrue(res["success"])
        self.assertTrue(res["isValid"], "Event under $50 should be evaluated as valid")
        self.assertEqual(res["intendedAction"], "approve")
        self.assertEqual(res["extractedPrice"], 15.0)
        self.assertEqual(res["extractedTitle"], "East Van Indie Comedy")

        # Verify parsed links
        links = res.get("parsedLinks", [])
        self.assertGreaterEqual(len(links), 1)
        self.assertEqual(links[0]["provider"], "Eventbrite")
        self.assertEqual(links[0]["url"], "https://www.eventbrite.com/e/east-van-indie-comedy-tickets-99999")

        # Verify live card preview
        preview = res.get("cardPreview", {})
        self.assertEqual(preview["title"], "East Van Indie Comedy")
        self.assertEqual(preview["price"], 15.0)
        self.assertEqual(preview["provider"], "Eventbrite")
        self.assertEqual(preview["websiteUrl"], "https://www.eventbrite.com/e/east-van-indie-comedy-tickets-99999")

    def test_09_interpret_instruction_dismiss_price_over_50(self):
        """AI Assistant evaluates events over $50 as invalid and generates dismissal explanation."""
        payload = {
            "eventId": "test-interpret-02",
            "instructionText": "The tickets cost $65 CAD plus taxes. Please dismiss.",
            "venueName": "Commodore Ballroom"
        }
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/interpret-instruction",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.TOKEN
            }
        )
        res = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
        self.assertTrue(res["success"])
        self.assertFalse(res["isValid"], "Event over $50 must be evaluated as invalid")
        self.assertEqual(res["intendedAction"], "dismiss")
        self.assertIn("exceeds strict Van50 $50 budget limit", res["dismissReason"])

    def test_10_interpret_instruction_dismiss_keyword(self):
        """AI Assistant detects curator intent to dismiss (e.g. private event or multi-week course)."""
        payload = {
            "eventId": "test-interpret-03",
            "instructionText": "This venue is private bookings only, please ignore and skip.",
            "venueName": "Private Loft"
        }
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/interpret-instruction",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Curator-Token": self.TOKEN
            }
        )
        res = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
        self.assertTrue(res["success"])
        self.assertFalse(res["isValid"])
        self.assertEqual(res["intendedAction"], "dismiss")
        self.assertIn("requested dismissal", res["dismissReason"])

    def test_11_main_page_two_buttons_only(self):
        """Main review queue cards in js/curator.js render strictly Instruct AI and Dismiss buttons."""
        curator_js_path = os.path.join(ROOT_DIR, "js", "curator.js")
        with open(curator_js_path, "r", encoding="utf-8") as f:
            js = f.read()

        # Check that the card actions template has Instruct AI and Dismiss
        self.assertIn("🤖 Instruct AI", js)
        self.assertIn("🚫 Dismiss", js)
        self.assertIn("strictly 2 action buttons", js)

        # Check no automatic file picker click in setModalViewMode
        self.assertNotIn("fileInput.click()", js.split("window.setModalViewMode")[1].split("window.openAIInstructionModal")[0])


if __name__ == "__main__":
    unittest.main()
