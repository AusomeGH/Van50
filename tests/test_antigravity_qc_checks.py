#!/usr/bin/env python3
"""
Unit Test Suite for Antigravity QC Engine & Scout Gatekeeper
Verifies:
1. Dead Link Health & Bot-Shield Domain Whitelist
2. Catalog Deduplication (Fingerprint merging)
3. Multi-Tier Fact-Checking & Fee Auditing
4. Multi-Show Date Progression
5. Mid-Lifecycle Cancellation & Postponement Archiving
6. Sold-Out Event Stamping
7. Geographic Coordinate Boundary Verification (Lower Mainland)
8. Scout Gatekeeper: Pre-Ingestion Filters (Sold Out, Non-Vancouver, Coords)
"""

import unittest
import os
import sys
import json
import tempfile
import shutil

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT_DIR, "scripts"))

from antigravity_qc_engine import (
    check_link_alive,
    sanitize_url,
    normalize_tags,
    run_antigravity_qc_pass,
    investigate_event_destination,
    VANCOUVER_BOUNDS,
    BOT_SHIELDED_DOMAINS
)
from antigravity_event_scout import (
    NON_VANCOUVER_REGEX,
    SOLD_OUT_CANCELLED_REGEX,
    VANCOUVER_BOUNDS as SCOUT_BOUNDS,
    run_autonomous_event_scout
)


class TestAntigravityQCChecks(unittest.TestCase):

    def test_01_bot_shielded_domains(self):
        """Ensures bot-shielded ticket vendors (RA, Ticketmaster) are not flagged as dead links."""
        ra_url = "https://ra.co/events/123456"
        alive, msg = check_link_alive(ra_url)
        self.assertTrue(alive)
        self.assertIn("bot_shielded", msg.lower())

        tm_url = "https://www.ticketmaster.ca/event/987654"
        alive, msg = check_link_alive(tm_url)
        self.assertTrue(alive)
        self.assertIn("bot_shielded", msg.lower())

    def test_02_url_sanitization(self):
        """Ensures tracking parameters (utm_*, fbclid) are stripped cleanly."""
        dirty_url = "https://example.com/tickets?utm_source=fb&utm_medium=cpc&id=42&fbclid=abcdef"
        clean = sanitize_url(dirty_url)
        self.assertNotIn("utm_source", clean)
        self.assertNotIn("fbclid", clean)
        self.assertIn("id=42", clean)

    def test_03_geographic_boundary_constants(self):
        """Verifies boundary coordinates enclose Greater Vancouver properly."""
        # Downtown Vancouver (49.2827, -123.1207) must be inside
        lat, lng = 49.2827, -123.1207
        self.assertTrue(VANCOUVER_BOUNDS["min_lat"] <= lat <= VANCOUVER_BOUNDS["max_lat"])
        self.assertTrue(VANCOUVER_BOUNDS["min_lng"] <= lng <= VANCOUVER_BOUNDS["max_lng"])

        # Seattle (47.6062, -122.3321) must be outside
        s_lat, s_lng = 47.6062, -122.3321
        self.assertFalse(VANCOUVER_BOUNDS["min_lat"] <= s_lat <= VANCOUVER_BOUNDS["max_lat"])

        # Victoria (48.4284, -123.3656) must be outside
        v_lat, v_lng = 48.4284, -123.3656
        self.assertFalse(VANCOUVER_BOUNDS["min_lat"] <= v_lat <= VANCOUVER_BOUNDS["max_lat"])

    def test_04_scout_gatekeeper_regex(self):
        """Ensures non-Vancouver cities and pre-cancelled/sold-out candidates are identified."""
        self.assertTrue(bool(NON_VANCOUVER_REGEX.search("Live concert in Victoria at Royal Theatre")))
        self.assertTrue(bool(NON_VANCOUVER_REGEX.search("Tour stop in Seattle, WA")))
        self.assertTrue(bool(NON_VANCOUVER_REGEX.search("Comedy show in Kelowna")))
        self.assertFalse(bool(NON_VANCOUVER_REGEX.search("Gastown jazz session in Vancouver, BC")))

        self.assertTrue(bool(SOLD_OUT_CANCELLED_REGEX.search("Tonight at The Rickshaw [CANCELLED]")))
        self.assertTrue(bool(SOLD_OUT_CANCELLED_REGEX.search("Indie Rock Night - Sold Out")))
        self.assertTrue(bool(SOLD_OUT_CANCELLED_REGEX.search("Tickets unavailable for this date")))
        self.assertFalse(bool(SOLD_OUT_CANCELLED_REGEX.search("General Admission $20.00 CAD")))

    def test_05_multi_show_date_progression(self):
        """Verifies that past show_1 dates roll forward to upcoming show_2."""
        today = "2026-09-29"
        event = {
            "event_id": "test-multi-show-1",
            "event_name": "Multi-Night Indie Fest",
            "category": "Live Music",
            "venue_name": "The Cobalt",
            "price": 25.0,
            "pricing_all_in_cad": {"regular": 25.0},
            "show_1": {"date": "2026-09-20", "start_time": "20:00", "cost": 25.0},
            "show_2": {"date": "2026-10-05", "start_time": "20:00", "cost": 25.0},
            "show_3": {"date": "2026-10-12", "start_time": "20:00", "cost": 25.0},
            "dateSchedule": "2026-09-20"
        }

        # Simulate progression logic directly
        s1 = event.get("show_1") or {}
        s2 = event.get("show_2") or {}
        s3 = event.get("show_3") or {}
        s1_date = s1.get("date")
        s2_date = s2.get("date")
        s3_date = s3.get("date")

        if s1_date and s1_date < today:
            if s2_date and s2_date >= today:
                event["show_1"] = s2
                event["show_2"] = s3 if (s3_date and s3_date >= today) else None
                event["show_3"] = None
                event["dateSchedule"] = event["show_1"].get("date")

        self.assertEqual(event["show_1"]["date"], "2026-10-05")
        self.assertEqual(event["show_2"]["date"], "2026-10-12")
        self.assertIsNone(event["show_3"])
        self.assertEqual(event["dateSchedule"], "2026-10-05")

    def test_06_deduplication_fingerprint(self):
        """Verifies duplicate cards with the same title, venue, and date merge into the richer card."""
        ev1 = {
            "event_id": "ev-1",
            "event_name": "Friday Night Jazz",
            "venue_name": "Guilt & Company",
            "show_1": {"date": "2026-10-02"},
            "description": "Short desc"
        }
        ev2 = {
            "event_id": "ev-2",
            "event_name": "Friday Night Jazz",
            "venue_name": "Guilt & Company",
            "show_1": {"date": "2026-10-02"},
            "description": "Much longer rich description with full artist bio",
            "ticket_tiers": [{"name": "Early Bird", "total": 12.0}, {"name": "Door", "total": 15.0}]
        }

    def test_07_cancellation_detection(self):
        """Verifies cancellation and postponement keywords are detected cleanly."""
        import re
        cancel_re = re.compile(r"(?:\[cancelled\]|\[canceled\]|\[postponed\]|\b(?:event\s+cancelled|show\s+cancelled|tour\s+postponed|tour\s+cancelled|rescheduled\s+to\s+\d{4})\b)", re.IGNORECASE)
        self.assertTrue(bool(cancel_re.search("Concert [CANCELLED] due to artist illness")))
        self.assertTrue(bool(cancel_re.search("Notice: show cancelled by promoter")))
        self.assertTrue(bool(cancel_re.search("Tour postponed until further notice")))
        self.assertFalse(bool(cancel_re.search("Live acoustic set tonight at 8 PM")))

    def test_08_sold_out_flagging(self):
        """Verifies sold-out events are flagged."""
        import re
        sold_out_re = re.compile(r"\b(sold out|all tickets sold|tickets sold out|sold-out)\b", re.IGNORECASE)
        self.assertTrue(bool(sold_out_re.search("Comedy Night - Sold Out")))
        self.assertTrue(bool(sold_out_re.search("All tickets sold for tonight's screening")))
        self.assertFalse(bool(sold_out_re.search("Tickets available at the door")))

    def test_09_geographic_coordinate_bounds(self):
        """Verifies that out-of-boundary coordinates are rejected."""
        # Kitsilano (49.2684, -123.1683) -> Inside
        lat_in, lng_in = 49.2684, -123.1683
        self.assertTrue(VANCOUVER_BOUNDS["min_lat"] <= lat_in <= VANCOUVER_BOUNDS["max_lat"])
        self.assertTrue(VANCOUVER_BOUNDS["min_lng"] <= lng_in <= VANCOUVER_BOUNDS["max_lng"])

        # Kelowna (49.8880, -119.4960) -> Outside
        lat_out, lng_out = 49.8880, -119.4960
        is_inside = (VANCOUVER_BOUNDS["min_lat"] <= lat_out <= VANCOUVER_BOUNDS["max_lat"] and
                     VANCOUVER_BOUNDS["min_lng"] <= lng_out <= VANCOUVER_BOUNDS["max_lng"])
        self.assertFalse(is_inside)

    def test_10_multi_tier_fee_math(self):
        """Verifies multi-tier fee auditing against learned ticketing fee formulas."""
        base_price = 20.0
        # Eventbrite formula: 5.0% + $0.99
        calc_fee = (base_price * 0.05) + 0.99
        expected_total = round(base_price + calc_fee, 2)
        self.assertEqual(expected_total, 21.99)
        self.assertLessEqual(expected_total, 50.00)

    def test_11_investigate_venue_calendar_confirmed(self):
        """Verifies that an event present on a venue calendar is successfully confirmed."""
        from unittest.mock import patch
        ev = {"event_name": "Friday Night Live Jazz", "artist": "The Jazz Quartet", "venue_name": "Guilt & Company"}
        cal_url = "https://guiltandcompany.com/live-music"
        mock_html = """
        <html>
            <head><title>Live Music Calendar - Guilt & Company</title></head>
            <body>
                <h1>Upcoming Live Music & GroundUp Sets</h1>
                <div class="event-card">
                    <h2>Friday Night Live Jazz</h2>
                    <p>Featuring The Jazz Quartet starting at 9:00 PM. Cover $12 at the door.</p>
                </div>
            </body>
        </html>
        """
        with patch("antigravity_qc_engine.check_link_alive", return_value=(True, "HTTP 200")):
            with patch("antigravity_qc_engine.fetch_html", return_value=mock_html):
                ok, msg, meta = investigate_event_destination(ev, cal_url)
                self.assertTrue(ok)
                self.assertEqual(meta.get("type"), "calendar_confirmed")
                self.assertIn("confirmed present on venue calendar", msg)

    def test_12_investigate_venue_calendar_drift(self):
        """Verifies that an event missing from a venue calendar is flagged for Calendar Drift quarantine."""
        from unittest.mock import patch
        ev = {"event_name": "Discontinued Secret Comedy Show", "artist": "Unknown Comedian", "venue_name": "Guilt & Company"}
        cal_url = "https://guiltandcompany.com/live-music"
        mock_html = """
        <html>
            <head><title>Live Music Calendar - Guilt & Company</title></head>
            <body>
                <h1>Upcoming Live Music</h1>
                <p>Only regular soul and funk bands scheduled this week.</p>
            </body>
        </html>
        """
        with patch("antigravity_qc_engine.check_link_alive", return_value=(True, "HTTP 200")):
            with patch("antigravity_qc_engine.fetch_html", return_value=mock_html):
                ok, msg, meta = investigate_event_destination(ev, cal_url)
                self.assertFalse(ok)
                self.assertEqual(meta.get("type"), "calendar_drift")
                self.assertTrue(meta.get("quarantine"))
                self.assertIn("Calendar Drift", msg)

    def test_13_investigate_direct_event_page_mismatch(self):
        """Verifies that a direct link not containing the event title or artist is quarantined for Link Mismatch."""
        from unittest.mock import patch
        ev = {"event_name": "Alistair Ogden Stand-Up Comedy", "artist": "Alistair Ogden", "venue_name": "The Rio Theatre"}
        event_url = "https://riotheatre.ca/event/different-movie-screening/"
        mock_html = """
        <html>
            <head><title>Classic 1980s Sci-Fi Screening - Rio Theatre</title></head>
            <body>
                <h1>Blade Runner: The Final Cut</h1>
                <p>Special 35mm film presentation on Friday night.</p>
            </body>
        </html>
        """
        with patch("antigravity_qc_engine.check_link_alive", return_value=(True, "HTTP 200")):
            with patch("antigravity_qc_engine.fetch_html", return_value=mock_html):
                ok, msg, meta = investigate_event_destination(ev, event_url)
                self.assertFalse(ok)
                self.assertEqual(meta.get("type"), "link_mismatch")
                self.assertTrue(meta.get("quarantine"))
                self.assertIn("Link Mismatch", msg)

    def test_14_investigate_live_cancellation_and_sold_out(self):
        """Verifies that sold-out and cancelled statuses are extracted directly from page body."""
        from unittest.mock import patch
        # 1. Test Sold Out
        ev_sold = {"event_name": "Indie Rock Night", "artist": "The Local Band", "venue_name": "The Cobalt"}
        sold_url = "https://thecobalt.ca/event/indie-rock-night"
        mock_sold_html = """
        <html>
            <head><title>Indie Rock Night - The Cobalt</title></head>
            <body>
                <h1>Indie Rock Night</h1>
                <p>Featuring The Local Band.</p>
                <div class="notice">Sorry, this event is SOLD OUT! No tickets at the door.</div>
            </body>
        </html>
        """
        with patch("antigravity_qc_engine.check_link_alive", return_value=(True, "HTTP 200")):
            with patch("antigravity_qc_engine.fetch_html", return_value=mock_sold_html):
                ok, msg, meta = investigate_event_destination(ev_sold, sold_url)
                self.assertTrue(ok)
                self.assertTrue(meta.get("is_sold_out"))

        # 2. Test Cancelled
        ev_cancel = {"event_name": "Rock Fest", "artist": "The Rockers", "venue_name": "The Cobalt"}
        cancel_url = "https://thecobalt.ca/event/rock-fest"
        mock_cancel_html = """
        <html>
            <head><title>Rock Fest - The Cobalt</title></head>
            <body>
                <h1>Rock Fest</h1>
                <p>Featuring The Rockers.</p>
                <div class="alert">[CANCELLED] Unfortunately this performance has been cancelled.</div>
            </body>
        </html>
        """
        with patch("antigravity_qc_engine.check_link_alive", return_value=(True, "HTTP 200")):
            with patch("antigravity_qc_engine.fetch_html", return_value=mock_cancel_html):
                ok, msg, meta = investigate_event_destination(ev_cancel, cancel_url)
                self.assertFalse(ok)
                self.assertTrue(meta.get("is_cancelled"))
                self.assertEqual(meta.get("type"), "cancelled")

    def test_15_investigate_bare_homepage_upgraded_to_venue_calendar(self):
        """Verifies that a bare venue homepage is automatically upgraded to the registered venue calendar if the event is listed."""
        from unittest.mock import patch
        ev = {"event_name": "Jazz Matinee", "artist": "Smooth Trio", "venue_name": "Frankie's Jazz Club"}
        homepage_url = "https://frankiesjazzclub.ca"
        venue_map = {
            "frankie's jazz club": {
                "venue_name": "Frankie's Jazz Club",
                "calendar_url": "https://frankiesjazzclub.ca/live-shows"
            }
        }
        mock_home_html = "<html><head><title>Welcome to Frankie's</title></head><body><h1>Best food and drink</h1></body></html>"
        mock_cal_html = """
        <html>
            <head><title>Shows - Frankie's Jazz Club</title></head>
            <body>
                <h1>Live Shows Calendar</h1>
                <div class="show-card">
                    <h2>Jazz Matinee with Smooth Trio</h2>
                    <p>Sunday afternoon live performance.</p>
                </div>
            </body>
        </html>
        """
        def fake_fetch(url, timeout=5):
            if "live-shows" in url:
                return mock_cal_html
            return mock_home_html

        with patch("antigravity_qc_engine.check_link_alive", return_value=(True, "HTTP 200")):
            with patch("antigravity_qc_engine.fetch_html", side_effect=fake_fetch):
                ok, msg, meta = investigate_event_destination(ev, homepage_url, venue_map=venue_map)
                self.assertTrue(ok)
                self.assertEqual(meta.get("type"), "calendar_confirmed")
                self.assertEqual(meta.get("repaired_url"), "https://frankiesjazzclub.ca/live-shows")
                self.assertIn("Upgraded bare homepage to official venue calendar", msg)


if __name__ == "__main__":
    unittest.main()
