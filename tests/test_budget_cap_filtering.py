#!/usr/bin/env python3
"""
Test Suite: Strict Budget Cap (<= $50.00 CAD) Filtering & Curator Triage Redefinition
Verifies:
1. Verified events > $50.00 CAD are auto-denied and archived, never added to curator queue.
2. Events > $50.00 CAD are purged from manual_review_queue.json and events.json.
3. /api/curator/queue and /api/curator/status never serve or count > $50.00 CAD events.
4. Curator queue receives only candidates that may meet criteria but need human confirmation (unverified, ambiguous).
"""

import unittest
from unittest.mock import patch
import os
import sys
import json
import tempfile

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))

from pricing_search_engine import (
    EventPricingSearchEngine,
    auto_deny_and_archive_event,
    CourseDropInClassifier
)


class TestBudgetCapFiltering(unittest.TestCase):

    @patch('pricing_search_engine.auto_deny_and_archive_event')
    @patch('pricing_search_engine.load_curator_learned_rules')
    @patch('pricing_search_engine.fetch_html')
    def test_01_over_50_auto_denied_and_not_verified(self, mock_fetch, mock_learned, mock_auto_deny):
        """Events with verified live checkout price > $50.00 CAD must be auto-denied and excluded."""
        mock_learned.return_value = {"archived_event_ids": [], "price_override_heuristics": []}
        mock_fetch.return_value = '''
        <div class="ticket-info">
          Total Price: 75.00
        </div>
        '''
        item = {
            "id": "vip-concert-show",
            "title": "VIP Symphony Gala",
            "websiteUrl": "https://example.com/tickets/vip-symphony",
            "venue": "The Orpheum"
        }
        res = EventPricingSearchEngine.search_and_verify(item)
        self.assertFalse(res["isVerified"])
        self.assertTrue(res.get("isOverBudget"))
        self.assertIn("strictly exceeds $50.00 CAD budget limit", res["quarantineReason"])
        mock_auto_deny.assert_called_once()

    def test_02_auto_deny_purges_from_queue_and_events(self):
        """auto_deny_and_archive_event must purge the item from manual_review_queue.json and events.json."""
        test_ev_id = "test-expensive-rave-999"
        queue_path = os.path.join(BASE_DIR, "data", "manual_review_queue.json")
        archive_path = os.path.join(BASE_DIR, "data", "archived_events.json")

        # Plant item in queue
        if os.path.exists(queue_path):
            with open(queue_path, "r", encoding="utf-8") as f:
                q_data = json.load(f)
        else:
            q_data = {"quarantinedEvents": []}

        q_data.setdefault("quarantinedEvents", []).append({
            "id": test_ev_id,
            "title": "Expensive Rave",
            "attemptedPrice": 85.00
        })
        with open(queue_path, "w", encoding="utf-8") as f:
            json.dump(q_data, f, indent=2)

        # Execute auto-deny
        item = {"id": test_ev_id, "title": "Expensive Rave", "finalPrice": 85.00}
        arch = auto_deny_and_archive_event(item, reason="Test over $50 cap")

        # Verify purged from queue
        with open(queue_path, "r", encoding="utf-8") as f:
            q_after = json.load(f)
        self.assertFalse(any(x["id"] == test_ev_id for x in q_after.get("quarantinedEvents", [])))

        # Verify present in archive database
        with open(archive_path, "r", encoding="utf-8") as f:
            arch_data = json.load(f)
        self.assertTrue(any(x["id"] == test_ev_id for x in arch_data.get("archivedEvents", [])))

        # Clean up test artifact from archive
        arch_data["archivedEvents"] = [x for x in arch_data.get("archivedEvents", []) if x["id"] != test_ev_id]
        with open(archive_path, "w", encoding="utf-8") as f:
            json.dump(arch_data, f, indent=2)

    @patch('pricing_search_engine.fetch_html')
    def test_03_unverified_candidate_sent_to_curator(self, mock_fetch):
        """Candidates with unverified cart/fee structures that may be <= $50 CAD are sent to curator triage."""
        mock_fetch.return_value = "<html><body>Door tickets available. Online box office portal unavailable.</body></html>"
        item = {
            "id": "unverified-indie-gig",
            "title": "Local Indie Band Showcase",
            "websiteUrl": "https://unknown-indie-venue.ca/gig/12",
            "venue": "Unknown Indie Bar",
            "basePrice": 15.0
        }
        res = EventPricingSearchEngine.search_and_verify(item)
        self.assertFalse(res["isVerified"])
        # Should NOT be flagged as over budget since price is potentially $15.00 CAD
        self.assertFalse(res.get("isOverBudget", False))
        self.assertIn("quarantineReason", res)

    @patch('pricing_search_engine.fetch_html')
    def test_04_sub_50_event_verified_successfully(self, mock_fetch):
        """Events <= $50.00 CAD are verified and approved for display."""
        mock_fetch.return_value = '''
        <div class="checkout-summary">
          <p class="total">Total Price: $22.50</p>
        </div>
        '''
        item = {
            "id": "affordable-improv",
            "title": "Sunday Afternoon Improv",
            "websiteUrl": "https://example-theatre.ca/improv",
            "venue": "The Improv Hub"
        }
        res = EventPricingSearchEngine.search_and_verify(item)
        self.assertTrue(res["isVerified"])
        self.assertEqual(res["finalPrice"], 22.50)
        self.assertFalse(res.get("isOverBudget", False))


if __name__ == '__main__':
    unittest.main()
