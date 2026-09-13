#!/usr/bin/env python3
"""
Test Suite: Universal Web & Ticketing Pricing Engine
Validates Tier 1 transparent pricing, Tier 2 Schema.org & Next.js hydration,
Tier 3 declarative vendor fee formulas, budget cap enforcement, and sold-out detection.
"""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
from pricing_search_engine import UniversalWebPricingExtractor, EventPricingSearchEngine


class TestUniversalPricingEngine(unittest.TestCase):

    # --------------------------------------------------------------------------
    # 1. TIER 1: TRANSPARENT ALL-IN & ITEMIZED PRICING (e.g. OrangeTickets)
    # --------------------------------------------------------------------------
    def test_transparent_itemized_pricing(self):
        sample_html = '''
        <div class="bds-m-ticket-item__price">
          <span>
            <strong>Total Price: 37.95<br/></strong>
            (Face Value: 30.00, Facility Fee: 3.00, Service Fee: 4.95)
          </span>
        </div>
        '''
        res = UniversalWebPricingExtractor.extract_transparent_pricing(sample_html, "https://orangetickets.ca/event/2240")
        self.assertTrue(res["success"])
        self.assertEqual(res["finalPrice"], 37.95)
        self.assertEqual(res["basePrice"], 30.00)
        self.assertEqual(res["feeAmount"], 7.95)
        self.assertEqual(res["priceLabel"], "$37.95 all-in ($30.00 + $7.95 fees)")
        self.assertIn("$3.00 facility fee", res["verification"]["feeBreakdown"])
        self.assertIn("$4.95 service fee", res["verification"]["feeBreakdown"])
        self.assertEqual(res["verification"]["method"], "universal_transparent_checkout")

    def test_transparent_simple_total(self):
        sample_html = '''
        <div class="checkout-summary">
          <h2>Order Details</h2>
          <p class="total">Total Price: $25.50</p>
        </div>
        '''
        res = UniversalWebPricingExtractor.extract_transparent_pricing(sample_html, "https://example-venue.ca/tickets")
        self.assertTrue(res["success"])
        self.assertEqual(res["finalPrice"], 25.50)
        self.assertEqual(res["priceLabel"], "$25.50 all-in")

    # --------------------------------------------------------------------------
    # 2. TIER 2: SCHEMA.ORG JSON-LD & HYDRATION PAYLOADS
    # --------------------------------------------------------------------------
    def test_schema_jsonld_extraction(self):
        sample_html = '''
        <html><head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "MusicEvent",
          "name": "Friday Indie Rock Night",
          "offers": {
            "@type": "Offer",
            "price": "24.00",
            "priceCurrency": "CAD",
            "availability": "https://schema.org/InStock"
          }
        }
        </script>
        </head><body>Content</body></html>
        '''
        res = UniversalWebPricingExtractor.extract_schema_and_hydration(sample_html, "https://venue.ca/shows/1")
        self.assertTrue(res["success"])
        self.assertEqual(res["finalPrice"], 24.00)
        self.assertFalse(res["isSoldOut"])
        self.assertIn("CAD", res["priceLabel"])
        self.assertEqual(res["verification"]["method"], "universal_schema_jsonld")

    def test_schema_jsonld_sold_out(self):
        sample_html = '''
        <html><head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Sold Out Gig",
          "offers": {
            "@type": "Offer",
            "price": "35.00",
            "priceCurrency": "CAD",
            "availability": "https://schema.org/SoldOut"
          }
        }
        </script>
        </head><body>Content</body></html>
        '''
        res = UniversalWebPricingExtractor.extract_schema_and_hydration(sample_html, "https://venue.ca/shows/sold")
        self.assertTrue(res["success"])
        self.assertEqual(res["finalPrice"], 35.00)
        self.assertTrue(res["isSoldOut"])

    def test_nextjs_hydration_extraction(self):
        sample_html = '''
        <html><head></head><body>
        <script id="__NEXT_DATA__" type="application/json">
        {
          "props": {
            "pageProps": {
              "event": {
                "title": "Acoustic Showcase",
                "price": 28.50
              }
            }
          }
        }
        </script>
        </body></html>
        '''
        res = UniversalWebPricingExtractor.extract_schema_and_hydration(sample_html, "https://modern-app.ca/event/100")
        self.assertTrue(res["success"])
        self.assertEqual(res["finalPrice"], 28.50)
        self.assertEqual(res["verification"]["method"], "universal_hydration_state")

    # --------------------------------------------------------------------------
    # 3. TIER 3: DECLARATIVE VENDOR FEE FORMULAS
    # --------------------------------------------------------------------------
    def test_declarative_fee_formula(self):
        learned_rules = {
            "vendor_fee_formulas": {
                "testvendor.ca": {
                    "feeFixed": 2.00,
                    "feePercent": 0.05,
                    "taxPercent": 0.05,
                    "description": "TestVendor $2.00 fee + 5% markup + 5% GST"
                }
            }
        }
        # Base price $20.00:
        # Subtotal = 20 * 1.05 + 2.00 = 23.00
        # Total = 23.00 * 1.05 = 24.15
        res = UniversalWebPricingExtractor.apply_vendor_fee_formula(20.00, "https://testvendor.ca/show/42", learned_rules)
        self.assertTrue(res["success"])
        self.assertEqual(res["finalPrice"], 24.15)
        self.assertEqual(res["basePrice"], 20.00)
        self.assertEqual(res["feeAmount"], 4.15)
        self.assertIn("TestVendor", res["verification"]["feeBreakdown"])
        self.assertEqual(res["verification"]["method"], "curator_learned_fee_formula")

    # --------------------------------------------------------------------------
    # 4. SOLD-OUT REAL-TIME DETECTION
    # --------------------------------------------------------------------------
    def test_detect_sold_out(self):
        html_sold = '<button class="btn btn-primary" disabled>Sold Out</button>'
        self.assertTrue(UniversalWebPricingExtractor.detect_sold_out(html_sold))

        html_avail = '<button class="btn btn-primary">Buy Tickets</button>'
        self.assertFalse(UniversalWebPricingExtractor.detect_sold_out(html_avail))

    # --------------------------------------------------------------------------
    # 5. DISPATCH & STRICT BUDGET CAP ENFORCEMENT VIA EventPricingSearchEngine
    # --------------------------------------------------------------------------
    @patch('pricing_search_engine.auto_deny_and_archive_event')
    @patch('pricing_search_engine.load_curator_learned_rules')
    @patch('pricing_search_engine.fetch_html')
    def test_budget_cap_quarantine_over_50(self, mock_fetch, mock_learned, mock_auto_deny):
        mock_learned.return_value = {"archived_event_ids": [], "price_override_heuristics": []}
        mock_fetch.return_value = '''
        <div class="ticket-info">
          Total Price: 66.06
        </div>
        '''
        item = {
            "id": "expensive-rave-test",
            "title": "ABBA Mega Dance Party",
            "websiteUrl": "https://unknown-vendor.com/detalles.php?id=999",
            "venue": "The Commodore"
        }
        res = EventPricingSearchEngine.search_and_verify(item)
        self.assertFalse(res["isVerified"])
        self.assertTrue(res.get("isOverBudget"))
        self.assertIn("strictly exceeds $50.00 CAD budget limit", res["quarantineReason"])
        mock_auto_deny.assert_called_once()

    @patch('pricing_search_engine.fetch_html')
    def test_transparent_sub_50_verified(self, mock_fetch):
        mock_fetch.return_value = '''
        <div class="bds-m-ticket-item__price">
          <strong>Total Price: 29.90<br/></strong>
          (Face Value: 24.00, Facility Fee: 2.00, Service Fee: 3.90)
        </div>
        '''
        item = {
            "id": "rickshaw-anciients",
            "title": "Anciients Live",
            "websiteUrl": "https://orangetickets.ca/detalles_evento.php?id_evento=2249",
            "venue": "Rickshaw Theatre"
        }
        res = EventPricingSearchEngine.search_and_verify(item)
        self.assertTrue(res["isVerified"])
        self.assertEqual(res["finalPrice"], 29.90)
        self.assertEqual(res["priceLabel"], "$29.90 all-in ($24.00 + $5.90 fees)")


if __name__ == '__main__':
    unittest.main()
