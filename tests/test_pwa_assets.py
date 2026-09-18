#!/usr/bin/env python3
"""
Unit test suite for Van50 Progressive Web App (PWA) assets.
Validates Web App Manifest compliance, Android icon dimensions/files,
Service Worker caching configurations, and HTML head integration.
"""

import os
import json
import unittest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST_PATH = os.path.join(BASE_DIR, "manifest.json")
SW_PATH = os.path.join(BASE_DIR, "sw.js")
PWA_JS_PATH = os.path.join(BASE_DIR, "js", "pwa-install.js")
INDEX_PATH = os.path.join(BASE_DIR, "index.html")
ICONS_DIR = os.path.join(BASE_DIR, "icons")


class TestPwaAssets(unittest.TestCase):

    def test_manifest_structure_and_fields(self):
        """Validates that manifest.json exists and adheres to W3C / Android PWA standards."""
        self.assertTrue(os.path.exists(MANIFEST_PATH), "manifest.json does not exist")
        
        with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
            manifest = json.load(f)

        self.assertIn("name", manifest)
        self.assertIn("short_name", manifest)
        self.assertIn("start_url", manifest)
        self.assertEqual(manifest.get("display"), "standalone", "PWA display must be 'standalone' for native app mode")
        self.assertIn("theme_color", manifest)
        self.assertIn("background_color", manifest)
        self.assertIn("icons", manifest)
        self.assertGreaterEqual(len(manifest["icons"]), 4, "Must contain at least 4 icon configurations")

        # Verify maskable and standard icons are declared
        purposes = [i.get("purpose") for i in manifest["icons"]]
        self.assertIn("any", purposes, "Must have icons with purpose 'any'")
        self.assertIn("maskable", purposes, "Must have icons with purpose 'maskable' for Android adaptive icons")

    def test_icon_files_exist_and_non_empty(self):
        """Verifies that all icon files declared in the manifest exist on disk with valid file size."""
        with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
            manifest = json.load(f)

        for icon_entry in manifest.get("icons", []):
            src = icon_entry.get("src")
            icon_path = os.path.join(BASE_DIR, src.replace("/", os.sep))
            self.assertTrue(os.path.exists(icon_path), f"Icon file missing: {icon_path}")
            size = os.path.getsize(icon_path)
            self.assertGreater(size, 1000, f"Icon file too small or corrupted: {icon_path} ({size} bytes)")

        # Verify apple-touch-icon
        apple_icon = os.path.join(ICONS_DIR, "apple-touch-icon.png")
        self.assertTrue(os.path.exists(apple_icon), "apple-touch-icon.png missing")

    def test_service_worker_lifecycle(self):
        """Validates that sw.js defines install, activate, and fetch lifecycle listeners."""
        self.assertTrue(os.path.exists(SW_PATH), "sw.js does not exist")
        with open(SW_PATH, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn("addEventListener('install'", content, "Service Worker missing 'install' event listener")
        self.assertIn("addEventListener('activate'", content, "Service Worker missing 'activate' event listener")
        self.assertIn("addEventListener('fetch'", content, "Service Worker missing 'fetch' event listener")
        self.assertIn("CACHE_NAME", content, "Service Worker missing CACHE_NAME constant")
        self.assertIn("data/events.json", content, "Service Worker missing network-first handling for events data")

    def test_pwa_install_script(self):
        """Validates that js/pwa-install.js registers the service worker and captures beforeinstallprompt."""
        self.assertTrue(os.path.exists(PWA_JS_PATH), "js/pwa-install.js does not exist")
        with open(PWA_JS_PATH, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn("navigator.serviceWorker", content, "pwa-install.js must use navigator.serviceWorker")
        self.assertIn("register('sw.js')", content, "pwa-install.js must register sw.js")
        self.assertIn("beforeinstallprompt", content, "pwa-install.js must capture beforeinstallprompt")
        self.assertIn("display-mode: standalone", content, "pwa-install.js must check standalone display mode")

    def test_index_html_pwa_integration(self):
        """Validates that index.html includes manifest link, theme color, and pwa-install.js script."""
        with open(INDEX_PATH, "r", encoding="utf-8") as f:
            html = f.read()

        self.assertIn('<link rel="manifest" href="manifest.json">', html, "index.html missing manifest link")
        self.assertIn('<meta name="theme-color"', html, "index.html missing theme-color meta tag")
        self.assertIn('<meta name="mobile-web-app-capable" content="yes">', html, "index.html missing mobile-web-app-capable")
        self.assertIn('js/pwa-install.js', html, "index.html missing pwa-install.js script tag")


if __name__ == "__main__":
    unittest.main()
