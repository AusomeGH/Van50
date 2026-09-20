#!/usr/bin/env python3
"""
Unit tests for Van50 Automated Newsletter Ingestor (scripts/newsletter_ingestor.py).
Tests extraction accuracy, venue & neighborhood resolution, budget cap enforcement,
deduplication, and local file processing.
"""

import os
import json
import unittest
import tempfile
import shutil
from unittest.mock import patch, MagicMock

from scripts.newsletter_ingestor import (
    extract_candidates_from_content,
    extract_price,
    extract_venue_and_neighborhood,
    extract_date_schedule,
    stage_candidates_to_review_queue,
    process_local_file
)

SAMPLE_NEWSLETTER_HTML = """
<!DOCTYPE html>
<html>
<body>
  <h1>Weekend Outings Roundup</h1>
  <p>Here are the best budget-friendly cultural events in Vancouver this weekend.</p>

  <div class="event-item">
    <h2>1. Live Indie Pop: Lunar Bloom</h2>
    <p><strong>Venue:</strong> The Fox Cabaret (2321 Main St)</p>
    <p><strong>Date & Time:</strong> Friday, October 9, 2026 at 8:00 PM</p>
    <p><strong>Price:</strong> $15.00 Advance / $20.00 Door</p>
    <p><a href="https://foxcabaret.com/events/lunar-bloom">Buy Tickets ($15-$20)</a></p>
  </div>

  <hr>

  <div class="event-item">
    <h2>2. Comedy Open Mic Night</h2>
    <p><strong>Venue:</strong> Little Mountain Gallery (110 Water St)</p>
    <p><strong>Date & Time:</strong> Saturday, October 10, 2026 at 9:00 PM</p>
    <p><strong>Price:</strong> $12.00 CAD</p>
    <p><a href="https://littlemountaingallery.ca/events/open-mic">Tickets ($12.00)</a></p>
  </div>

  <hr>

  <div class="event-item">
    <h2>3. Ultra High Roller VIP Champagne Lounge</h2>
    <p><strong>Venue:</strong> Vancouver Convention Centre</p>
    <p><strong>Date:</strong> Saturday, October 10, 2026 at 7:00 PM</p>
    <p><strong>Price:</strong> $120.00 CAD per guest</p>
    <p><a href="https://example.com/tickets/vip-lounge">VIP Tickets ($120)</a></p>
  </div>

  <hr>

  <div class="event-item">
    <h2>4. Eastside Community Printmaking Workshop</h2>
    <p><strong>Venue:</strong> The Cultch (1895 Venables St)</p>
    <p><strong>Date:</strong> Sunday, October 11, 2026 at 2:00 PM</p>
    <p><strong>Price:</strong> Free Admission</p>
    <p><a href="https://thecultch.com/events/printmaking">Free RSVP</a></p>
  </div>
</body>
</html>
"""


class TestNewsletterIngestor(unittest.TestCase):

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.addCleanup(lambda: shutil.rmtree(self.test_dir, ignore_errors=True))

    def test_price_extraction(self):
        # Free variants
        p, lbl = extract_price("Admission is Free for all ages")
        self.assertEqual(p, 0.0)
        self.assertEqual(lbl, "Free ($0)")

        p, lbl = extract_price("Tickets: PWYC (Pay what you can)")
        self.assertEqual(p, 0.0)

        # Dollar amounts
        p, lbl = extract_price("Tickets are $18.50 at the door")
        self.assertEqual(p, 18.50)
        self.assertEqual(lbl, "$18.50 CAD")

        # Range - should take max price to be conservative & budget safe
        p, lbl = extract_price("$15.00 Advance / $20.00 Door")
        self.assertEqual(p, 20.0)
        self.assertEqual(lbl, "$20.00 CAD")

    def test_venue_mapping(self):
        venue, addr, neigh, cat = extract_venue_and_neighborhood("Playing live at the Fox Cabaret this Friday!")
        self.assertEqual(venue, "The Fox Cabaret")
        self.assertIn("Mount Pleasant", neigh)
        self.assertEqual(cat, "music")

        venue, addr, neigh, cat = extract_venue_and_neighborhood("Comedy set at Little Mountain Gallery")
        self.assertEqual(venue, "Little Mountain Gallery")
        self.assertEqual(cat, "shows")

        venue, addr, neigh, cat = extract_venue_and_neighborhood("Experimental theater at The Cultch")
        self.assertEqual(venue, "The Cultch")
        self.assertEqual(cat, "shows")

    def test_extract_candidates_and_budget_cap(self):
        candidates = extract_candidates_from_content(
            SAMPLE_NEWSLETTER_HTML,
            sender="events@do604.com",
            subject="Vancouver Weekend Highlights"
        )

        # 4 blocks in HTML, but VIP Lounge is $120.00 (> $50.00 CAD) so must be excluded!
        self.assertEqual(len(candidates), 3)

        titles = [c["title"] for c in candidates]
        self.assertIn("Live Indie Pop: Lunar Bloom", titles)
        self.assertIn("Comedy Open Mic Night", titles)
        self.assertIn("Eastside Community Printmaking Workshop", titles)
        self.assertNotIn("Ultra High Roller VIP Champagne Lounge", titles)

        # Verify Lunar Bloom details
        lunar = next(c for c in candidates if "Lunar Bloom" in c["title"])
        self.assertEqual(lunar["venue"], "The Fox Cabaret")
        self.assertEqual(lunar["price"], 20.0)
        self.assertEqual(lunar["source"], "newsletter")
        self.assertEqual(lunar["newsletterSender"], "events@do604.com")
        self.assertIn("foxcabaret.com", lunar["websiteUrl"])

        # Verify Free event details
        cultch = next(c for c in candidates if "Printmaking" in c["title"])
        self.assertEqual(cultch["price"], 0.0)
        self.assertEqual(cultch["priceLabel"], "Free ($0)")
        self.assertIn("thecultch.com", cultch["websiteUrl"])

    def test_deduplication_and_staging(self):
        queue_file = os.path.join(self.test_dir, "manual_review_queue.json")
        events_file = os.path.join(self.test_dir, "events.json")
        archive_file = os.path.join(self.test_dir, "archived_events.json")

        with open(queue_file, "w", encoding="utf-8") as f:
            json.dump({"quarantinedEvents": []}, f)
        with open(events_file, "w", encoding="utf-8") as f:
            json.dump({"events": []}, f)
        with open(archive_file, "w", encoding="utf-8") as f:
            json.dump({"archivedEvents": []}, f)

        with patch("scripts.newsletter_ingestor.QUEUE_PATH", queue_file), \
             patch("scripts.newsletter_ingestor.EVENTS_PATH", events_file), \
             patch("scripts.newsletter_ingestor.ARCHIVE_PATH", archive_file):

            candidates = extract_candidates_from_content(SAMPLE_NEWSLETTER_HTML)
            res1 = stage_candidates_to_review_queue(candidates, dry_run=False)
            self.assertEqual(res1["queued"], 3)
            self.assertEqual(res1["skipped"], 0)

            # Second run with same candidates should detect duplicates and skip all
            res2 = stage_candidates_to_review_queue(candidates, dry_run=False)
            self.assertEqual(res2["queued"], 0)
            self.assertEqual(res2["skipped"], 3)

            # Check queue contents
            with open(queue_file, "r", encoding="utf-8") as f:
                saved = json.load(f)
            self.assertEqual(len(saved["quarantinedEvents"]), 3)
            self.assertEqual(saved["metadata"]["pendingCount"], 3)

    def test_process_local_file(self):
        sample_path = os.path.join(self.test_dir, "test_newsletter.html")
        with open(sample_path, "w", encoding="utf-8") as f:
            f.write(SAMPLE_NEWSLETTER_HTML)

        queue_file = os.path.join(self.test_dir, "manual_review_queue.json")
        with open(queue_file, "w", encoding="utf-8") as f:
            json.dump({"quarantinedEvents": []}, f)

        with patch("scripts.newsletter_ingestor.QUEUE_PATH", queue_file), \
             patch("scripts.newsletter_ingestor.EVENTS_PATH", os.path.join(self.test_dir, "nonexistent_events.json")), \
             patch("scripts.newsletter_ingestor.ARCHIVE_PATH", os.path.join(self.test_dir, "nonexistent_archive.json")):

            res = process_local_file(sample_path, dry_run=False)
            self.assertEqual(res["queued"], 3)


if __name__ == "__main__":
    unittest.main()
