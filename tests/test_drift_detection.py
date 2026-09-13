#!/usr/bin/env python3
"""
Unit Test Suite for Van50 Live Page Drift Detection
Verifies that manually approved events re-check their live pages,
and flag material drift (>= $1.00 CAD increase, budget cap exceedance, sold-out status)
with explicit audit diff notes.
"""

import unittest
import os
import sys
import json
from unittest.mock import patch

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT_DIR, "scripts"))

from pricing_search_engine import EventPricingSearchEngine


class TestDriftDetection(unittest.TestCase):

    def setUp(self):
        self.approved_event = {
            "id": "drift-test-event-01",
            "title": "Indie Rock Showcase",
            "venue": "The Fox Cabaret",
            "neighborhood": "Mount Pleasant",
            "price": 22.0,
            "basePrice": 22.0,
            "priceLabel": "$22.00 all-in",
            "provider": "Showpass",
            "websiteUrl": "https://showpass.com/indie-rock-showcase/",
            "isSoldOut": False,
            "checkoutVerification": {
                "status": "verified_live",
                "method": "manual_curator_review",
                "verifiedTotal": 22.0,
                "verifiedAt": "2026-09-10T12:00:00-07:00",
                "curatorSnapshot": {
                    "approvedPrice": 22.0,
                    "approvedPriceLabel": "$22.00 all-in",
                    "approvedCategory": "shows",
                    "curatorNote": "Approved early bird tier per curator review",
                    "approvedAt": "2026-09-10T12:00:00-07:00",
                    "sourceUrl": "https://showpass.com/indie-rock-showcase/"
                }
            }
        }

    @patch.object(EventPricingSearchEngine, "probe_live_pricing")
    def test_01_no_drift_when_price_matches(self, mock_probe):
        """When live page price matches approved price, no drift is detected."""
        mock_probe.return_value = {
            "success": True,
            "finalPrice": 22.0,
            "isSoldOut": False
        }
        res = EventPricingSearchEngine.check_curator_drift(self.approved_event)
        self.assertFalse(res.get("isDrift"))

    @patch.object(EventPricingSearchEngine, "probe_live_pricing")
    def test_02_minor_variance_under_one_dollar_not_drift(self, mock_probe):
        """Variance under $1.00 CAD (e.g. 50 cent fee fluctuation) is not material drift."""
        mock_probe.return_value = {
            "success": True,
            "finalPrice": 22.50,
            "isSoldOut": False
        }
        res = EventPricingSearchEngine.check_curator_drift(self.approved_event)
        self.assertFalse(res.get("isDrift"))

    @patch.object(EventPricingSearchEngine, "probe_live_pricing")
    def test_03_price_increase_triggers_drift_and_audit_note(self, mock_probe):
        """Live price increase >= $1.00 CAD triggers drift and an informative audit note."""
        mock_probe.return_value = {
            "success": True,
            "finalPrice": 28.50,
            "isSoldOut": False
        }
        res = EventPricingSearchEngine.check_curator_drift(self.approved_event)
        self.assertTrue(res.get("isDrift"))
        self.assertFalse(res.get("isVerified"))
        self.assertIn("Previously approved at $22.00 CAD", res["quarantineReason"])
        self.assertIn("$28.50 CAD", res["quarantineReason"])
        self.assertIn("Approved early bird tier", res["quarantineReason"])

    @patch.object(EventPricingSearchEngine, "probe_live_pricing")
    def test_04_budget_cap_exceeded_triggers_drift_and_cap_note(self, mock_probe):
        """Live price jump exceeding $50.00 CAD triggers drift and notes the $50 cap violation."""
        mock_probe.return_value = {
            "success": True,
            "finalPrice": 65.00,
            "isSoldOut": False
        }
        res = EventPricingSearchEngine.check_curator_drift(self.approved_event)
        self.assertTrue(res.get("isDrift"))
        self.assertTrue(res.get("isOverBudget"))
        self.assertIn("exceeds the $50.00 CAD budget limit", res["quarantineReason"])
        self.assertIn("$65.00 CAD", res["quarantineReason"])

    @patch.object(EventPricingSearchEngine, "probe_live_pricing")
    def test_05_sold_out_triggers_drift(self, mock_probe):
        """If event becomes sold out on the live page, drift is detected."""
        mock_probe.return_value = {
            "success": True,
            "finalPrice": 22.0,
            "isSoldOut": True
        }
        res = EventPricingSearchEngine.check_curator_drift(self.approved_event)
        self.assertTrue(res.get("isDrift"))
        self.assertTrue(res.get("isSoldOut"))
        self.assertIn("sold out", res["quarantineReason"].lower())


if __name__ == "__main__":
    unittest.main()
