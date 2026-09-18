import unittest
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(BASE_DIR, "scripts")
sys.path.insert(0, SCRIPTS_DIR)

from universal_link_hunter import AutonomousDeepLinkHunter
from pricing_search_engine import PlatformAndPolicyExtractor

class TestPricingUniversal(unittest.TestCase):
    def test_anchor_inspection_unquoted_href_and_title(self):
        """Hunter must extract unquoted hrefs and score title/aria-label attributes."""
        html = '''
        <div class="wp-block-image">
            <figure class="aligncenter size-large">
                <a href=https://www.vanartgallery.bc.ca/free title="Learn More about FREE FIRST FRIDAY NIGHTS.">
                    <img src="https://www.vanartgallery.bc.ca/wp-content/uploads/banner.jpg" alt="Free Nights">
                </a>
            </figure>
        </div>
        '''
        tokens = ["free", "first", "friday", "nights"]
        candidates = {}
        AutonomousDeepLinkHunter._inspect_anchor_tags(
            html, "https://www.vanartgallery.bc.ca/visit/", tokens, candidates
        )

        self.assertIn("https://www.vanartgallery.bc.ca/free", candidates)
        matched = candidates["https://www.vanartgallery.bc.ca/free"]["matched_tokens"]
        self.assertTrue(any("text:free" in m for m in matched))
        self.assertTrue(any("url:free" in m for m in matched))

    def test_museum_free_program_priority_over_daytime_tickets(self):
        """When an event is declared as free, published free program terms must take precedence over adult daytime tickets."""
        html = '''
        <html>
            <body>
                <h1>Admission & Hours</h1>
                <div class="rates">
                    <p>Adult General Admission is $29.00</p>
                    <p>Senior Admission is $25.00</p>
                </div>
                <div class="special-events">
                    <h2>Free First Friday Nights presented by BMO</h2>
                    <p>Admission is free on the first Friday of every month from 4 PM to 8 PM. Free admission tickets are released online.</p>
                </div>
            </body>
        </html>
        '''
        item = {
            "id": "vag-first-friday",
            "title": "Vancouver Art Gallery: Free First Friday Nights",
            "venue": "Vancouver Art Gallery",
            "pricingType": "free",
            "basePrice": 0.0
        }

        res = PlatformAndPolicyExtractor.extract_general_fee_schedule(html, "https://www.vanartgallery.bc.ca/visit/", item)
        self.assertTrue(res["success"])
        self.assertEqual(res["finalPrice"], 0.0)
        self.assertEqual(res["priceLabel"], "Free ($0)")

    def test_no_zero_dollar_door_label(self):
        """Zero dollar events must never produce a label like '$0.00 door'."""
        html = '''
        <html>
            <body>
                <h1>Community Public Event</h1>
                <p>Admission: Free admission for all community members.</p>
            </body>
        </html>
        '''
        item = {
            "id": "community-gathering",
            "title": "Free Community Gathering",
            "venue": "Civic Plaza",
            "pricingType": "door",
            "basePrice": 0.0
        }

        res = PlatformAndPolicyExtractor.extract_general_fee_schedule(html, "https://vancouver.ca/event", item)
        self.assertTrue(res["success"])
        self.assertEqual(res["finalPrice"], 0.0)
        self.assertNotEqual(res["priceLabel"], "$0.00 door")
        self.assertEqual(res["priceLabel"], "Free ($0)")

if __name__ == "__main__":
    unittest.main()
