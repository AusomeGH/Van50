#!/usr/bin/env python3
"""
Unit tests for Van50 Universal Discovery Crawler
Verifies RSS parsing, price/free extraction, and venue mention detection.
"""

import os
import sys
import unittest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))

from universal_discovery_crawler import UniversalDiscoveryCrawler


class TestUniversalDiscoveryCrawler(unittest.TestCase):

    def test_rss_xml_parsing(self):
        """Tests parsing raw RSS 2.0 XML channel into article items."""
        sample_rss = """<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Daily Hive Vancouver</title>
            <item>
              <title>10 Free and Cheap Things to Do in Vancouver This Weekend</title>
              <link>https://dailyhive.com/vancouver/free-cheap-things-to-do-vancouver-weekend</link>
              <description>Check out the live comedy at Waterfront Theatre with $15 tickets, or free admission to Granville Island.</description>
              <pubDate>Thu, 17 Sep 2026 12:00:00 GMT</pubDate>
            </item>
          </channel>
        </rss>
        """
        items = UniversalDiscoveryCrawler.parse_rss_feed_content(sample_rss)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["title"], "10 Free and Cheap Things to Do in Vancouver This Weekend")
        self.assertIn("Waterfront Theatre", items[0]["description"])

    def test_price_mention_extraction(self):
        """Tests extracting dollar prices and free mentions from text."""
        self.assertEqual(UniversalDiscoveryCrawler.extract_price_mention("Free admission for all guests"), 0.0)
        self.assertEqual(UniversalDiscoveryCrawler.extract_price_mention("Tickets are $18.50 at the door"), 18.50)
        self.assertEqual(UniversalDiscoveryCrawler.extract_price_mention("Passes start at $25"), 25.00)

    def test_venue_candidate_detection(self):
        """Tests detecting venue names in article snippets."""
        cand = UniversalDiscoveryCrawler.extract_venue_candidate(
            "Comedy Gala Tonight", "The hilarious showcase is hosted at Waterfront Theatre in Granville Island."
        )
        self.assertIsNotNone(cand)
        self.assertEqual(cand["name"], "Waterfront Theatre")

    def test_article_processing(self):
        """Tests that an article item is processed into a candidate event."""
        source_meta = {"id": "daily-hive", "name": "Daily Hive Vancouver"}
        item = {
            "title": "Indie Rock Night with $15 tickets",
            "link": "https://dailyhive.com/vancouver/indie-rock-night",
            "description": "Catch live bands taking place at Waterfront Theatre this Saturday."
        }
        cand = UniversalDiscoveryCrawler.process_article_item(source_meta, item)
        self.assertIsNotNone(cand)
        self.assertEqual(cand["category"], "music")
        self.assertEqual(cand["detectedPrice"], 15.0)
        self.assertEqual(cand["discoveredVenue"], "Waterfront Theatre")


if __name__ == "__main__":
    unittest.main()
