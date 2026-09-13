#!/usr/bin/env python3
"""
Test Suite: Live Ticketing Extractors & Routing Engine
Validates live checkout pricing extraction, fee calculations, budget cap enforcement,
and EventPricingSearchEngine dispatch across all 12 new ticketing platforms.
"""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
from pricing_search_engine import (
    EventPricingSearchEngine,
    EventbriteLiveExtractor,
    TicketWebLiveExtractor,
    DiceLiveExtractor,
    ShotgunLiveExtractor,
    SpektrixLiveExtractor,
    TessituraLiveExtractor,
    TicketTailorLiveExtractor,
    ZeffyLiveExtractor,
    HumanitixLiveExtractor,
    UniverseLiveExtractor,
    TicketmasterLiveExtractor,
    AXSLiveExtractor,
    VTixLiveExtractor,
    FeverUpLiveExtractor,
    PlatformAndPolicyExtractor
)

class TestAllTicketingExtractors(unittest.TestCase):

    # --------------------------------------------------------------------------
    # 1. TICKETWEB
    # --------------------------------------------------------------------------
    @patch('pricing_search_engine.fetch_html')
    def test_ticketweb_valid_schema(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Event",
            "name": "Indie Rock Showcase",
            "offers": {"@type": "Offer", "price": "20.00", "priceCurrency": "CAD"}
        }
        </script>
        </head><body><h1>Event</h1></body></html>
        '''
        res = TicketWebLiveExtractor.extract("test-ev", "https://www.ticketweb.ca/event/test/12345")
        self.assertTrue(res["success"])
        self.assertLessEqual(res["finalPrice"], 50.00)
        self.assertIn("TicketWeb fee", res["verification"]["feeBreakdown"])

    @patch('pricing_search_engine.fetch_html')
    def test_ticketweb_exceeds_budget(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Event",
            "offers": {"@type": "Offer", "price": "45.00", "priceCurrency": "CAD"}
        }
        </script>
        </head></html>
        '''
        res = TicketWebLiveExtractor.extract("test-ev", "https://www.ticketweb.ca/event/test/12345")
        self.assertFalse(res["success"])
        self.assertIn("strictly exceeds", res["quarantineReason"])

    # --------------------------------------------------------------------------
    # 2. DICE
    # --------------------------------------------------------------------------
    @patch('pricing_search_engine.fetch_html')
    def test_dice_next_data_extraction(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><head>
        <script id="__NEXT_DATA__" type="application/json">
        {
            "props": {
                "pageProps": {
                    "event": {
                        "name": "Synthwave Night",
                        "price": {"amount": 2500, "currency": "CAD"},
                        "ticket_types": [{"name": "General Admission", "price": {"amount": 2500}}]
                    }
                }
            }
        }
        </script>
        </head></html>
        '''
        res = DiceLiveExtractor.extract("dice-ev", "https://dice.fm/event/synthwave-123")
        self.assertTrue(res["success"])
        self.assertEqual(res["finalPrice"], 25.00)
        self.assertIn("DICE upfront", res["priceLabel"])

    # --------------------------------------------------------------------------
    # 3. SHOTGUN
    # --------------------------------------------------------------------------
    @patch('pricing_search_engine.fetch_html')
    def test_shotgun_valid_extraction(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><head>
        <script id="__NEXT_DATA__" type="application/json">
        {
            "props": {
                "pageProps": {
                    "event": {
                        "name": "Warehouse Groove",
                        "minPrice": 1800
                    }
                }
            }
        }
        </script>
        </head></html>
        '''
        res = ShotgunLiveExtractor.extract("shotgun-ev", "https://shotgun.live/events/warehouse-groove")
        self.assertTrue(res["success"])
        self.assertLessEqual(res["finalPrice"], 50.00)
        self.assertIn("Shotgun", res["verification"]["feeBreakdown"])

    # --------------------------------------------------------------------------
    # 4. SPEKTRIX
    # --------------------------------------------------------------------------
    @patch('pricing_search_engine.fetch_html')
    def test_spektrix_cultch_accessible_policy(self, mock_fetch):
        mock_fetch.return_value = '''<html><body>Tickets from $25 to $65</body></html>'''
        res = SpektrixLiveExtractor.extract("cultch-show", "https://thecultch.com/event/the-sound-inside/")
        self.assertTrue(res["success"])
        self.assertLessEqual(res["finalPrice"], 50.00)
        self.assertIn("GST", res["verification"]["feeBreakdown"])

    # --------------------------------------------------------------------------
    # 5. TESSITURA
    # --------------------------------------------------------------------------
    @patch('pricing_search_engine.fetch_html')
    def test_tessitura_vso_rush(self, mock_fetch):
        mock_fetch.return_value = '''<html><body>VSO Symphony Performance</body></html>'''
        res = TessituraLiveExtractor.extract("vso-concert", "https://www.vancouversymphony.ca/event/beethoven-5")
        self.assertTrue(res["success"])
        self.assertLessEqual(res["finalPrice"], 50.00)
        self.assertIn("VSO rush", res["verification"]["feeBreakdown"])

    # --------------------------------------------------------------------------
    # 6. TICKET TAILOR
    # --------------------------------------------------------------------------
    @patch('pricing_search_engine.fetch_html')
    def test_ticket_tailor_extraction(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Event",
            "offers": {"@type": "Offer", "price": "15.00"}
        }
        </script>
        </head></html>
        '''
        res = TicketTailorLiveExtractor.extract("tt-ev", "https://buytickets.at/community/123")
        self.assertTrue(res["success"])
        self.assertEqual(res["finalPrice"], 16.00) # $15 + $1 fee
        self.assertIn("Ticket Tailor", res["verification"]["feeBreakdown"])

    # --------------------------------------------------------------------------
    # 7. ZEFFY
    # --------------------------------------------------------------------------
    @patch('pricing_search_engine.fetch_html')
    def test_zeffy_zero_fee_extraction(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Event",
            "offers": {"@type": "Offer", "price": "12.00"}
        }
        </script>
        </head></html>
        '''
        res = ZeffyLiveExtractor.extract("zeffy-ev", "https://www.zeffy.com/ticketing/heritage-walk")
        self.assertTrue(res["success"])
        self.assertEqual(res["finalPrice"], 12.00)
        self.assertIn("$0.00 processing fees", res["verification"]["feeBreakdown"])

    # --------------------------------------------------------------------------
    # 8. HUMANITIX
    # --------------------------------------------------------------------------
    @patch('pricing_search_engine.fetch_html')
    def test_humanitix_extraction(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Event",
            "offers": {"@type": "Offer", "price": "18.00"}
        }
        </script>
        </head></html>
        '''
        res = HumanitixLiveExtractor.extract("humanitix-ev", "https://humanitix.com/events/storytelling")
        self.assertTrue(res["success"])
        self.assertLessEqual(res["finalPrice"], 50.00)
        self.assertIn("Humanitix", res["verification"]["feeBreakdown"])

    # --------------------------------------------------------------------------
    # 9. UNIVERSE
    # --------------------------------------------------------------------------
    @patch('pricing_search_engine.fetch_html')
    def test_universe_extraction(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Event",
            "offers": {"@type": "Offer", "price": "16.00"}
        }
        </script>
        </head></html>
        '''
        res = UniverseLiveExtractor.extract("universe-ev", "https://www.universe.com/events/doxa-screening")
        self.assertTrue(res["success"])
        self.assertLessEqual(res["finalPrice"], 50.00)

    # --------------------------------------------------------------------------
    # 10. TICKETMASTER
    # --------------------------------------------------------------------------
    @patch('pricing_search_engine.fetch_html')
    def test_ticketmaster_rush_tier(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Event",
            "offers": {"@type": "AggregateOffer", "lowPrice": "25.00", "highPrice": "95.00"}
        }
        </script>
        </head></html>
        '''
        res = TicketmasterLiveExtractor.extract("tm-ev", "https://www.ticketmaster.ca/event/12345")
        self.assertTrue(res["success"])
        self.assertLessEqual(res["finalPrice"], 50.00)
        self.assertIn("Ticketmaster", res["verification"]["feeBreakdown"])

    # --------------------------------------------------------------------------
    # 11. AXS
    # --------------------------------------------------------------------------
    @patch('pricing_search_engine.fetch_html')
    def test_axs_extraction(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Event",
            "offers": {"@type": "Offer", "price": "22.00"}
        }
        </script>
        </head></html>
        '''
        res = AXSLiveExtractor.extract("axs-ev", "https://www.axs.com/events/12345/pne-show")
        self.assertTrue(res["success"])
        self.assertLessEqual(res["finalPrice"], 50.00)

    # --------------------------------------------------------------------------
    # 12. VTIX ONLINE
    # --------------------------------------------------------------------------
    @patch('pricing_search_engine.fetch_html')
    def test_vtix_extraction(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Event",
            "offers": {"@type": "Offer", "price": "28.50"}
        }
        </script>
        </head></html>
        '''
        res = VTixLiveExtractor.extract("vtix-ev", "https://www.vtixonline.com/event.php?event_id=5746")
        self.assertTrue(res["success"])
        self.assertEqual(res["finalPrice"], 28.50)

    # --------------------------------------------------------------------------
    # 13. EVENTBRITE AGGREGATE OFFER & BUDGET ENFORCEMENT
    # --------------------------------------------------------------------------
    @patch('pricing_search_engine.fetch_html')
    def test_eventbrite_aggregate_offer_extraction(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Event",
            "name": "Mental Health Showcase",
            "offers": [
                {
                    "@type": "AggregateOffer",
                    "lowPrice": "12.06",
                    "highPrice": "12.06",
                    "priceCurrency": "CAD"
                }
            ]
        }
        </script>
        </head></html>
        '''
        res = EventbriteLiveExtractor.extract("eb-ev", "https://www.eventbrite.ca/e/mental-health-tickets-12345")
        self.assertTrue(res["success"])
        self.assertEqual(res["finalPrice"], 12.06)
        self.assertEqual(res["priceLabel"], "$12.06 all-in")
        self.assertIn("Eventbrite", res["verification"]["feeBreakdown"])

    @patch('pricing_search_engine.fetch_html')
    def test_eventbrite_exceeds_budget(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Event",
            "offers": [
                {
                    "@type": "AggregateOffer",
                    "lowPrice": "70.56",
                    "highPrice": "113.16",
                    "priceCurrency": "CAD"
                }
            ]
        }
        </script>
        </head></html>
        '''
        res = EventbriteLiveExtractor.extract("eb-expensive", "https://www.eventbrite.ca/e/expensive-show-tickets-12345")
        self.assertFalse(res["success"])
        self.assertIn("strictly exceeds", res["quarantineReason"])

    # --------------------------------------------------------------------------
    # 14. ROUTING & BUDGET ENFORCEMENT VIA EventPricingSearchEngine
    # --------------------------------------------------------------------------
    @patch('pricing_search_engine.fetch_html')
    def test_search_and_verify_routing(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Event",
            "offers": {"@type": "Offer", "price": "18.00"}
        }
        </script>
        </head></html>
        '''
        item = {
            "id": "rickshaw-indie-gig",
            "title": "Rickshaw Indie Gig",
            "venue": "Rickshaw Theatre",
            "basePrice": 18.0,
            "websiteUrl": "https://www.ticketweb.ca/event/indie-gig/998877",
            "category": "shows"
        }
        verification = EventPricingSearchEngine.search_and_verify(item)
        self.assertTrue(verification["isVerified"])
        self.assertLessEqual(verification["finalPrice"], 50.00)

    # --------------------------------------------------------------------------
    # 13. FEVERUP & DYNAMIC POLICY EXTRACTION
    # --------------------------------------------------------------------------
    @patch('pricing_search_engine.fetch_html')
    def test_feverup_valid(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><body>
        <div class="fv-plan-card-v2">
            <span class="fv-plan-card-v2__price-info--bold">$43.20</span>
        </div>
        </body></html>
        '''
        res = FeverUpLiveExtractor.extract("test-fever", "https://feverup.com/m/661481")
        self.assertTrue(res["success"])
        self.assertEqual(res["finalPrice"], 43.20)
        self.assertEqual(res["priceLabel"], "$43.20 all-in")

    @patch('pricing_search_engine.fetch_html')
    def test_feverup_overbudget(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><body>
        <div class="fv-plan-card-v2">
            <span class="fv-plan-card-v2__price-info--bold">$65.00</span>
        </div>
        </body></html>
        '''
        res = FeverUpLiveExtractor.extract("test-fever-exp", "https://feverup.com/m/999999")
        self.assertFalse(res["success"])
        self.assertTrue(res.get("isOverBudget"))
        self.assertIn("exceeds the $50.00 CAD budget cap", res["quarantineReason"])

    @patch('pricing_search_engine.fetch_html')
    def test_civic_waterfront_public_space(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><body>
        <h1>The Shipyards</h1>
        <p>A vibrant waterfront public space and civic plaza in North Vancouver with a skate plaza and splash park.</p>
        </body></html>
        '''
        item = {
            "id": "shipyards-live-test",
            "venue": "The Shipyards District",
            "pricingType": "free",
            "priceCAD": 0.0,
            "websiteUrl": "https://www.cnv.org/Parks-Recreation/The-Shipyards"
        }
        res = PlatformAndPolicyExtractor.extract(item)
        self.assertTrue(res["success"])
        self.assertEqual(res["finalPrice"], 0.0)
        self.assertEqual(res["priceLabel"], "Free ($0)")
        self.assertEqual(res["verification"]["method"], "civic_public_space_policy")

    @patch('pricing_search_engine.fetch_html')
    def test_dynamic_cover_extraction(self, mock_fetch):
        mock_fetch.return_value = '''
        <html><body>
        <h1>2nd Floor Gastown</h1>
        <p>Live music nightly. Artist cover is $12.00 added to your bill.</p>
        </body></html>
        '''
        item = {
            "id": "2nd-floor-test",
            "venue": "2nd Floor Gastown",
            "websiteUrl": "https://www.waterstreetcafe.ca/2nd-floor-gastown"
        }
        res = PlatformAndPolicyExtractor.extract(item)
        self.assertTrue(res["success"])
        self.assertEqual(res["finalPrice"], 12.0)
        self.assertIn("$12.00", res["priceLabel"])

if __name__ == '__main__':
    unittest.main()
