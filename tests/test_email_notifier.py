#!/usr/bin/env python3
"""
Unit Test Suite for Van50 Daily Status Email Notifier
Verifies:
- HTML and plain text generation
- Metrics and quarantine table formatting
- Missing credential handling (fail-safe fallback)
- Mocked SMTP connection and message dispatch
"""

import unittest
import os
import sys
from unittest.mock import patch, MagicMock

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(BASE_DIR, "scripts")
sys.path.insert(0, SCRIPTS_DIR)

from email_notifier import build_email_content, send_daily_status_email


class TestEmailNotifier(unittest.TestCase):

    def setUp(self):
        self.summary = {
            "status": "success",
            "lastRunAt": "2026-09-17T04:00:00-07:00",
            "nextRunAt": "2026-09-18T04:00:00-07:00",
            "durationSeconds": 12.34,
            "totalEvents": 79,
            "quarantinedCount": 1,
            "backupFile": "events_2026-09-17_040000.json"
        }
        self.quarantined = [
            {
                "title": "Unverified Indie Gig",
                "venue": "The Rickshaw Theatre",
                "attemptedPrice": 25.0,
                "flagReason": "Generic link detected"
            }
        ]

    def test_01_build_content_structure(self):
        text, html = build_email_content(self.summary, self.quarantined)
        self.assertIn("VAN50 DAILY DISCOVERY REPORT", text)
        self.assertIn("79", text)
        self.assertIn("Unverified Indie Gig", text)

        self.assertIn("Van50 Daily Discovery Report", html)
        self.assertIn("79", html)
        self.assertIn("The Rickshaw Theatre", html)
        self.assertIn("Generic link detected", html)
        self.assertIn("<!DOCTYPE html>", html)

    def test_02_missing_credentials_fails_safe(self):
        # Clear environment variables
        with patch.dict(os.environ, {}, clear=True):
            sent = send_daily_status_email(self.summary)
            self.assertFalse(sent)

    @patch("smtplib.SMTP")
    def test_03_smtp_dispatch_success(self, mock_smtp_class):
        mock_server = MagicMock()
        mock_smtp_class.return_value = mock_server

        fake_env = {
            "SMTP_SERVER": "smtp.example.com",
            "SMTP_PORT": "587",
            "SMTP_USERNAME": "test@example.com",
            "SMTP_PASSWORD": "fake-password",
            "NOTIFICATION_EMAIL_TO": "curator@example.com"
        }

        with patch.dict(os.environ, fake_env):
            sent = send_daily_status_email(self.summary, to_email="curator@example.com")
            self.assertTrue(sent)
            mock_server.starttls.assert_called_once()
            mock_server.login.assert_called_once_with("test@example.com", "fake-password")
            mock_server.send_message.assert_called_once()
            mock_server.quit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
