#!/usr/bin/env python3
"""
Unit tests for Curator 13 Discrete Live Dimensions and Optional Dimension Semantics.
Verifies:
1. All 13 discrete dimensions are present in verify_screenshot and compare_ocr_with_card:
   - title (Event Name)
   - date (Date of Event)
   - time (Event Time)
   - schedule (Schedule & Recurrence)
   - frequency (Frequency)
   - category (Category)
   - location (Venue & Location)
   - price (Price & Fees)
   - link (Event Link)
   - provider (Ticketing Provider)
   - description (Description)
   - lineup (Lineup - Optional)
   - restrictions (Restrictions & Policies - Optional)
2. Time and Schedule are separate discrete dimensions.
3. Link and Ticketing Provider are separate discrete dimensions.
4. Description, Lineup, and Restrictions are separate discrete dimensions.
5. Lineup and Restrictions have isOptional=True and status="optional" when absent,
   and they do not block alignment (isFullyAligned=True).
6. HTML elements for all 13 dimension cards exist in curator.html.
7. curator.css contains .dim-pill.pill-optional and .curator-dimension-card.dim-status-optional.
8. curator.js defines all 13 keys in LIVE_DIMENSION_KEYS and handles applySingleDimension for all 13.
"""

import unittest
import os
import sys
import json
import re

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))

from screenshot_verifier import compare_ocr_with_card, parse_ocr_text

class TestCurator13Dimensions(unittest.TestCase):

    def setUp(self):
        self.sample_card = {
            "id": "test-ev-1",
            "title": "Comedy Cave Underground Showcase",
            "venue": "The Comedy Cave",
            "price": 15.0,
            "category": "comedy",
            "frequency": "weekly",
            "dateSchedule": "Every Friday at 8:00 PM",
            "websiteUrl": "https://comedycave.ca/tickets",
            "provider": "Eventbrite",
            "description": "Vancouver's premier underground comedy showcase featuring top local and touring talent.",
            "artist": "Local Lineup",
            "agePolicy": "19+"
        }

    def test_all_13_dimensions_present(self):
        raw_ocr = {
            "raw_text": "Comedy Cave Underground Showcase The Comedy Cave 8:00 PM Doors 7:30 PM Tickets $15 CAD on Eventbrite 19+ featuring Jane Doe and John Smith https://comedycave.ca/tickets",
            "total_price": 15.0,
            "base_price": 12.0,
            "fee_amount": 3.0,
            "fee_breakdown": "$12.00 + $3.00 fee = $15.00 CAD",
            "extracted_date": "Friday, September 25",
            "doors_time": "7:30 PM",
            "show_time": "8:00 PM",
            "detected_frequency": "weekly",
            "frequency_label": "Weekly Recurring",
            "category": "comedy",
            "category_icon": "🎭",
            "category_label": "Comedy",
            "detected_venue": "The Comedy Cave",
            "provider": "Eventbrite",
            "detected_urls": ["https://comedycave.ca/tickets"],
            "detected_title": "Comedy Cave Underground Showcase",
            "detected_lineup": "Jane Doe and John Smith",
            "age_policy": "19+",
            "snippet": "Vancouver's premier underground comedy showcase"
        }

        result = compare_ocr_with_card(raw_ocr, self.sample_card)
        dims = result.get("dimensions", {})

        expected_13_keys = [
            "title",
            "date",
            "time",
            "schedule",
            "frequency",
            "category",
            "location",
            "price",
            "link",
            "provider",
            "description",
            "lineup",
            "restrictions"
        ]

        self.assertEqual(len(dims), 13, f"Expected 13 dimensions, got {len(dims)}: {list(dims.keys())}")
        for key in expected_13_keys:
            self.assertIn(key, dims, f"Missing dimension key: {key}")
            dim = dims[key]
            self.assertIn("name", dim)
            self.assertIn("icon", dim)
            self.assertIn("displayValue", dim)
            self.assertIn("status", dim)

    def test_discrete_split_dimensions(self):
        """Verify time vs schedule, link vs provider, description vs lineup vs restrictions are unique dimensions."""
        raw_ocr = {
            "raw_text": "Sunset Music Show Doors 6:30 PM Show 7:00 PM Every Saturday Link: https://event.ca Provider: Ticketmaster",
            "doors_time": "6:30 PM",
            "show_time": "7:00 PM",
            "detected_frequency": "weekly",
            "frequency_label": "Weekly Show",
            "detected_urls": ["https://event.ca"],
            "provider": "Ticketmaster",
            "snippet": "Live jazz and blues in the lounge",
            "detected_lineup": "Miles Davis Tribute Quartet",
            "age_policy": "All Ages",
            "total_price": 20.0
        }

        card = {
            "title": "Sunset Music Show",
            "venue": "Jazz Lounge",
            "price": 20.0,
            "dateSchedule": "Every Saturday 7:00 PM",
            "websiteUrl": "https://event.ca",
            "provider": "Ticketmaster",
            "description": "Live jazz and blues in the lounge",
            "artist": "Miles Davis Tribute Quartet",
            "agePolicy": "All Ages"
        }

        res = compare_ocr_with_card(raw_ocr, card)
        dims = res["dimensions"]

        # 1. Time and Schedule are unique dimensions
        self.assertIn("time", dims)
        self.assertIn("schedule", dims)
        self.assertNotEqual(dims["time"]["key"], dims["schedule"]["key"])
        self.assertIn("Doors: 6:30 PM", dims["time"]["displayValue"])

        # 2. Link and Provider are unique dimensions
        self.assertIn("link", dims)
        self.assertIn("provider", dims)
        self.assertNotEqual(dims["link"]["key"], dims["provider"]["key"])
        self.assertEqual(dims["link"]["extracted"], "https://event.ca")
        self.assertEqual(dims["provider"]["extracted"], "Ticketmaster")

        # 3. Description, Lineup, and Restrictions are unique dimensions
        self.assertIn("description", dims)
        self.assertIn("lineup", dims)
        self.assertIn("restrictions", dims)
        self.assertNotEqual(dims["description"]["key"], dims["lineup"]["key"])
        self.assertNotEqual(dims["lineup"]["key"], dims["restrictions"]["key"])
        self.assertEqual(dims["lineup"]["extracted"], "Miles Davis Tribute Quartet")
        self.assertEqual(dims["restrictions"]["extracted"], "All Ages")

    def test_optional_dimensions_when_absent(self):
        """Lineup and restrictions must be marked isOptional=True and status='optional' when absent."""
        empty_ocr = {
            "raw_text": "Sample Concert at The Fox Cabaret Tickets $25",
            "total_price": 25.0,
            "detected_venue": "The Fox Cabaret",
            "detected_title": "Sample Concert",
            # No lineup, no age policy/restrictions
            "detected_lineup": None,
            "age_policy": None
        }

        card = {
            "title": "Sample Concert",
            "venue": "The Fox Cabaret",
            "price": 25.0
        }

        res = compare_ocr_with_card(empty_ocr, card)
        dims = res["dimensions"]

        lineup_dim = dims["lineup"]
        self.assertTrue(lineup_dim.get("isOptional"), "Lineup must be flagged isOptional=True")
        self.assertEqual(lineup_dim.get("status"), "optional", "Lineup must have status='optional' when absent")
        self.assertTrue(lineup_dim.get("isMatch"), "Absent optional dimension must not fail match")

        restrictions_dim = dims["restrictions"]
        self.assertTrue(restrictions_dim.get("isOptional"), "Restrictions must be flagged isOptional=True")
        self.assertEqual(restrictions_dim.get("status"), "optional", "Restrictions must have status='optional' when absent")
        self.assertTrue(restrictions_dim.get("isMatch"), "Absent optional dimension must not fail match")

        # Must not break alignment
        self.assertTrue(res.get("isFullyAligned"), "Missing optional fields must not block full alignment")

    def test_html_dom_has_all_13_dimension_cards(self):
        curator_html_path = os.path.join(BASE_DIR, "curator.html")
        with open(curator_html_path, "r", encoding="utf-8") as f:
            content = f.read()

        expected_ids = [
            "ai-dim-card-title",
            "ai-dim-card-date",
            "ai-dim-card-time",
            "ai-dim-card-schedule",
            "ai-dim-card-frequency",
            "ai-dim-card-category",
            "ai-dim-card-location",
            "ai-dim-card-price",
            "ai-dim-card-link",
            "ai-dim-card-provider",
            "ai-dim-card-description",
            "ai-dim-card-lineup",
            "ai-dim-card-restrictions",
            "btn-apply-dim-title",
            "btn-apply-dim-date",
            "btn-apply-dim-time",
            "btn-apply-dim-schedule",
            "btn-apply-dim-frequency",
            "btn-apply-dim-category",
            "btn-apply-dim-location",
            "btn-apply-dim-price",
            "btn-apply-dim-link",
            "btn-apply-dim-provider",
            "btn-apply-dim-description",
            "btn-apply-dim-lineup",
            "btn-apply-dim-restrictions",
            "btn-apply-all-dimensions"
        ]

        for elem_id in expected_ids:
            self.assertIn(f'id="{elem_id}"', content, f"curator.html missing DOM ID: #{elem_id}")

    def test_css_has_optional_dimension_styling(self):
        curator_css_path = os.path.join(BASE_DIR, "css", "curator.css")
        with open(curator_css_path, "r", encoding="utf-8") as f:
            css = f.read()

        self.assertIn(".dim-pill.pill-optional", css)
        self.assertIn(".curator-dimension-card.dim-status-optional", css)

    def test_js_curator_has_13_live_keys_and_handlers(self):
        curator_js_path = os.path.join(BASE_DIR, "js", "curator.js")
        with open(curator_js_path, "r", encoding="utf-8") as f:
            js = f.read()

        # Check LIVE_DIMENSION_KEYS definition
        for k in ['title', 'date', 'time', 'schedule', 'frequency', 'category', 'location', 'price', 'link', 'provider', 'description', 'lineup', 'restrictions']:
            self.assertIn(f"'{k}'", js, f"LIVE_DIMENSION_KEYS missing key: '{k}'")

        # Check applySingleDimension handlers
        self.assertIn("dimKey === 'title'", js)
        self.assertIn("dimKey === 'date'", js)
        self.assertIn("dimKey === 'time'", js)
        self.assertIn("dimKey === 'schedule'", js)
        self.assertIn("dimKey === 'frequency'", js)
        self.assertIn("dimKey === 'category'", js)
        self.assertIn("dimKey === 'location'", js)
        self.assertIn("dimKey === 'price'", js)
        self.assertIn("dimKey === 'link'", js)
        self.assertIn("dimKey === 'provider'", js)
        self.assertIn("dimKey === 'description'", js)
        self.assertIn("dimKey === 'lineup'", js)
        self.assertIn("dimKey === 'restrictions'", js)

if __name__ == "__main__":
    unittest.main()
