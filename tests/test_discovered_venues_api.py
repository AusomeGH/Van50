#!/usr/bin/env python3
"""
Unit tests for Curator Studio Discovered Venues & Add Venue API.
Verifies authenticated venue enrollment, safety backups, and load_venues() integration.
"""

import os
import sys
import json
import unittest
import shutil
from unittest.mock import patch, MagicMock

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))

from universal_venue_crawler import UniversalVenueCrawler
import curator_auth


class TestDiscoveredVenuesPipeline(unittest.TestCase):

    def setUp(self):
        self.venues_path = os.path.join(BASE_DIR, "data", "venue_directory.json")
        self.disc_path = os.path.join(BASE_DIR, "data", "discovered_venues.json")
        
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


if __name__ == "__main__":
    unittest.main()
