#!/usr/bin/env python3
"""
Unit Test Suite for Curator AI Venue Learning & Directory Enrollment.
Verifies:
1. distill_venue_learned_rules extracts pricing, schedule, genres, and calendar URLs from curator comments
2. apply_distilled_venue_rules persists rules to curator_learned_rules.json and venue_directory.json
3. The Waldorf and The Cobalt are registered with valid invariants in venue_directory.json
4. UniversalVenueCrawler overlays venue policies and doors properly
5. EventPricingSearchEngine verifies events adhering to learned venue door policies
"""

import os
import sys
import json
import unittest
import time
from datetime import datetime, timezone

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(ROOT_DIR, "scripts")
DATA_DIR = os.path.join(ROOT_DIR, "data")

if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from curator_server import distill_venue_learned_rules, apply_distilled_venue_rules
from universal_venue_crawler import UniversalVenueCrawler
from pricing_search_engine import EventPricingSearchEngine, load_curator_learned_rules


class TestCuratorVenueLearning(unittest.TestCase):

    def setUp(self):
        self.venues_path = os.path.join(DATA_DIR, "venue_directory.json")
        self.rules_path = os.path.join(DATA_DIR, "curator_learned_rules.json")
        self.assertTrue(os.path.exists(self.venues_path))
        self.assertTrue(os.path.exists(self.rules_path))

    def test_01_distill_venue_learned_rules_pricing(self):
        """Verifies accurate price, range, and free admission distillation from plain-English."""
        # Range & days
        r1 = distill_venue_learned_rules(
            venue_name="The Waldorf",
            calendar_url="https://atthewaldorf.com/events",
            instruction_text="Live music and DJ nights at Tiki Bar and Tabu. Tickets usually $10-$20. Shows run Thursdays through Sundays. Never over $30."
        )
        self.assertEqual(r1["doorPrice"], 20.0)
        self.assertEqual(r1["priceRange"], [10.0, 20.0])
        self.assertEqual(r1["pricingType"], "door-cover")
        self.assertEqual(r1["priceCeiling"], 30.0)
        self.assertEqual(r1["scheduleDays"], ["thu", "fri", "sat", "sun"])
        self.assertIn("dj", r1["genres"])
        self.assertIn("tiki", r1["genres"])
        self.assertIn("Cover $10-$20", r1["summary"])

        # Exact door cover & URL in comments
        r2 = distill_venue_learned_rules(
            venue_name="The Cobalt",
            calendar_url="",
            instruction_text="Historic Main St punk and metal venue. Door cover is $15 at the door. Calendar is at https://thecobalt.ca/events. Fridays and Saturdays."
        )
        self.assertEqual(r2["doorPrice"], 15.0)
        self.assertEqual(r2["pricingType"], "door-cover")
        self.assertEqual(r2["calendarUrl"], "https://thecobalt.ca/events")
        self.assertEqual(r2["scheduleDays"], ["fri", "sat"])
        self.assertIn("punk", r2["genres"])
        self.assertIn("metal", r2["genres"])
        self.assertIn("Door Cover $15.00", r2["summary"])

        # Free admission
        r3 = distill_venue_learned_rules(
            venue_name="Granville Island Free Stage",
            instruction_text="Outdoor community stage with free admission for all ages on weekends."
        )
        self.assertEqual(r3["doorPrice"], 0.0)
        self.assertTrue(r3["isFree"])
        self.assertEqual(r3["pricingType"], "free")
        self.assertEqual(r3["scheduleDays"], ["fri", "sat", "sun"])
        self.assertIn("Free Admission ($0)", r3["summary"])

        # Minimum spend
        r4 = distill_venue_learned_rules(
            venue_name="Board Game Tavern",
            instruction_text="Walk-in table games, minimum spend of $20 for food and drinks on Tuesdays."
        )
        self.assertEqual(r4["minimumSpend"], 20.0)
        self.assertEqual(r4["pricingType"], "minimum-spend")
        self.assertEqual(r4["scheduleDays"], ["tue"])

    def test_02_apply_distilled_venue_rules_persistence(self):
        """Verifies that apply_distilled_venue_rules updates learned rules and directory."""
        test_venue = f"Test AI Lab {int(time.time())}"
        distilled = distill_venue_learned_rules(
            venue_name=test_venue,
            calendar_url="https://testailab.example.com/calendar",
            instruction_text="Underground indie rock showcase. Door cover $12.00, Thursdays and Fridays.",
            category="music"
        )
        # Register in directory first
        with open(self.venues_path, "r", encoding="utf-8") as f:
            vd = json.load(f)
        vd.setdefault("venues", {})[test_venue] = {
            "venueId": "test-ai-lab",
            "name": test_venue,
            "address": "999 Test Way, Vancouver",
            "category": "music",
            "venueUrl": "https://testailab.example.com",
            "calendarUrl": "https://testailab.example.com/calendar"
        }
        with open(self.venues_path, "w", encoding="utf-8") as f:
            json.dump(vd, f, indent=2)

        try:
            apply_distilled_venue_rules(distilled, instruction_id="inst_test_999")

            # Verify in curator_learned_rules.json
            with open(self.rules_path, "r", encoding="utf-8") as f:
                rules = json.load(f)
            self.assertIn(test_venue, rules.get("venue_policy_rules", {}))
            v_pol = rules["venue_policy_rules"][test_venue]
            self.assertEqual(v_pol["doorPrice"], 12.0)
            self.assertEqual(v_pol["scheduleDays"], ["thu", "fri"])
            self.assertIn("indie rock", v_pol["genres"])
            self.assertEqual(rules.get("venue_calendar_deep_links", {}).get(test_venue), "https://testailab.example.com/calendar")

            # Verify in venue_directory.json
            with open(self.venues_path, "r", encoding="utf-8") as f:
                vd_updated = json.load(f)
            saved_v = vd_updated["venues"][test_venue]
            self.assertEqual(saved_v["doorCover"], 12.0)
            self.assertEqual(saved_v["operatingDays"], ["thu", "fri"])
            self.assertIn("indie rock", saved_v.get("subTags", []))
            self.assertIn("Door Cover $12.00", saved_v.get("policySummary", ""))
        finally:
            # Clean up test venue
            with open(self.venues_path, "r", encoding="utf-8") as f:
                vd_clean = json.load(f)
            vd_clean.setdefault("venues", {}).pop(test_venue, None)
            with open(self.venues_path, "w", encoding="utf-8") as f:
                json.dump(vd_clean, f, indent=2)
            with open(self.rules_path, "r", encoding="utf-8") as f:
                rules_clean = json.load(f)
            rules_clean.get("venue_policy_rules", {}).pop(test_venue, None)
            rules_clean.get("venue_calendar_deep_links", {}).pop(test_venue, None)
            with open(self.rules_path, "w", encoding="utf-8") as f:
                json.dump(rules_clean, f, indent=2)

    def test_03_the_waldorf_and_the_cobalt_enrolled(self):
        """Verifies that The Waldorf and The Cobalt are registered with valid invariants."""
        venues = UniversalVenueCrawler.load_venues()
        self.assertIn("The Waldorf", venues, "The Waldorf missing from UniversalVenueCrawler.load_venues()")
        self.assertIn("The Cobalt", venues, "The Cobalt missing from UniversalVenueCrawler.load_venues()")

        waldorf = venues["The Waldorf"]
        self.assertEqual(waldorf["venueId"], "the-waldorf")
        self.assertEqual(waldorf["neighborhood"], "Commercial Drive")
        self.assertEqual(waldorf["category"], "music")
        self.assertEqual(waldorf["calendarUrl"], "https://atthewaldorf.com/events")
        self.assertEqual(waldorf["doorCover"], 15.0)
        self.assertEqual(waldorf["operatingDays"], ["thu", "fri", "sat", "sun"])
        self.assertIn("tiki bar", waldorf.get("subTags", []))

        cobalt = venues["The Cobalt"]
        self.assertEqual(cobalt["venueId"], "the-cobalt")
        self.assertEqual(cobalt["neighborhood"], "Gastown / Chinatown")
        self.assertEqual(cobalt["category"], "music")
        self.assertEqual(cobalt["calendarUrl"], "https://thecobalt.ca/events")
        self.assertEqual(cobalt["doorCover"], 15.0)
        self.assertEqual(cobalt["operatingDays"], ["thu", "fri", "sat", "sun"])
        self.assertIn("punk", cobalt.get("subTags", []))

    def test_04_pricing_engine_verifies_venue_policy(self):
        """Verifies that EventPricingSearchEngine verifies events adhering to learned venue door policies."""
        test_item_waldorf = {
            "id": "waldorf-tiki-dj-night",
            "title": "Tiki Bar DJ Dance Night",
            "venue": "The Waldorf",
            "websiteUrl": "https://atthewaldorf.com/events",
            "venueUrl": "https://atthewaldorf.com",
            "category": "music",
            "basePrice": 15.0
        }
        res_waldorf = EventPricingSearchEngine.search_and_verify(test_item_waldorf)
        self.assertTrue(res_waldorf["isVerified"], f"Failed to verify Waldorf event via policy: {res_waldorf}")
        self.assertEqual(res_waldorf["finalPrice"], 15.0)
        self.assertIn("$15.00 door", res_waldorf["priceLabel"])
        self.assertEqual(res_waldorf["verification"]["method"], "curator_learned_venue_policy")

        test_item_cobalt = {
            "id": "cobalt-punk-showcase",
            "title": "Chinatown Punk & Metal Showcase",
            "venue": "The Cobalt",
            "websiteUrl": "https://thecobalt.ca/events",
            "venueUrl": "https://thecobalt.ca",
            "category": "music",
            "basePrice": 15.0
        }
        res_cobalt = EventPricingSearchEngine.search_and_verify(test_item_cobalt)
        self.assertTrue(res_cobalt["isVerified"], f"Failed to verify Cobalt event via policy: {res_cobalt}")
        self.assertEqual(res_cobalt["finalPrice"], 15.0)
        self.assertIn("$15.00 door", res_cobalt["priceLabel"])
        self.assertEqual(res_cobalt["verification"]["method"], "curator_learned_venue_policy")


if __name__ == "__main__":
    unittest.main()
