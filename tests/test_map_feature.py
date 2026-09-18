import unittest
import json
import os
import re

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class TestMapFeature(unittest.TestCase):
    def setUp(self):
        self.events_path = os.path.join(BASE_DIR, "data", "events.json")
        self.leaflet_js = os.path.join(BASE_DIR, "vendor", "leaflet", "leaflet.js")
        self.leaflet_css = os.path.join(BASE_DIR, "vendor", "leaflet", "leaflet.css")
        self.map_js = os.path.join(BASE_DIR, "js", "map.js")
        self.components_css = os.path.join(BASE_DIR, "css", "components.css")
        self.index_html = os.path.join(BASE_DIR, "index.html")

    def test_all_events_have_valid_vancouver_coordinates(self):
        """Every event in events.json must have valid finite GPS coordinates in the Greater Vancouver region."""
        with open(self.events_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        events = data.get("events", [])
        self.assertGreater(len(events), 0)

        for ev in events:
            coords = ev.get("coordinates")
            self.assertIsNotNone(coords, f"Event {ev.get('id')} missing coordinates")
            self.assertIsInstance(coords, list, f"Event {ev.get('id')} coordinates not a list")
            self.assertEqual(len(coords), 2, f"Event {ev.get('id')} coordinates length != 2")

            lat, lng = coords
            self.assertIsInstance(lat, (int, float), f"Event {ev.get('id')} lat not a number")
            self.assertIsInstance(lng, (int, float), f"Event {ev.get('id')} lng not a number")

            # Greater Vancouver bounding box check
            self.assertTrue(49.0 <= lat <= 49.5, f"Event {ev.get('id')} lat {lat} out of Vancouver range")
            self.assertTrue(-123.5 <= lng <= -122.5, f"Event {ev.get('id')} lng {lng} out of Vancouver range")

    def test_vendor_leaflet_assets_present(self):
        """Local Leaflet assets must exist with non-trivial file size for offline capability."""
        self.assertTrue(os.path.exists(self.leaflet_js), "vendor/leaflet/leaflet.js missing")
        self.assertTrue(os.path.exists(self.leaflet_css), "vendor/leaflet/leaflet.css missing")
        self.assertGreater(os.path.getsize(self.leaflet_js), 100000, "leaflet.js too small")
        self.assertGreater(os.path.getsize(self.leaflet_css), 10000, "leaflet.css too small")

    def test_index_html_uses_local_leaflet_vendor(self):
        """index.html must reference vendor/leaflet/ assets."""
        with open(self.index_html, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("vendor/leaflet/leaflet.css", content)
        self.assertIn("vendor/leaflet/leaflet.js", content)

    def test_map_js_exports_safe_functions(self):
        """map.js must define and export initVancouverMap, updateMapMarkers, and invalidateVancouverMap."""
        with open(self.map_js, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("window.initVancouverMap = initVancouverMap", content)
        self.assertIn("window.updateMapMarkers = updateMapMarkers", content)
        self.assertIn("window.invalidateVancouverMap = invalidateVancouverMap", content)
        # Ensure defensive pricing formatting without throwing
        self.assertIn("Number.isFinite", content)

    def test_custom_pin_css_no_double_transform(self):
        """custom-map-pin must NOT use transform: translate(-50%, -50%) because iconAnchor already centers it."""
        with open(self.components_css, "r", encoding="utf-8") as f:
            content = f.read()
        # Find .custom-map-pin definition
        m = re.search(r'\.custom-map-pin\s*\{([^}]+)\}', content)
        self.assertIsNotNone(m, ".custom-map-pin not found in components.css")
        pin_rules = m.group(1)
        self.assertNotIn("translate(-50%, -50%)", pin_rules)

if __name__ == "__main__":
    unittest.main()
