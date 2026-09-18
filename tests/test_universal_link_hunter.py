#!/usr/bin/env python3
"""
Unit Test Suite: Universal Deep Link Hunter & Generic Link Classifier
Validates:
1. Universal generic URL detection (roots, catalog indices, trailing slashes).
2. Autonomous Deep Link Hunter keyword extraction and live page traversal.
3. Automated upgrade of Slice of Life events (LEGO Night, Life Drawing).
4. Fail-closed quality gate protecting the public catalog.
"""

import unittest
from unittest.mock import patch, MagicMock
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))

from universal_link_hunter import is_generic_url, AutonomousDeepLinkHunter


class TestUniversalLinkHunter(unittest.TestCase):

    # --------------------------------------------------------------------------
    # 1. UNIVERSAL GENERIC LINK CLASSIFIER
    # --------------------------------------------------------------------------
    def test_01_bare_roots_detected_as_generic(self):
        """Bare root domains must be flagged as generic."""
        for root in [
            "https://www.slicevancouver.ca",
            "https://www.slicevancouver.ca/",
            "http://thecultch.com",
            "https://foxcabaret.com/"
        ]:
            is_gen, reason = is_generic_url(root)
            self.assertTrue(is_gen, f"Expected {root} to be generic, got False")
            self.assertIn("Bare root", reason)

    def test_02_generic_index_paths_detected(self):
        """Generic catalog/event indices without specific slugs must be flagged."""
        generic_paths = [
            "https://www.slicevancouver.ca/shop",
            "https://www.slicevancouver.ca/shop/",
            "https://thecultch.com/events",
            "https://venue.com/calendar",
            "https://venue.com/tickets",
            "https://venue.com/shows",
            "https://venue.com/classes",
            "https://venue.com/schedule",
            "https://venue.com/store"
        ]
        for url in generic_paths:
            is_gen, reason = is_generic_url(url)
            self.assertTrue(is_gen, f"Expected {url} to be generic, got False")
            self.assertIn("Generic catalog index", reason)

    def test_03_specific_deep_paths_accepted(self):
        """URLs with specific event slugs, dates, or product IDs must NOT be generic."""
        specific_urls = [
            "https://www.slicevancouver.ca/visitors-20",
            "https://www.slicevancouver.ca/product/lifedraw/NWYCIPABOCUXY6IWRO4HQURW",
            "https://www.ticketweb.ca/event/aldous-harding-hollywood-theatre-tickets/14012894",
            "https://www.showpass.com/first-come-first-serve-open-mic-2/",
            "https://ra.co/events/2508498",
            "https://publicdisco.ca/events/blossom-block-party-2026",
            "https://dentmay2026.eventbrite.ca"
        ]
        for url in specific_urls:
            is_gen, reason = is_generic_url(url)
            self.assertFalse(is_gen, f"Expected {url} to be specific, got generic ({reason})")

    # --------------------------------------------------------------------------
    # 2. TOKEN EXTRACTION & VENUE STOPWORDS
    # --------------------------------------------------------------------------
    def test_04_token_extraction_excludes_venue_name(self):
        """Distinctive token extraction must strip venue words to prevent false positive matches."""
        title = "If You Build It: Adult LEGO Night at Slice of Life"
        venue = "Slice of Life Gallery & Studios"
        tokens = AutonomousDeepLinkHunter.extract_distinctive_tokens(title, venue=venue)
        self.assertIn("lego", tokens)
        self.assertIn("build", tokens)
        self.assertIn("adult", tokens)
        self.assertNotIn("slice", tokens)
        self.assertNotIn("life", tokens)
        self.assertNotIn("gallery", tokens)
        self.assertNotIn("studios", tokens)

    # --------------------------------------------------------------------------
    # 3. AUTONOMOUS DEEP LINK HUNTER TRAVERSAL
    # --------------------------------------------------------------------------
    def test_05_autonomous_hunter_resolves_mock_page(self):
        """Hunter must crawl HTML, score token matches, and return the highest scoring deep link."""
        mock_html = '''
        <html>
          <body>
            <nav>
              <a href="/about">About Us</a>
              <a href="/shop">Shop All</a>
            </nav>
            <main>
              <div class="events-grid">
                <a href="/events/super-cool-lego-night-2026">Join Adult LEGO Building Social</a>
                <a href="/events/pottery-clay-club">Clay Handbuilding Club</a>
              </div>
            </main>
          </body>
        </html>
        '''
        item = {
            "title": "If You Build It: Adult LEGO Night",
            "venue": "Test Art Space",
            "websiteUrl": "https://testartspace.ca/shop"
        }
        with patch.object(AutonomousDeepLinkHunter, 'fetch_page_content', return_value=mock_html):
            res = AutonomousDeepLinkHunter.hunt(item, "https://testartspace.ca/shop")
            self.assertTrue(res["resolved"])
            self.assertEqual(res["deepUrl"], "https://testartspace.ca/events/super-cool-lego-night-2026")
            self.assertGreaterEqual(res["confidence"], 0.6)

    def test_06_hunter_rejects_pure_generic_results(self):
        """Hunter must reject candidate links that are themselves generic indexes."""
        mock_html = '''
        <html>
          <body>
            <a href="/shop">LEGO items in shop</a>
          </body>
        </html>
        '''
        item = {
            "title": "Adult LEGO Night",
            "venue": "Test Venue",
            "websiteUrl": "https://testvenue.ca/shop"
        }
        with patch.object(AutonomousDeepLinkHunter, 'fetch_page_content', return_value=mock_html):
            res = AutonomousDeepLinkHunter.hunt(item, "https://testvenue.ca/shop")
            self.assertFalse(res["resolved"])

    def test_07_is_generic_url_rejects_maps_media_nested(self):
        """is_generic_url must identify maps, video/image media, and nested URLs as invalid."""
        self.assertTrue(is_generic_url("https://maps.app.goo.gl/3cPyFq1EsH1mWu2m8")[0])
        self.assertTrue(is_generic_url("https://www.google.com/maps/dir/foo/bar")[0])
        self.assertTrue(is_generic_url("https://kitsilanoshowboat.com/wp-content/uploads/2026/06/SHOWBOATPromoVidV4.mp4")[0])
        self.assertTrue(is_generic_url("https://example.com/flyer.pdf")[0])
        self.assertTrue(is_generic_url("https://example.com/https://example.com/page")[0])

    def test_08_hunter_rejects_media_and_maps_as_event_links(self):
        """Hunter must reject media and map links when crawling HTML."""
        mock_html = '''
        <html>
          <body>
            <a href="/uploads/promo-lego.mp4">Watch adult lego building video</a>
            <a href="https://maps.app.goo.gl/123">Directions to adult lego night</a>
          </body>
        </html>
        '''
        item = {
            "title": "Adult LEGO Night",
            "venue": "Test Art Space",
            "websiteUrl": "https://testartspace.ca/events"
        }
        with patch.object(AutonomousDeepLinkHunter, 'fetch_page_content', return_value=mock_html):
            res = AutonomousDeepLinkHunter.hunt(item, "https://testartspace.ca/events")
            self.assertFalse(res["resolved"])

    def test_09_utility_pages_rejected_as_generic(self):
        """Utility and checkout basket paths (/cart, /checkout, /donate, etc.) must be flagged as generic."""
        utility_urls = [
            "https://www.carfreevancouver.org/cart",
            "https://venue.com/cart/",
            "https://venue.com/checkout",
            "https://venue.com/basket",
            "https://venue.com/donate",
            "https://venue.com/privacy",
            "https://venue.com/terms"
        ]
        for url in utility_urls:
            is_gen, reason = is_generic_url(url)
            self.assertTrue(is_gen, f"Expected utility path {url} to be generic, got False")


if __name__ == '__main__':
    unittest.main()
