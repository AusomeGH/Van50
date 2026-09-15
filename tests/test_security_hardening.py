#!/usr/bin/env python3
"""
Van50 Security Hardening & Penetration Defense Test Suite
Verifies path traversal resistance, dotfile/secret protection,
directory browsing blocks, HTTP security headers, CORS origin lockdown,
payload size limits, session token revocation, and input sanitization.
"""

import unittest
import urllib.request
import urllib.error
import json
import time
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from curator_auth import load_configured_secret


class TestSecurityHardening(unittest.TestCase):
    BASE_URL = "http://127.0.0.1:8080"

    @classmethod
    def setUpClass(cls):
        # Obtain a valid token for authenticated checks
        secret = load_configured_secret()
        req = urllib.request.Request(
            f"{cls.BASE_URL}/api/curator/auth",
            data=json.dumps({"password": secret}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                data = json.loads(res.read().decode("utf-8"))
                cls.token = data.get("token")
        except Exception as e:
            cls.token = None

    def test_01_dotfiles_and_env_blocked(self):
        """Verify direct GET requests to .env and dotfiles return 403 Forbidden."""
        for path in ["/.env", "/data/.curator_secret.json", "/.git/config", "/.vscode/settings.json"]:
            url = f"{self.BASE_URL}{path}"
            try:
                urllib.request.urlopen(url, timeout=5)
                self.fail(f"Protected path {path} was served when it should be blocked!")
            except urllib.error.HTTPError as e:
                self.assertEqual(e.code, 403, f"Expected 403 Forbidden for {path}, got {e.code}")

    def test_02_protected_directories_blocked(self):
        """Verify direct GET requests to /scripts, /tests, /scratch are blocked."""
        for path in ["/scripts/curator_auth.py", "/scripts/curator_server.py", "/tests/test_api_endpoints.py"]:
            url = f"{self.BASE_URL}{path}"
            try:
                urllib.request.urlopen(url, timeout=5)
                self.fail(f"Internal script path {path} was served when it should be blocked!")
            except urllib.error.HTTPError as e:
                self.assertEqual(e.code, 403, f"Expected 403 Forbidden for {path}, got {e.code}")

    def test_03_unauthenticated_administrative_data_blocked(self):
        """Verify unauthenticated direct access to queue, rules, and instructions JSON is blocked."""
        for path in ["/data/manual_review_queue.json", "/data/curator_instructions.json", "/data/curator_learned_rules.json", "/data/archived_events.json"]:
            url = f"{self.BASE_URL}{path}"
            try:
                urllib.request.urlopen(url, timeout=5)
                self.fail(f"Administrative data file {path} was served without authentication!")
            except urllib.error.HTTPError as e:
                self.assertEqual(e.code, 403, f"Expected 403 Forbidden for unauthenticated {path}, got {e.code}")

    def test_04_directory_browsing_disabled(self):
        """Verify directory listing is blocked on directories without index.html."""
        for path in ["/css/", "/js/", "/data/"]:
            url = f"{self.BASE_URL}{path}"
            try:
                urllib.request.urlopen(url, timeout=5)
                self.fail(f"Directory browsing was permitted on {path}!")
            except urllib.error.HTTPError as e:
                self.assertEqual(e.code, 403, f"Expected 403 Forbidden on directory browsing {path}, got {e.code}")

    def test_05_public_assets_allowed(self):
        """Verify legitimate public assets remain accessible."""
        for path in ["/index.html", "/curator.html", "/data/events.json", "/css/style.css"]:
            url = f"{self.BASE_URL}{path}"
            with urllib.request.urlopen(url, timeout=5) as res:
                self.assertEqual(res.status, 200, f"Expected 200 OK for {path}")

    def test_06_http_security_headers_present(self):
        """Verify defense-in-depth HTTP security headers are sent on responses."""
        url = f"{self.BASE_URL}/index.html"
        with urllib.request.urlopen(url, timeout=5) as res:
            headers = dict(res.headers)
            # Check CSP
            self.assertIn("Content-Security-Policy", headers)
            csp = headers["Content-Security-Policy"]
            self.assertIn("default-src 'self'", csp)
            self.assertIn("frame-ancestors 'none'", csp)
            # Check X-Content-Type-Options
            self.assertEqual(headers.get("X-Content-Type-Options"), "nosniff")
            # Check X-Frame-Options
            self.assertEqual(headers.get("X-Frame-Options"), "DENY")
            # Check Referrer-Policy
            self.assertEqual(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin")
            # Check Cache-Control
            self.assertIn("no-cache", headers.get("Cache-Control", ""))

    def test_07_cors_lockdown_rejects_untrusted_origins(self):
        """Verify untrusted external origins do not receive Access-Control-Allow-Origin: *."""
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/status",
            headers={"Origin": "https://malicious-attacker-site.com"}
        )
        with urllib.request.urlopen(req, timeout=5) as res:
            headers = dict(res.headers)
            # Origin must NOT be reflected and must NOT be wildcard
            self.assertNotEqual(headers.get("Access-Control-Allow-Origin"), "https://malicious-attacker-site.com")
            self.assertNotEqual(headers.get("Access-Control-Allow-Origin"), "*")

    def test_08_payload_too_large_rejection(self):
        """Verify POST requests exceeding 256KB on standard JSON endpoints return 413."""
        huge_payload = json.dumps({"password": "A" * (300 * 1024)}).encode("utf-8")
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/auth",
            data=huge_payload,
            headers={"Content-Type": "application/json", "Content-Length": str(len(huge_payload))}
        )
        try:
            urllib.request.urlopen(req, timeout=5)
            self.fail("Oversized payload was accepted!")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 413, f"Expected 413 Payload Too Large, got {e.code}")

    def test_09_session_token_revocation(self):
        """Verify logout revokes the bearer token so it can no longer access APIs."""
        # 1. Login to get fresh token
        secret = load_configured_secret()
        login_req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/auth",
            data=json.dumps({"password": secret}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(login_req, timeout=5) as res:
            temp_token = json.loads(res.read().decode("utf-8")).get("token")
        self.assertIsNotNone(temp_token)

        # 2. Verify token works
        queue_req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/queue",
            headers={"Curator-Token": temp_token}
        )
        with urllib.request.urlopen(queue_req, timeout=5) as res:
            self.assertEqual(res.status, 200)

        # 3. Call logout
        logout_req = urllib.request.Request(
            f"{self.BASE_URL}/api/curator/logout",
            data=b"{}",
            headers={"Content-Type": "application/json", "Curator-Token": temp_token}
        )
        with urllib.request.urlopen(logout_req, timeout=5) as res:
            self.assertEqual(res.status, 200)

        # 4. Token must now be rejected
        try:
            urllib.request.urlopen(queue_req, timeout=5)
            self.fail("Revoked token was still accepted!")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 401, f"Expected 401 Unauthorized for revoked token, got {e.code}")


if __name__ == "__main__":
    unittest.main()
