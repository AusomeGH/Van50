#!/usr/bin/env python3
"""
Unit Test Suite: UI Enhancements & Curator Workflow Verification
Validates:
1. Public event card template contains category badge with icon and label.
2. Category filter handler is wired up to category badges.
3. Curator dismissal has zero blocking popups (no confirm() or alert()).
4. Curator studio cards display event categories.
5. CSS rules exist for all event category badges.
"""

import unittest
import os
import re

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class TestUIEnhancements(unittest.TestCase):

    def test_01_no_popups_on_curator_dismissal(self):
        """Curator dismissal must be instant with zero blocking confirm() or alert() dialogs."""
        curator_js_path = os.path.join(BASE_DIR, "js", "curator.js")
        with open(curator_js_path, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertNotIn("confirm(", content, "Found blocking confirm() popup in js/curator.js")
        self.assertNotIn("alert(", content, "Found blocking alert() popup in js/curator.js")
        # Ensure rejectQuarantinedEvent sends the reject request directly
        self.assertIn("rejectQuarantinedEvent", content)
        self.assertIn("'/api/curator/reject'", content)

    def test_02_card_template_displays_category(self):
        """Public card template must render category icon and label in a card-category-badge."""
        app_js_path = os.path.join(BASE_DIR, "js", "app.js")
        with open(app_js_path, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn("card-category-badge", content, "Missing card-category-badge in js/app.js")
        self.assertIn("category-badge-icon", content, "Missing category-badge-icon in js/app.js")
        self.assertIn("category-badge-text", content, "Missing category-badge-text in js/app.js")
        self.assertIn("filterByCategory", content, "Missing filterByCategory handler in js/app.js")

    def test_03_curator_cards_display_category(self):
        """Curator studio cards must display event category information."""
        curator_js_path = os.path.join(BASE_DIR, "js", "curator.js")
        with open(curator_js_path, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn("curator-badge-category", content, "Missing curator-badge-category in js/curator.js")
        self.assertIn("Category:", content, "Missing Category label in js/curator.js")

    def test_04_category_badge_css_styles_exist(self):
        """CSS must define styles for .card-category-badge across all taxonomy categories."""
        css_path = os.path.join(BASE_DIR, "css", "components.css")
        with open(css_path, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn(".card-category-badge", content, "Missing .card-category-badge in css/components.css")
        for cat in ["music", "shows", "cinema", "crafts", "outdoors", "activities", "arts", "trivia", "social"]:
            self.assertIn(f".category-{cat}", content, f"Missing .category-{cat} in css/components.css")

    def test_05_curator_approve_and_dismiss_with_ai_buttons(self):
        """Curator cards and modal must have dedicated buttons for Approve and Instruct AI, and Dismiss and Instruct AI."""
        curator_js_path = os.path.join(BASE_DIR, "js", "curator.js")
        with open(curator_js_path, "r", encoding="utf-8") as f:
            js_content = f.read()

        # Check card action buttons
        self.assertIn("btn-curator-ai-approve", js_content, "Missing btn-curator-ai-approve class in js/curator.js")
        self.assertIn("Approve As-Is", js_content, "Missing Approve As-Is button text in js/curator.js")
        self.assertIn("Instruct AI", js_content, "Missing Instruct AI button text in js/curator.js")

        # Check modal buttons and handler support
        self.assertIn("queue_and_dismiss", js_content, "Missing queue_and_dismiss support in js/curator.js")
        self.assertIn("btn-submit-ai-inst-and-dismiss", js_content, "Missing btn-submit-ai-inst-and-dismiss in js/curator.js")

        # Check curator.html modal buttons
        curator_html_path = os.path.join(BASE_DIR, "curator.html")
        with open(curator_html_path, "r", encoding="utf-8") as f:
            html_content = f.read()

        self.assertIn("btn-submit-ai-inst-and-approve", html_content, "Missing approve button in curator.html")
        self.assertIn("btn-submit-ai-inst-and-dismiss", html_content, "Missing dismiss button in curator.html")
        self.assertIn("Dismiss &amp; Instruct AI", html_content, "Missing Dismiss & Instruct AI text in curator.html")

    def test_06_today_and_category_badge_prominence(self):
        """Today and Category badges on cards must have enlarged font-sizes and enhanced padding."""
        css_path = os.path.join(BASE_DIR, "css", "components.css")
        with open(css_path, "r", encoding="utf-8") as f:
            css = f.read()

        # Check .badge-today enlarged font-size (>= 0.9rem)
        self.assertIn(".card-date-badge.badge-today", css)
        self.assertIn("0.94rem", css, "Expected enlarged font-size for badge-today")

        # Check .card-category-badge enlarged font-size (>= 0.8rem)
        self.assertIn(".card-category-badge", css)
        self.assertIn("0.84rem", css, "Expected enlarged font-size for card-category-badge")
        self.assertIn("uppercase", css, "Expected uppercase letter-spacing styling for badges")

    def test_07_unneeded_emojis_cleaned_from_cards_and_controls(self):
        """Event card template and UI controls must be free of noisy OS emojis."""
        app_js_path = os.path.join(BASE_DIR, "js", "app.js")
        with open(app_js_path, "r", encoding="utf-8") as f:
            app_js = f.read()

        # Check that artist, organizer, roving, and policy badges no longer have emoji noise
        self.assertNotIn('<span class="artist-icon">🎵</span>', app_js)
        self.assertNotIn('<span class="organizer-icon">🏛️</span>', app_js)
        self.assertNotIn('🛡️ ${ev.agePolicy}', app_js)
        self.assertNotIn('🎟️ ${ev.admissionPolicy}', app_js)
        self.assertNotIn('📍 ${ev.venue}', app_js)
        self.assertNotIn('<span>📍</span> <span>${nh}</span>', app_js)
        self.assertNotIn('<span>📅</span>', app_js)

        # Check index.html controls cleaned of noisy emojis
        index_html_path = os.path.join(BASE_DIR, "index.html")
        with open(index_html_path, "r", encoding="utf-8") as f:
            index_html = f.read()

        self.assertNotIn('<span>🎟️ <strong>Ticketed', index_html)
        self.assertNotIn('<span>⚡ Tips</span>', index_html)
        self.assertNotIn('<span>⚡ More Filters</span>', index_html)
        self.assertNotIn('<span>❤️ Saved Events</span>', index_html)


if __name__ == "__main__":
    unittest.main()

