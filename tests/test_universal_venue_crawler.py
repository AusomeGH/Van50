#!/usr/bin/env python3
"""
Test Suite: Universal Venue Calendar Crawler
Validates:
1. Venue directory loading & metadata resolution
2. Schema.org JSON-LD event extraction
3. DOM outbound ticketing link heuristics & Sold Out badge detection
4. Date parsing with ordinals & Day-of-Week mapping
5. End-to-end budget cap verification & quarantine partitioning
"""

import os
import sys
import unittest
from unittest.mock import patch
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
from universal_venue_crawler import UniversalVenueCrawler

class TestUniversalVenueCrawler(unittest.TestCase):

    def test_load_venues(self):
        venues = UniversalVenueCrawler.load_venues()
        self.assertIsInstance(venues, dict)
        self.assertIn("Hollywood Theatre", venues)
        self.assertIn("Rickshaw Theatre", venues)
        self.assertEqual(venues["Hollywood Theatre"]["neighborhood"], "Kitsilano")
        self.assertEqual(venues["Rickshaw Theatre"]["neighborhood"], "Gastown / Chinatown")
        self.assertTrue(venues["Hollywood Theatre"]["calendarUrl"].startswith("https://"))

    def test_slugify(self):
        self.assertEqual(UniversalVenueCrawler.slugify("Honeybear Album Release Party!"), "honeybear-album-release-party")
        self.assertEqual(UniversalVenueCrawler.slugify("Bear McCreary -  The Singularity: Ekleipsis Tour"), "bear-mccreary-the-singularity-ekleipsis-tour")
        self.assertEqual(UniversalVenueCrawler.slugify("   OFF BOOK -- Improvised Musical   "), "off-book-improvised-musical")

    def test_parse_schema_jsonld(self):
        sample_html = '''
        <html><head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "MusicEvent",
            "name": "Live Jazz Quartet",
            "startDate": "2026-09-18T20:00:00-07:00",
            "endDate": "2026-09-18T23:00:00-07:00",
            "description": "An intimate evening of bebop and contemporary jazz.",
            "offers": {
                "@type": "Offer",
                "url": "https://admitone.com/events/vancouver/jazz-quartet"
            }
        }
        </script>
        </head><body></body></html>
        '''
        soup = BeautifulSoup(sample_html, 'html.parser')
        events = UniversalVenueCrawler.parse_schema_jsonld(soup, "https://examplevenue.com/calendar")
        self.assertEqual(len(events), 1)
        ev = events[0]
        self.assertEqual(ev["title"], "Live Jazz Quartet")
        self.assertEqual(ev["ticketUrl"], "https://admitone.com/events/vancouver/jazz-quartet")
        self.assertEqual(ev["startIso"], "2026-09-18T20:00:00-07:00")
        self.assertEqual(ev["detection"], "schema_jsonld")

    def test_parse_dom_links_with_outbound_and_sold_out(self):
        sample_html = '''
        <div class="calendar-wrapper">
            <div class="w-dyn-item">
                <div class="event-card">
                    <div class="event-date">Sep 15, 2026</div>
                    <h3 class="event-title">Shawn James Acoustic Tour</h3>
                    <a class="btn-tickets" href="https://admitone.com/events/shawn-james-123">Get Tickets</a>
                </div>
            </div>
            <div class="w-dyn-item">
                <div class="event-card">
                    <div class="event-date">Sep 16, 2026</div>
                    <h3 class="event-title">Sold Out Comedy Showcase</h3>
                    <a class="btn-tickets" href="https://www.ticketweb.ca/event/comedy-night/456">Sold Out</a>
                </div>
            </div>
        </div>
        '''
        soup = BeautifulSoup(sample_html, 'html.parser')
        events = UniversalVenueCrawler.parse_dom_links(soup, "https://hollywoodtheatre.ca/events")
        self.assertEqual(len(events), 2)
        
        ev1 = events[0]
        self.assertEqual(ev1["title"], "Shawn James Acoustic Tour")
        self.assertEqual(ev1["ticketUrl"], "https://admitone.com/events/shawn-james-123")
        self.assertFalse(ev1["isSoldOut"])
        self.assertEqual(ev1["dateStr"], "Sep 15, 2026")
        self.assertEqual(ev1["confirmedDates"], ["2026-09-15"])

        ev2 = events[1]
        self.assertEqual(ev2["title"], "Sold Out Comedy Showcase")
        self.assertTrue(ev2["isSoldOut"])

    @patch('universal_venue_crawler.fetch_html')
    def test_crawl_venue(self, mock_fetch):
        mock_fetch.return_value = '''
        <div class="events-container">
            <article class="listing_block">
                <div class="date-tag">September 10th, 2026</div>
                <h2 class="title">Bear McCreary - The Singularity Tour</h2>
                <a href="https://admitone.com/events/bear-mccreary-vancouver-161943">Get Tickets</a>
            </article>
        </div>
        '''
        venue_meta = {
            "venueId": "rickshaw-theatre",
            "category": "music",
            "address": "254 E Hastings St, Vancouver, BC",
            "neighborhood": "Gastown / Chinatown",
            "calendarUrl": "https://rickshawtheatre.com/",
            "coordinates": [49.2813, -123.0984],
            "transitInfo": "Main St SkyTrain"
        }
        candidates = UniversalVenueCrawler.crawl_venue("Rickshaw Theatre", venue_meta)
        self.assertEqual(len(candidates), 1)
        c = candidates[0]
        self.assertEqual(c["venue"], "Rickshaw Theatre")
        self.assertEqual(c["category"], "music")
        self.assertEqual(c["daysOfWeek"], ["thu"])
        self.assertEqual(c["dateSchedule"], "Sep 10, 2026")
        self.assertIn("2026-09-10", c["confirmedDates"])
        self.assertEqual(c["websiteUrl"], "https://admitone.com/events/bear-mccreary-vancouver-161943")

    @patch('universal_venue_crawler.EventPricingSearchEngine.search_and_verify')
    @patch('universal_venue_crawler.UniversalVenueCrawler.crawl_venue')
    def test_budget_cap_partitioning(self, mock_crawl, mock_verify):
        mock_crawl.return_value = [
            {
                "id": "test-under-50",
                "title": "Cheap Local Band",
                "venue": "Hollywood Theatre",
                "address": "3123 W Broadway",
                "neighborhood": "Kitsilano",
                "basePrice": 20.0,
                "websiteUrl": "https://admitone.com/cheap-band",
                "category": "music"
            },
            {
                "id": "test-over-50",
                "title": "Expensive ABBA Show",
                "venue": "Hollywood Theatre",
                "address": "3123 W Broadway",
                "neighborhood": "Kitsilano",
                "basePrice": 60.0,
                "websiteUrl": "https://vtix.com/expensive-abba",
                "category": "music"
            },
            {
                "id": "test-unverified-under-50",
                "title": "Mystery Local Band",
                "venue": "Hollywood Theatre",
                "address": "3123 W Broadway",
                "neighborhood": "Kitsilano",
                "basePrice": 15.0,
                "websiteUrl": "https://unknown.com/tickets",
                "category": "music"
            }
        ]
        
        def mock_verify_side_effect(item):
            if "cheap" in item.get("title", "").lower():
                return {
                    "isVerified": True,
                    "finalPrice": 22.50,
                    "priceLabel": "$22.50 all-in",
                    "verification": {"feeBreakdown": "Base $20.00 + $2.50 fee"}
                }
            elif "expensive" in item.get("title", "").lower():
                return {
                    "isVerified": False,
                    "isOverBudget": True,
                    "finalPrice": 66.06,
                    "priceLabel": "$66.06 all-in",
                    "quarantineReason": "Price exceeds $50.00 CAD budget limit"
                }
            else:
                return {
                    "isVerified": False,
                    "finalPrice": 15.0,
                    "priceLabel": "$15.00 door",
                    "quarantineReason": "Could not dynamically verify live checkout pricing"
                }
        
        mock_verify.side_effect = mock_verify_side_effect

        with patch.object(UniversalVenueCrawler, 'load_venues', return_value={"Hollywood Theatre": {"calendarUrl": "https://hollywoodtheatre.ca/events"}}):
            verified, quarantined = UniversalVenueCrawler.harvest_all_venues(["Hollywood Theatre"])
            
            self.assertEqual(len(verified), 1)
            self.assertEqual(verified[0]["title"], "Cheap Local Band")
            self.assertEqual(verified[0]["price"], 22.50)
            self.assertEqual(verified[0]["priceLabel"], "$22.50 all-in")

            # Expensive ABBA Show is auto-denied (over $50) and never burdened onto the curator in quarantine!
            self.assertEqual(len(quarantined), 1)
            self.assertEqual(quarantined[0]["title"], "Mystery Local Band")
            self.assertNotIn("Expensive ABBA Show", [q["title"] for q in quarantined])


if __name__ == '__main__':
    unittest.main()
