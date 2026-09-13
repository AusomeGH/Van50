#!/usr/bin/env python3
"""
Unit Test Suite for Van50 Curator Studio, Authentication,
and Algorithmic Self-Learning Engine.
"""

import unittest
import os
import sys
import json
import shutil
import tempfile

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT_DIR, "scripts"))

from curator_auth import (
    verify_curator_password,
    generate_session_token,
    verify_session_token,
    LOGIN_ATTEMPTS,
    MAX_FAILED_ATTEMPTS
)
from pricing_search_engine import EventPricingSearchEngine, CourseDropInClassifier, load_curator_learned_rules
from universal_venue_crawler import UniversalVenueCrawler


class TestCuratorSystem(unittest.TestCase):

    def setUp(self):
        # Clear login attempt counters before each test
        LOGIN_ATTEMPTS.clear()

    def test_01_password_verification(self):
        """Verifies that the user's password succeeds and wrong passwords fail."""
        ok, msg, _ = verify_curator_password("Professor-Urban-Freebase9", "127.0.0.1")
        self.assertTrue(ok, f"Expected successful password authentication, got: {msg}")

        bad_ok, bad_msg, remaining = verify_curator_password("wrong-passphrase", "127.0.0.1")
        self.assertFalse(bad_ok)
        self.assertEqual(remaining, MAX_FAILED_ATTEMPTS - 1)

    def test_02_brute_force_lockout(self):
        """Verifies that 5 consecutive failed login attempts trigger a 15-minute lockout."""
        test_ip = "192.168.1.100"
        for i in range(MAX_FAILED_ATTEMPTS):
            ok, msg, _ = verify_curator_password("bad-pass", test_ip)
            self.assertFalse(ok)

        # 6th attempt should be locked out
        locked_ok, locked_msg, cooldown = verify_curator_password("Professor-Urban-Freebase9", test_ip)
        self.assertFalse(locked_ok)
        self.assertIn("locked out", locked_msg.lower())
        self.assertGreater(cooldown, 0)

    def test_03_hmac_session_tokens(self):
        """Verifies generation, verification, and tamper detection of bearer session tokens."""
        token = generate_session_token()
        self.assertIsInstance(token, str)
        self.assertIn(".", token)

        valid, msg = verify_session_token(token)
        self.assertTrue(valid, f"Expected valid token, got: {msg}")

        # Tampered token
        tampered = token[:-4] + "ABCD"
        t_valid, t_msg = verify_session_token(tampered)
        self.assertFalse(t_valid)
        self.assertIn("signature", t_msg.lower())

    def test_04_learned_rules_presence(self):
        """Verifies that data/curator_learned_rules.json exists with valid structure."""
        rules_path = os.path.join(ROOT_DIR, "data", "curator_learned_rules.json")
        self.assertTrue(os.path.exists(rules_path), "curator_learned_rules.json missing")
        with open(rules_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertIn("vendor_fee_formulas", data)
        self.assertIn("venue_calendar_deep_links", data)
        self.assertIn("course_blacklist_patterns", data)

    def test_05_course_drop_in_learned_disqualification(self):
        """Verifies that CourseDropInClassifier automatically disqualifies events matching learned patterns."""
        sample_course = {
            "id": "test-multiweek-pottery",
            "title": "8-Week Pottery Intensive for Beginners",
            "venue": "Test Ceramic Arts",
            "price": 35.0,
            "description": "A comprehensive multi-week class."
        }
        res = CourseDropInClassifier.evaluate(sample_course)
        self.assertFalse(res["eligible"])
        self.assertTrue(any(k in res["reason"].lower() for k in ["multi-week", "learned", "intensive"]))

    def test_06_pricing_engine_learned_fee_formula(self):
        """Verifies that EventPricingSearchEngine applies learned vendor fee formulas on unverified items."""
        sample_event = {
            "id": "test-learned-customtickets-show",
            "title": "Indie Band Showcase at The Biltmore",
            "venue": "The Biltmore Cabaret",
            "provider": "CustomTickets",
            "websiteUrl": "https://customtickets.ca/events/test-show-12345",
            "price": 15.0,
            "attemptedPrice": 15.0
        }
        # In curator_learned_rules.json, customtickets.ca has feeFixed: 2.50, feePercent: 0.05
        # Expected price: 15.0 * 1.05 + 2.50 = 15.75 + 2.50 = $18.25 CAD
        outcome = EventPricingSearchEngine.search_and_verify(sample_event)
        self.assertTrue(outcome["isVerified"], f"Expected event to be verified via learned fee formula, got: {outcome}")
        self.assertEqual(outcome["finalPrice"], 18.25)
        self.assertEqual(outcome["verification"]["method"], "curator_learned_fee_formula")
        self.assertIn("learned customtickets.ca formula", outcome["verification"]["feeBreakdown"].lower())

    def test_07_universal_venue_crawler_loads_learned_deep_links(self):
        """Verifies that UniversalVenueCrawler incorporates learned calendar deep links."""
        venues = UniversalVenueCrawler.load_venues()
        self.assertIn("The Fox Cabaret", venues)
        # Verify calendarUrl was overlaid or retained
        self.assertIsNotNone(venues["The Fox Cabaret"].get("calendarUrl"))


if __name__ == "__main__":
    unittest.main()
