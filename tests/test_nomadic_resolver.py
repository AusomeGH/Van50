#!/usr/bin/env python3
"""
Unit Test Suite for Nomadic Location & Transit Resolver
Verifies location parsing, coordinate assignment, neighborhood tagging,
and fallback behaviors for roving collectives like Public Disco.
"""

import unittest
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from nomadic_resolver import NomadicLocationResolver


class TestNomadicLocationResolver(unittest.TestCase):

    def test_01_public_disco_gastown(self):
        res = NomadicLocationResolver.resolve_location(
            "public-disco",
            "Gastown Streetside Sessions on Water Street",
            "Summer DJ Series"
        )
        self.assertTrue(res["resolved"])
        self.assertEqual(res["venue"], "Gastown (Water Street)")
        self.assertEqual(res["neighborhood"], "Gastown / Chinatown")
        self.assertAlmostEqual(res["coordinates"][0], 49.2838, places=3)
        self.assertIn("Waterfront SkyTrain", res["transitInfo"])

    def test_02_public_disco_granville_island(self):
        res = NomadicLocationResolver.resolve_location(
            "public-disco",
            "Granville Island Lot 55 Block Party",
            "Weekend Dance"
        )
        self.assertTrue(res["resolved"])
        self.assertEqual(res["venue"], "Granville Island (Lot 55)")
        self.assertEqual(res["neighborhood"], "Granville Island")
        self.assertIn("#50 False Creek bus", res["transitInfo"])

    def test_03_public_disco_host_venue_birdhouse(self):
        res = NomadicLocationResolver.resolve_location(
            "public-disco",
            "Warehouse Fundraiser at The Birdhouse",
            "Indoor Club Night"
        )
        self.assertTrue(res["resolved"])
        self.assertEqual(res["venue"], "The Birdhouse")
        self.assertEqual(res["neighborhood"], "Mount Pleasant")

    def test_04_car_free_commercial_drive(self):
        res = NomadicLocationResolver.resolve_location(
            "car-free-vancouver",
            "Commercial Drive Festival Day",
            "Car Free Day Vancouver"
        )
        self.assertTrue(res["resolved"])
        self.assertEqual(res["neighborhood"], "Commercial Drive")
        self.assertIn("Commercial-Broadway", res["transitInfo"])

    def test_05_unknown_location_graceful_fallback(self):
        res = NomadicLocationResolver.resolve_location(
            "public-disco",
            "Secret Mystery Pop-Up Somewhere in Town",
            "Secret Party"
        )
        self.assertFalse(res["resolved"])
        self.assertEqual(res["neighborhood"], "Downtown / West End")
        self.assertIsNotNone(res["coordinates"])


if __name__ == "__main__":
    unittest.main()
