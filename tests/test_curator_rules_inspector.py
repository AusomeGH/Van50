#!/usr/bin/env python3
"""
Unit Test Suite: Curator Learned Rules & AI Instructions Inspector / Editor
Verifies:
1. Header stat badges exist with interactive pill styling.
2. Learned Rules modal exists with search, category tabs, item list, and edit panel.
3. AI Instructions modal exists with search, status filters, item list, and edit panel.
4. API endpoints for updating and deleting rules and instructions work correctly.
5. No blocking dialogs (confirm/alert) exist in js/curator.js.
"""

import unittest
import urllib.request
import urllib.error
import json
import os

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RULES_PATH = os.path.join(ROOT_DIR, "data", "curator_learned_rules.json")
INSTRUCTIONS_PATH = os.path.join(ROOT_DIR, "data", "curator_instructions.json")
CURATOR_HTML_PATH = os.path.join(ROOT_DIR, "curator.html")
CURATOR_JS_PATH = os.path.join(ROOT_DIR, "js", "curator.js")
CURATOR_CSS_PATH = os.path.join(ROOT_DIR, "css", "curator.css")


class TestCuratorRulesInspector(unittest.TestCase):
    BASE_URL = "http://127.0.0.1:8080"
    TOKEN = None

    @classmethod
    def setUpClass(cls):
        req = urllib.request.Request(
            f"{cls.BASE_URL}/api/curator/auth",
            data=json.dumps({"password": "Professor-Urban-Freebase9"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        try:
            res = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
            cls.TOKEN = res.get("token")
        except Exception:
            cls.TOKEN = None

    def test_01_html_contains_inspector_modals_and_clickable_badges(self):
        """Verify curator.html contains clickable badges and inspector modal markup."""
        with open(CURATOR_HTML_PATH, "r", encoding="utf-8") as f:
            html = f.read()

        self.assertIn('id="stat-rules-pill"', html)
        self.assertIn('id="stat-instructions-pill"', html)
        self.assertIn('id="learned-rules-modal"', html)
        self.assertIn('id="ai-instructions-modal"', html)
        self.assertIn('id="rules-search-input"', html)
        self.assertIn('id="instructions-search-input"', html)
        self.assertIn('id="rules-list-container"', html)
        self.assertIn('id="instructions-list-container"', html)
        self.assertIn('id="rule-edit-panel"', html)
        self.assertIn('id="instruction-edit-panel"', html)

    def test_02_css_contains_clickable_pill_and_modal_card_styles(self):
        """Verify css/curator.css defines styles for clickable pills and rule item cards."""
        with open(CURATOR_CSS_PATH, "r", encoding="utf-8") as f:
            css = f.read()

        self.assertIn(".clickable-pill", css)
        self.assertIn(".manager-modal-card", css)
        self.assertIn(".rule-item-card", css)
        self.assertIn(".rule-edit-panel", css)

    def test_03_js_contains_modal_handlers_and_zero_blocking_dialogs(self):
        """Verify js/curator.js exposes modal handlers and adheres to zero blocking dialogs."""
        with open(CURATOR_JS_PATH, "r", encoding="utf-8") as f:
            js = f.read()

        self.assertIn("openLearnedRulesModal", js)
        self.assertIn("openAIInstructionsModal", js)
        self.assertIn("renderRulesList", js)
        self.assertIn("renderInstructionsList", js)
        self.assertIn("deleteRule", js)
        self.assertIn("deleteInstruction", js)
        self.assertNotIn("confirm(", js)
        self.assertNotIn("alert(", js)

    def test_04_rules_api_get_and_crud(self):
        """Verify GET, POST /update, and POST /delete for curator rules."""
        if not self.TOKEN:
            self.skipTest("Curator server not running or auth failed")

        # 1. GET rules
        req_get = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/rules",
            headers={"Curator-Token": self.TOKEN}
        )
        res_get = json.loads(urllib.request.urlopen(req_get).read().decode("utf-8"))
        self.assertIn("venue_policy_rules", res_get)
        self.assertIn("venue_calendar_deep_links", res_get)
        self.assertIn("vendor_fee_formulas", res_get)

        # 2. Update a test rule
        test_venue = "Inspector Test Venue"
        req_update = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/rules/update",
            data=json.dumps({
                "ruleType": "venue_policy_rules",
                "key": test_venue,
                "value": {
                    "pricingType": "door-cover",
                    "doorPrice": 20.0,
                    "curatorGuidance": "Test guidance for inspector suite",
                    "calendarUrl": "https://test.example.com"
                }
            }).encode("utf-8"),
            headers={"Content-Type": "application/json", "Curator-Token": self.TOKEN}
        )
        res_update = json.loads(urllib.request.urlopen(req_update).read().decode("utf-8"))
        self.assertTrue(res_update.get("success"))

        # Verify disk persistence
        with open(RULES_PATH, "r", encoding="utf-8") as f:
            saved_rules = json.load(f)
        self.assertIn(test_venue, saved_rules.get("venue_policy_rules", {}))

        # 3. Delete the test rule
        req_del = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/rules/delete",
            data=json.dumps({
                "ruleType": "venue_policy_rules",
                "key": test_venue
            }).encode("utf-8"),
            headers={"Content-Type": "application/json", "Curator-Token": self.TOKEN}
        )
        res_del = json.loads(urllib.request.urlopen(req_del).read().decode("utf-8"))
        self.assertTrue(res_del.get("success"))

        # Verify deletion from disk
        with open(RULES_PATH, "r", encoding="utf-8") as f:
            final_rules = json.load(f)
        self.assertNotIn(test_venue, final_rules.get("venue_policy_rules", {}))

    def test_05_instructions_api_update_and_delete(self):
        """Verify update and delete endpoints for curator AI instructions."""
        if not self.TOKEN:
            self.skipTest("Curator server not running or auth failed")

        # 1. Create a test instruction first
        req_create = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/instruction",
            data=json.dumps({
                "instructionText": "Instruction to be updated by test suite",
                "curatorNote": "Initial test note",
                "venueName": "Inspector Suite Test Hall",
                "action": "queue_only"
            }).encode("utf-8"),
            headers={"Content-Type": "application/json", "Curator-Token": self.TOKEN}
        )
        res_create = json.loads(urllib.request.urlopen(req_create).read().decode("utf-8"))
        self.assertTrue(res_create.get("success"))
        inst_id = res_create["instructionId"]

        # 2. Update the instruction
        req_update = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/instructions/update",
            data=json.dumps({
                "id": inst_id,
                "instructionText": "Corrected instruction text from inspector test",
                "curatorNote": "Updated note",
                "status": "resolved"
            }).encode("utf-8"),
            headers={"Content-Type": "application/json", "Curator-Token": self.TOKEN}
        )
        res_update = json.loads(urllib.request.urlopen(req_update).read().decode("utf-8"))
        self.assertTrue(res_update.get("success"))

        # Check disk persistence
        with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
            db = json.load(f)
        inst_item = next((i for i in db.get("instructions", []) if i["id"] == inst_id), None)
        self.assertIsNotNone(inst_item)
        self.assertEqual(inst_item["instructionText"], "Corrected instruction text from inspector test")
        self.assertEqual(inst_item["status"], "resolved")

        # 3. Delete the instruction
        req_del = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/instructions/delete",
            data=json.dumps({"id": inst_id}).encode("utf-8"),
            headers={"Content-Type": "application/json", "Curator-Token": self.TOKEN}
        )
        res_del = json.loads(urllib.request.urlopen(req_del).read().decode("utf-8"))
        self.assertTrue(res_del.get("success"))

        # Check disk deletion
        with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
            db_final = json.load(f)
        deleted_item = next((i for i in db_final.get("instructions", []) if i["id"] == inst_id), None)
        self.assertIsNone(deleted_item)


if __name__ == "__main__":
    unittest.main()
