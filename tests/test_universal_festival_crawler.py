#!/usr/bin/env python3
"""
Unit tests for Van50 Universal Festival Crawler
Verifies the 30-day pre-window autonomous activation, auto-off lifecycle,
host venue extraction, and festival ticket fee calculations.
"""

import os
import sys
import json
import unittest
from datetime import date, timedelta

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))

from universal_festival_crawler import UniversalFestivalCrawler


class TestUniversalFestivalCrawler(unittest.TestCase):

    def setUp(self):
        self.sample_festival = {
            "id": "test-fringe-festival",
            "name": "Test Fringe Festival",
            "startDate": "2026-09-10",
            "endDate": "2026-09-20",
            "preWindowDays": 30,
            "postWindowDays": 2,
            "category": "shows",
            "websiteUrl": "https://vancouverfringe.com",
            "scheduleUrl": "https://vancouverfringe.com/shows/",
            "priceStructure": {
                "model": "per_show_plus_membership",
                "showPrice": 15.00,
                "membershipButtonFee": 10.00,
                "allInSingleShow": 25.00,
                "withinBudget": True
            },
            "hostVenues": [
                "Waterfront Theatre",
                "Carousel Theatre",
                "Stanley Park Seawall"  # Known venue to test deduplication
            ]
        }

    def test_active_window_calculation(self):
        """Tests that the crawler is active 30 days before and turns off 2 days after."""
        # 40 days before -> Dormant
        dormant_date = date(2026, 7, 30)
        is_active, status, delta = UniversalFestivalCrawler.is_active_window(self.sample_festival, dormant_date)
        self.assertFalse(is_active)
        self.assertEqual(status, "dormant_upcoming")
        self.assertGreater(delta, 0)

        # 20 days before -> Active Pre-Window
        pre_window_date = date(2026, 8, 25)
        is_active, status, delta = UniversalFestivalCrawler.is_active_window(self.sample_festival, pre_window_date)
        self.assertTrue(is_active)
        self.assertEqual(status, "active_pre_window")
        self.assertEqual(delta, (date(2026, 9, 10) - pre_window_date).days)

        # During festival -> Active Live
        live_date = date(2026, 9, 15)
        is_active, status, delta = UniversalFestivalCrawler.is_active_window(self.sample_festival, live_date)
        self.assertTrue(is_active)
        self.assertEqual(status, "active_live")

        # 1 day after festival closing -> Active Post-Window
        wrapup_date = date(2026, 9, 21)
        is_active, status, delta = UniversalFestivalCrawler.is_active_window(self.sample_festival, wrapup_date)
        self.assertTrue(is_active)
        self.assertEqual(status, "active_post_window")

        # 10 days after festival -> Concluded (Auto-Off)
        concluded_date = date(2026, 10, 1)
        is_active, status, delta = UniversalFestivalCrawler.is_active_window(self.sample_festival, concluded_date)
        self.assertFalse(is_active)
        self.assertEqual(status, "concluded")

    def test_festival_price_calculation_with_button(self):
        """Tests that festival membership button ($10) + show ($15) + 5% GST is strictly <= $50."""
        total, breakdown, within_budget = UniversalFestivalCrawler.calculate_festival_show_price(
            self.sample_festival, 15.00
        )
        # 15.00 + 10.00 + 0.75 GST = 25.75
        self.assertEqual(total, 25.75)
        self.assertTrue(within_budget)
        self.assertIn("festival button", breakdown)

        # Test expensive show that would exceed $50
        total_exp, _, within_budget_exp = UniversalFestivalCrawler.calculate_festival_show_price(
            self.sample_festival, 45.00
        )
        # 45.00 + 10.00 + 2.25 = 57.25 > 50.00
        self.assertFalse(within_budget_exp)

    def test_venue_discovery_from_festival(self):
        """Tests that unknown host venues are flagged as candidate venues."""
        flagged = UniversalFestivalCrawler.discover_and_register_host_venues(self.sample_festival)
        # Waterfront Theatre and Carousel Theatre should be flagged, but not Stanley Park Seawall
        flagged_names = [f["name"] for f in flagged]
        self.assertNotIn("Stanley Park Seawall", flagged_names)


if __name__ == "__main__":
    unittest.main()
