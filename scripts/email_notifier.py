#!/usr/bin/env python3
"""
Van50 Automated Daily Status Email Notifier
Generates a styled, responsive summary of the daily discovery crawl
and dispatches it via SMTP (e.g. Gmail, Outlook, Amazon SES) using standard library smtplib.
Zero third-party dependencies required.
"""

import os
import sys
import json
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime
from typing import Dict, Any, List, Optional

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
LOGS_DIR = os.path.join(DATA_DIR, "automation_logs")
AUDIT_REPORT_PATH = os.path.join(LOGS_DIR, "link_audit_latest.json")


def load_dotenv():
    """Loads variables from project .env file into os.environ without third-party deps."""
    env_path = os.path.join(BASE_DIR, ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k and k not in os.environ:
                        os.environ[k] = v
        except Exception:
            pass


load_dotenv()


def build_email_content(summary: Dict[str, Any], quarantined_items: Optional[List[Dict[str, Any]]] = None) -> tuple[str, str]:
    """Generates both plain-text and rich HTML versions of the daily status email."""
    ts = summary.get("lastRunAt", datetime.now().isoformat())
    total_events = summary.get("totalEvents", 0)
    quarantine_count = summary.get("quarantinedCount", 0)
    duration = summary.get("durationSeconds", 0)
    backup_file = summary.get("backupFile", "N/A")
    status = summary.get("status", "success")

    # Plain text alternative
    text_lines = [
        "=== VAN50 DAILY DISCOVERY REPORT ===",
        f"Timestamp:        {ts}",
        f"Status:           {status.upper()}",
        f"Verified Events:  {total_events} (All-in <= $50 CAD)",
        f"Quarantined:      {quarantine_count} items awaiting review",
        f"Crawl Duration:   {duration} seconds",
        f"Safety Backup:    {backup_file}",
    ]
    link_audit = summary.get("linkAudit")
    if not link_audit and os.path.exists(AUDIT_REPORT_PATH):
        try:
            with open(AUDIT_REPORT_PATH, "r", encoding="utf-8") as af:
                link_audit = json.load(af)
        except Exception:
            pass

    link_issues = link_audit.get("issues", []) if link_audit else []

    if link_audit:
        text_lines.append(f"Link Health:      {link_audit.get('healthyCount', 0)} healthy, {link_audit.get('botProtectedCount', 0)} bot-shielded, {link_audit.get('deadCount', 0)} dead, {link_audit.get('soft404Count', 0)} soft-404 ({link_audit.get('quarantinedCount', 0)} quarantined)")
    text_lines.append("")

    if link_issues:
        text_lines.append(f"--- Link Scan Issues Detected ({len(link_issues)} Items Auto-Quarantined) ---")
        for iss in link_issues:
            code = iss.get("statusCode")
            tag = f"HTTP {code}" if code and code != 200 else ("SOFT 404" if iss.get("isSoft404") else "BROKEN LINK")
            text_lines.append(f"- [{tag}] \"{iss.get('title')}\" @ {iss.get('venue')}")
            text_lines.append(f"  URL:    {iss.get('url')}")
            text_lines.append(f"  Reason: {iss.get('failureReason')}")
        text_lines.append("")

    if quarantined_items:
        text_lines.append("--- Items Flagged for Manual Review ---")
        for item in quarantined_items[:5]:
            text_lines.append(f"- {item.get('title')} @ {item.get('venue')} (Flag: {item.get('flagReason')})")
        if len(quarantined_items) > 5:
            text_lines.append(f"... and {len(quarantined_items) - 5} more.")
        text_lines.append("")
    text_lines.append("Open Curator Studio: http://127.0.0.1:8080/curator.html")

    plain_text = "\n".join(text_lines)

    # Rich Responsive HTML
    is_success = (status == "success")
    if link_issues:
        status_bg = "#ef4444"
        status_text = f"{len(link_issues)} Link Issue{'s' if len(link_issues) > 1 else ''} Quarantined"
    elif is_success:
        status_bg = "#10b981"
        status_text = "Discovery Successful"
    else:
        status_bg = "#f59e0b"
        status_text = "Attention Recommended"

    # Link Scan Issues Table if present
    link_issues_section = ""
    if link_issues:
        l_rows = []
        for iss in link_issues:
            code = iss.get("statusCode")
            is_dead = iss.get("isDead", False)
            tag = f"HTTP {code}" if code and code != 200 else ("Soft 404" if iss.get("isSoft404") else "Broken")
            badge_bg = "rgba(239, 68, 68, 0.15)" if is_dead else "rgba(245, 158, 11, 0.15)"
            badge_color = "#f87171" if is_dead else "#fbbf24"
            badge_border = "rgba(239, 68, 68, 0.4)" if is_dead else "rgba(245, 158, 11, 0.4)"

            raw_url = str(iss.get("url") or "")
            truncated_url = (raw_url[:38] + "...") if len(raw_url) > 40 else raw_url
            reason = str(iss.get("failureReason") or "Link failed validation")

            l_rows.append(f"""
            <tr style="border-bottom: 1px solid #23304a;">
              <td style="padding: 10px 10px; vertical-align: top; white-space: nowrap;">
                <span style="background: {badge_bg}; color: {badge_color}; border: 1px solid {badge_border}; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 4px;">
                  {tag}
                </span>
              </td>
              <td style="padding: 10px 10px; vertical-align: top;">
                <div style="color: #f8fafc; font-weight: 600; font-size: 13px;">{iss.get('title', 'Unknown Event')}</div>
                <div style="color: #94a3b8; font-size: 12px; margin-top: 2px;">{iss.get('venue', 'Unknown Venue')}</div>
              </td>
              <td style="padding: 10px 10px; vertical-align: top; font-size: 12px;">
                <a href="{raw_url}" style="color: #38bdf8; text-decoration: none; word-break: break-all;" title="{raw_url}" target="_blank">
                  {truncated_url}
                </a>
              </td>
              <td style="padding: 10px 10px; vertical-align: top; color: #fca5a5; font-size: 12px;">
                {reason}
              </td>
            </tr>
            """)

        link_issue_rows = "".join(l_rows)
        link_issues_section = f"""
        <div style="margin-top: 24px; background: #162033; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 12px; padding: 20px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 18px;">🔗</span>
              <h3 style="margin: 0; color: #f87171; font-size: 16px; font-weight: 700;">
                Link Scan Issues Detected ({len(link_issues)} Items Auto-Quarantined)
              </h3>
            </div>
            <span style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; text-transform: uppercase;">
              Auto-Quarantined
            </span>
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
            <thead>
              <tr style="border-bottom: 1px solid #334155; color: #64748b; font-size: 11px; text-transform: uppercase;">
                <th style="padding: 8px 10px; width: 14%;">Issue</th>
                <th style="padding: 8px 10px; width: 32%;">Event & Venue</th>
                <th style="padding: 8px 10px; width: 24%;">URL</th>
                <th style="padding: 8px 10px; width: 30%;">Failure Details</th>
              </tr>
            </thead>
            <tbody>
              {link_issue_rows}
            </tbody>
          </table>
          <div style="margin-top: 14px; text-align: right;">
            <a href="http://127.0.0.1:8080/curator.html" style="color: #38bdf8; text-decoration: none; font-size: 13px; font-weight: 600;">Open Curator Studio to Triage Broken Links &rarr;</a>
          </div>
        </div>
        """

    quarantine_rows = ""
    if quarantined_items:
        rows = []
        for q in quarantined_items[:6]:
            price = f"${float(q.get('attemptedPrice', 0)):.2f}"
            rows.append(f"""
            <tr style="border-bottom: 1px solid #23304a;">
              <td style="padding: 10px 12px; color: #f8fafc; font-weight: 600;">{q.get('title', 'Unknown Event')}</td>
              <td style="padding: 10px 12px; color: #94a3b8;">{q.get('venue', 'Unknown Venue')}</td>
              <td style="padding: 10px 12px; color: #38bdf8; font-weight: 600;">{price}</td>
              <td style="padding: 10px 12px; color: #fca5a5; font-size: 13px;">{str(q.get('flagReason', 'Needs check'))[:80]}</td>
            </tr>
            """)
        quarantine_rows = "".join(rows)

    quarantine_section = ""
    if quarantine_count > 0:
        quarantine_section = f"""
        <div style="margin-top: 28px; background: #162033; border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 12px; padding: 20px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 14px;">
            <span style="font-size: 18px;">⚠️</span>
            <h3 style="margin: 0; color: #fbbf24; font-size: 16px; font-weight: 700;">Quarantine Review Queue ({quarantine_count} Items)</h3>
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; text-align: left;">
            <thead>
              <tr style="border-bottom: 1px solid #334155; color: #64748b; font-size: 12px; text-transform: uppercase;">
                <th style="padding: 8px 12px;">Event Title</th>
                <th style="padding: 8px 12px;">Venue</th>
                <th style="padding: 8px 12px;">Price</th>
                <th style="padding: 8px 12px;">Flag Reason</th>
              </tr>
            </thead>
            <tbody>
              {quarantine_rows}
            </tbody>
          </table>
          <div style="margin-top: 14px; text-align: right;">
            <a href="http://127.0.0.1:8080/curator.html" style="color: #38bdf8; text-decoration: none; font-size: 13px; font-weight: 600;">Open Curator Studio to Triage &rarr;</a>
          </div>
        </div>
        """

    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Van50 Daily Discovery Report</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <div style="max-width: 620px; margin: 0 auto; background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
    
    <!-- Top Header -->
    <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 24px 28px; border-bottom: 1px solid #1e293b;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h1 style="margin: 0; font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em;">
            🌲 Van<span style="color: #38bdf8;">50</span> Discovery Report
          </h1>
          <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 13px;">
            Autonomous crawl completed at {ts[:19].replace('T', ' ')} Vancouver time
          </p>
        </div>
        <div>
          <span style="background: {status_bg}; color: #090d16; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px; text-transform: uppercase;">
            {status_text}
          </span>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div style="padding: 28px;">
      
      <!-- Metrics Grid -->
      <table style="width: 100%; border-collapse: separate; border-spacing: 12px 0; margin-bottom: 24px;">
        <tr>
          <td style="background: #162033; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; text-align: center; width: 50%;">
            <div style="color: #94a3b8; font-size: 12px; text-transform: uppercase; font-weight: 600; margin-bottom: 6px;">Verified Events (&le; $50)</div>
            <div style="color: #38bdf8; font-size: 32px; font-weight: 800; line-height: 1;">{total_events}</div>
            <div style="color: #10b981; font-size: 12px; margin-top: 6px;">✓ 100% Fee-Inclusive</div>
          </td>
          <td style="background: #162033; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; text-align: center; width: 50%;">
            <div style="color: #94a3b8; font-size: 12px; text-transform: uppercase; font-weight: 600; margin-bottom: 6px;">Quarantined Review</div>
            <div style="color: {'#fbbf24' if quarantine_count > 0 else '#94a3b8'}; font-size: 32px; font-weight: 800; line-height: 1;">{quarantine_count}</div>
            <div style="color: #94a3b8; font-size: 12px; margin-top: 6px;">Crawl time: {duration}s</div>
          </td>
        </tr>
      </table>

      <!-- Pipeline Telemetry -->
      <div style="background: #111827; border: 1px solid #1e293b; border-radius: 10px; padding: 14px 18px; font-size: 13px; color: #94a3b8; margin-bottom: 20px;">
        <div style="margin-bottom: 6px;">💾 <strong>Safety Snapshot:</strong> <code style="color: #38bdf8;">{backup_file}</code></div>
        <div style="margin-bottom: {'6px' if link_audit else '0'};">🗓️ <strong>Next Autonomous Run:</strong> {summary.get('nextRunAt', 'Tomorrow 04:00 AM')}</div>
        {f'''<div style="margin-top: 6px;">🔗 <strong>Link Health Audit:</strong> {link_audit.get("healthyCount", 0)} healthy &bull; {link_audit.get("botProtectedCount", 0)} bot-shielded &bull; <span style="color: {'#f87171' if (link_audit.get('deadCount', 0) + link_audit.get('soft404Count', 0)) > 0 else '#10b981'};">{link_audit.get('deadCount', 0)} dead, {link_audit.get('soft404Count', 0)} soft-404 ({link_audit.get('quarantinedCount', 0)} quarantined)</span></div>''' if link_audit else ''}
      </div>

      <!-- Link Issues Table if present -->
      {link_issues_section}

      <!-- Quarantine Table if present -->
      {quarantine_section}

      <!-- Call to Action Buttons -->
      <div style="margin-top: 28px; text-align: center;">
        <a href="https://ausomegh.github.io/Van50/" style="display: inline-block; background: #38bdf8; color: #090d16; font-weight: 700; font-size: 14px; padding: 10px 22px; border-radius: 8px; text-decoration: none; margin-right: 10px;">
          View Live Website &rarr;
        </a>
      </div>

    </div>

    <!-- Footer -->
    <div style="background: #090d16; padding: 16px 28px; border-top: 1px solid #1e293b; text-align: center; font-size: 12px; color: #64748b;">
      Van50 Autonomous Cultural Discovery Engine &bull; Vancouver, BC &bull; Strictly &le; $50.00 CAD
    </div>

  </div>
</body>
</html>
"""
    return plain_text, html


def send_daily_status_email(summary: Dict[str, Any], to_email: Optional[str] = None) -> bool:
    """
    Sends the daily discovery status report to the configured recipient via SMTP.
    Returns True if sent successfully, False otherwise.
    """
    load_dotenv()
    smtp_user = os.environ.get("SMTP_USERNAME") or os.environ.get("NEWSLETTER_GMAIL_USER")
    smtp_pass = os.environ.get("SMTP_PASSWORD") or os.environ.get("NEWSLETTER_GMAIL_PASSWORD")
    recipient = to_email or os.environ.get("NOTIFICATION_EMAIL_TO") or smtp_user
    smtp_server = os.environ.get("SMTP_SERVER", "smtp.gmail.com")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    sender = os.environ.get("SMTP_FROM", f"Van50 Discovery <{smtp_user}>" if smtp_user else "Van50 Discovery")

    if not smtp_user or not smtp_pass or not recipient:
        print("[EMAIL NOTICE] SMTP credentials not configured (SMTP_USERNAME, SMTP_PASSWORD, NOTIFICATION_EMAIL_TO). Skipping email dispatch.")
        return False

    quarantined_items = []
    if os.path.exists(QUEUE_PATH):
        try:
            with open(QUEUE_PATH, "r", encoding="utf-8") as f:
                q_data = json.load(f)
                quarantined_items = q_data.get("quarantinedEvents", [])
        except Exception:
            pass

    plain_text, html = build_email_content(summary, quarantined_items)

    link_audit = summary.get("linkAudit")
    link_issues = link_audit.get("issues", []) if link_audit else []
    if not link_issues and os.path.exists(AUDIT_REPORT_PATH):
        try:
            with open(AUDIT_REPORT_PATH, "r", encoding="utf-8") as af:
                link_issues = json.load(af).get("issues", [])
        except Exception:
            pass

    if link_issues:
        subject = f"🚨 Van50 Daily Discovery: {len(link_issues)} Broken Link(s) Quarantined | {summary.get('totalEvents', 0)} Verified"
    elif summary.get("status") == "success":
        status_word = "Success"
        subject = f"🌲 Van50 Daily Discovery: {summary.get('totalEvents', 0)} Events Verified ({status_word})"
    else:
        status_word = "Review Needed"
        subject = f"⚠️ Van50 Daily Discovery: {summary.get('totalEvents', 0)} Events Verified ({status_word})"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = recipient

    msg.attach(MIMEText(plain_text, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        if smtp_port == 465:
            server = smtplib.SMTP_SSL(smtp_server, smtp_port, timeout=15)
        else:
            server = smtplib.SMTP(smtp_server, smtp_port, timeout=15)
            server.ehlo()
            server.starttls()
            server.ehlo()

        server.login(smtp_user, smtp_pass)
        server.send_message(msg)
        server.quit()
        print(f"[EMAIL OK] Daily discovery report successfully sent to {recipient}")
        return True
    except Exception as e:
        print(f"[EMAIL ERROR] Failed to deliver status email: {e}")
        return False


if __name__ == "__main__":
    test_summary = {
        "status": "success",
        "lastRunAt": datetime.now().isoformat(),
        "nextRunAt": (datetime.now()).isoformat(),
        "durationSeconds": 8.45,
        "totalEvents": 79,
        "quarantinedCount": 2,
        "backupFile": "events_2026-09-17_040000.json"
    }

    if "--test-send" in sys.argv:
        send_daily_status_email(test_summary)
    else:
        text, h = build_email_content(test_summary, [{"title": "Test Flagged Comedy", "venue": "Little Mountain Gallery", "attemptedPrice": 15.0, "flagReason": "Generic link test"}])
        print("=== GENERATED PLAIN TEXT PREVIEW ===")
        print(text)
        print("\nHTML Length:", len(h), "bytes. Generated clean HTML email.")
