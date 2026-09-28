#!/usr/bin/env python3
"""
Van50 Gemini AI Email & Newsletter Scout
Connects securely to the Van50 submissions inbox (van50.submit@gmail.com via IMAP),
retrieves incoming event announcements, newsletters, and promoter submissions,
and uses Gemini AI to extract structured events under the strict <= $50.00 CAD budget ceiling.

Features:
- Pure Gemini AI reasoning (zero rigid regex parsing)
- Filters out administrative/transactional emails (2FA, account alerts, receipts)
- Enforces strict <= $50.00 CAD all-in budget ceiling (base + platform fees + 5% GST)
- Validates explicit showing dates (zero guessing or extrapolation)
- Ingests approved events into data/events.json or stages ambiguous ones to data/manual_review_queue.json
- Registers newly discovered venues and festivals into data/venues.json & data/festivals.json
- Automatically synchronizes js/data.js
"""

from __future__ import annotations
import os
import sys
import json
import time
import email
import imaplib
import re
from datetime import datetime, timezone
from email.header import decode_header
from html.parser import HTMLParser
from typing import Dict, Any, List, Optional, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
ARCHIVE_PATH = os.path.join(DATA_DIR, "events_archive.json")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
VENUES_PATH = os.path.join(DATA_DIR, "venues.json")
FESTIVALS_PATH = os.path.join(DATA_DIR, "festivals.json")

sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from gemini_event_scout import get_gemini_api_key, call_gemini_direct_json


def load_env():
    """Loads environment variables from .env if present."""
    env_file = os.path.join(BASE_DIR, ".env")
    if os.path.exists(env_file):
        try:
            with open(env_file, "r", encoding="utf-8") as f:
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


load_env()


def get_email_credentials() -> Tuple[Optional[str], Optional[str], str, int, str]:
    """Retrieves Gmail IMAP credentials from environment."""
    load_env()
    user = os.environ.get("NEWSLETTER_GMAIL_USER") or os.environ.get("GMAIL_USER") or os.environ.get("SMTP_USERNAME")
    password = os.environ.get("NEWSLETTER_GMAIL_PASSWORD") or os.environ.get("GMAIL_APP_PASSWORD") or os.environ.get("SMTP_PASSWORD")
    server = os.environ.get("NEWSLETTER_IMAP_SERVER", "imap.gmail.com")
    port = int(os.environ.get("NEWSLETTER_IMAP_PORT", 993))
    folder = os.environ.get("NEWSLETTER_IMAP_FOLDER", "INBOX")

    if password:
        password = password.replace(" ", "")

    return user, password, server, port, folder


def decode_mime(header_val: Optional[str]) -> str:
    """Decodes MIME encoded header string."""
    if not header_val:
        return ""
    parts = decode_header(header_val)
    decoded = []
    for part, enc in parts:
        if isinstance(part, bytes):
            enc = enc or "utf-8"
            try:
                decoded.append(part.decode(enc, errors="replace"))
            except Exception:
                decoded.append(part.decode("latin1", errors="replace"))
        else:
            decoded.append(str(part))
    return "".join(decoded).strip()


class CleanHTMLTextExtractor(HTMLParser):
    """Extracts raw readable text and hyperlinks while skipping scripts and styles."""
    def __init__(self):
        super().__init__()
        self.text_chunks = []
        self.links = []
        self.skip_tags = {"script", "style", "head"}
        self.current_skip = 0

    def handle_starttag(self, tag, attrs):
        tag_lower = tag.lower()
        if tag_lower in self.skip_tags:
            self.current_skip += 1
            return
        if self.current_skip > 0:
            return

        if tag_lower == "a":
            for k, v in attrs:
                if k.lower() == "href" and v and v.startswith("http"):
                    self.links.append(v)
        elif tag_lower in {"br", "p", "div", "h1", "h2", "h3", "h4", "h5", "li", "hr", "tr"}:
            self.text_chunks.append("\n")

    def handle_endtag(self, tag):
        tag_lower = tag.lower()
        if tag_lower in self.skip_tags:
            self.current_skip = max(0, self.current_skip - 1)

    def handle_data(self, data):
        if self.current_skip == 0:
            self.text_chunks.append(data)

    def get_text(self) -> str:
        raw = "".join(self.text_chunks)
        lines = [line.strip() for line in raw.splitlines()]
        condensed = []
        blank = False
        for l in lines:
            if l:
                condensed.append(l)
                blank = False
            elif not blank:
                condensed.append("")
                blank = True
        return "\n".join(condensed).strip()


def extract_email_body_and_links(msg: email.message.Message) -> Tuple[str, List[str]]:
    """Extracts clean text and all links from a mime email message."""
    html_parts = []
    text_parts = []

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disp = str(part.get("Content-Disposition", ""))
            if "attachment" in content_disp:
                continue

            payload = part.get_payload(decode=True)
            if payload:
                text_content = payload.decode("utf-8", errors="replace")
                if content_type == "text/html":
                    html_parts.append(text_content)
                elif content_type == "text/plain":
                    text_parts.append(text_content)
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            text_content = payload.decode("utf-8", errors="replace")
            if msg.get_content_type() == "text/html":
                html_parts.append(text_content)
            else:
                text_parts.append(text_content)

    links = []
    body_text = ""

    if html_parts:
        parser = CleanHTMLTextExtractor()
        for h in html_parts:
            # Pre-strip scripts, styles, and head to ensure parser never gets trapped
            clean_h = re.sub(r"<(script|style|head)\b[^>]*>.*?</\1>", "", h, flags=re.DOTALL | re.IGNORECASE)
            parser.feed(clean_h)
            # Also extract links directly via regex as a secondary safety net
            for m in re.finditer(r'href=[\'"](https?://[^\'"]+)', h, re.IGNORECASE):
                links.append(m.group(1))
        body_text = parser.get_text()
        links.extend(parser.links)
    elif text_parts:
        body_text = "\n\n".join(text_parts).strip()
        links = re.findall(r"https?://[^\s<>\"']+", body_text)

    # Filter out common tracking / social / unsubscribe links
    filtered_links = []
    seen = set()
    for l in links:
        clean_l = l.strip().rstrip(".,;)>\"'")
        if clean_l in seen:
            continue
        seen.add(clean_l)
        if any(bad in clean_l.lower() for bad in ["unsubscribe", "google.com/accounts", "support.google.com", "myaccount.google.com"]):
            continue
        filtered_links.append(clean_l)

    return body_text, filtered_links


def analyze_email_with_gemini(
    sender: str,
    subject: str,
    date_str: str,
    body_text: str,
    links: List[str],
    api_key: str
) -> Optional[Dict[str, Any]]:
    """
    Sends email content to Gemini AI to extract event metadata under strict Van50 rules.
    """
    today_str = datetime.now().strftime("%Y-%m-%d")
    
    # Truncate body if excessive to prevent token limits
    truncated_body = body_text[:12000]
    links_sample = "\n".join(f"- {l}" for l in links[:20])

    prompt = f"""
You are the Van50 Autonomous Email Event Scout. Today's date is {today_str}.
Analyze the following email received at the Van50 curator submissions inbox (van50.submit@gmail.com).

EMAIL METADATA:
From: {sender}
Subject: {subject}
Date: {date_str}

EXTRACTED LINKS IN EMAIL:
{links_sample if links_sample else "None"}

EMAIL BODY CONTENT:
{truncated_body}

TASK & CONSTRAINTS:
1. Determine if this email contains an event announcement, music concert, comedy gig, party, festival, theatre show, or cultural gathering in Vancouver, BC (or immediate Metro Vancouver).
2. If this is an administrative email, security alert, 2FA notification, account verification, invoice/receipt without an upcoming public event, or generic non-event message:
   Set "is_event": false, "reason": "<explanation why it's not an event>", "events": []
3. If this IS an event or contains event announcements:
   Check whether each event meets the STRICT Van50 budget ceiling:
   - ALL-IN cost per ticket must be <= $50.00 CAD (including all checkout fees and 5% GST).
   - If the event exceeds $50.00 CAD (or cheapest tier with fees > $50 CAD):
     Set "is_event": true, "exceeds_budget": true, "events": [], "reason": "<Event name> exceeds $50 CAD cap (all-in cost ~$XX CAD)".
   - If the event is <= $50.00 CAD (Free, Pay-What-You-Can, or <= $50 CAD all-in):
     Extract complete details.
     RULES:
     - ONLY Vancouver, BC or immediate Metro Vancouver.
     - Verified explicit dates (YYYY-MM-DD). If recurring or weekly, only populate show_1 (and show_2/show_3 if explicit calendar dates exist). NEVER guess future repeat dates. Leave null if unverified.
     - Assign category (music, shows, cinema, comedy, social, outdoors, sports, arts).
     - Match the best ticketing URL or event URL from the extracted links.

Return a strict JSON response with this schema:
{{
  "is_event": true,
  "exceeds_budget": false,
  "reason": "Brief summary explanation",
  "events": [
    {{
      "event_id": "slug-id",
      "event_name": "Title of event",
      "category": "music | shows | cinema | comedy | social | outdoors | sports | arts",
      "venue_name": "Venue Name",
      "full_address": "Street address, City, BC",
      "neighborhood": "Neighborhood Name",
      "description": "Engaging 2-3 sentence overview",
      "pricing_all_in_cad": {{
        "regular": 15.00,
        "senior": null,
        "student": null,
        "member": null
      }},
      "show_1": {{
        "date": "YYYY-MM-DD",
        "start_time": "HH:MM",
        "end_time": "HH:MM",
        "cost": 15.00
      }},
      "show_2": null,
      "show_3": null,
      "discovery_url": "URL",
      "details_url": "URL",
      "ticket_url": "Direct ticket purchase link from email",
      "ticket_provider": "AdmitONE | Eventbrite | Showpass | Direct | Free",
      "approval_status": "Auto-Approved | Quarantined",
      "curator_notes": "Note explaining pricing, 19+ age restriction, or email origin"
    }}
  ],
  "discovered_venues": [
    {{
      "venue_name": "Name",
      "website_url": "URL",
      "full_address": "Address",
      "neighborhood": "Neighborhood",
      "description": "Brief description"
    }}
  ],
  "discovered_festivals": [
    {{
      "festival_name": "Name",
      "website_url": "URL",
      "schedule_url": "URL",
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD",
      "description": "Brief description"
    }}
  ]
}}
"""
    return call_gemini_direct_json(prompt, api_key)


def run_gemini_email_scout(
    api_key: Optional[str] = None,
    unread_only: bool = False,
    limit: int = 25,
    mark_as_read: bool = False,
    dry_run: bool = False
) -> Dict[str, Any]:
    """
    Connects to van50.submit@gmail.com, iterates over messages, invokes Gemini AI,
    and updates master catalogs.
    """
    if not api_key:
        api_key = get_gemini_api_key()
    if not api_key:
        print("[EMAIL SCOUT] Missing GEMINI_API_KEY. Ingestion cannot proceed.")
        return {"success": False, "error": "Missing GEMINI_API_KEY"}

    user, password, host, port, folder = get_email_credentials()
    if not user or not password:
        print("[EMAIL SCOUT] Gmail credentials not set in .env (NEWSLETTER_GMAIL_USER / NEWSLETTER_GMAIL_PASSWORD).")
        return {"success": False, "error": "Gmail credentials not configured"}

    print(f"[EMAIL SCOUT] Connecting as {user} to {host}:{port} folder '{folder}'...")
    try:
        mail = imaplib.IMAP4_SSL(host, port)
        mail.login(user, password)
        status, _ = mail.select(folder)
        if status != "OK":
            raise RuntimeError(f"Could not open mail folder '{folder}'")

        criterion = "UNSEEN" if unread_only else "ALL"
        status, nums = mail.search(None, criterion)
        if status != "OK" or not nums[0]:
            print(f"[EMAIL SCOUT] No matching {criterion} messages found in '{folder}'.")
            mail.logout()
            return {"success": True, "emails_checked": 0, "events_found": 0}

        msg_ids = nums[0].split()
        if limit:
            msg_ids = msg_ids[-limit:]

        print(f"[EMAIL SCOUT] Found {len(msg_ids)} emails to inspect with Gemini AI.")

        # Load current catalogs for deduplication
        existing_events = []
        if os.path.exists(EVENTS_PATH):
            with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                existing_events = json.load(f)

        existing_archive = []
        if os.path.exists(ARCHIVE_PATH):
            with open(ARCHIVE_PATH, "r", encoding="utf-8") as f:
                existing_archive = json.load(f)

        queue_data = {"metadata": {}, "quarantinedEvents": []}
        if os.path.exists(QUEUE_PATH):
            with open(QUEUE_PATH, "r", encoding="utf-8") as f:
                queue_data = json.load(f)
        quarantined = queue_data.get("quarantinedEvents", [])

        venues_data = []
        if os.path.exists(VENUES_PATH):
            with open(VENUES_PATH, "r", encoding="utf-8") as f:
                venues_data = json.load(f)

        festivals_data = []
        if os.path.exists(FESTIVALS_PATH):
            with open(FESTIVALS_PATH, "r", encoding="utf-8") as f:
                festivals_data = json.load(f)

        known_ids = {e.get("event_id") or e.get("id") for e in existing_events}
        known_ids |= {e.get("event_id") or e.get("id") for e in existing_archive}
        known_ids |= {e.get("event_id") or e.get("id") for e in quarantined}

        known_titles = {e.get("event_name", "").lower() for e in existing_events if e.get("event_name")}
        known_titles |= {e.get("event_name", "").lower() for e in existing_archive if e.get("event_name")}
        known_titles |= {e.get("title", "").lower() for e in quarantined if e.get("title")}

        stats = {
            "emails_checked": len(msg_ids),
            "events_found": 0,
            "added_to_active": 0,
            "staged_for_review": 0,
            "skipped": 0,
            "details": []
        }

        for msg_id in msg_ids:
            try:
                res, data = mail.fetch(msg_id, "(RFC822)")
                if res != "OK" or not data:
                    continue

                raw_msg = email.message_from_bytes(data[0][1])
                subj = decode_mime(raw_msg.get("Subject"))
                sender = decode_mime(raw_msg.get("From"))
                date_str = decode_mime(raw_msg.get("Date"))

                print(f"\n[EMAIL ID {msg_id.decode()}] From: {sender} | Subj: '{subj}'")
                body_text, links = extract_email_body_and_links(raw_msg)
                
                print(f"  Analyzing with Gemini AI ({len(body_text)} chars, {len(links)} links)...")
                ai_resp = analyze_email_with_gemini(sender, subj, date_str, body_text, links, api_key)

                if not ai_resp:
                    print("  [WARN] Gemini AI did not return a valid response for this email.")
                    stats["skipped"] += 1
                    continue

                is_event = ai_resp.get("is_event", False)
                exceeds_budget = ai_resp.get("exceeds_budget", False)
                reason = ai_resp.get("reason", "")
                events = ai_resp.get("events", [])
                disc_venues = ai_resp.get("discovered_venues", [])
                disc_festivals = ai_resp.get("discovered_festivals", [])

                if not is_event:
                    print(f"  ℹ Non-event email: {reason}")
                    stats["skipped"] += 1
                    stats["details"].append({"id": msg_id.decode(), "subject": subj, "status": "non_event", "reason": reason})
                elif exceeds_budget:
                    print(f"  ✕ Exceeds budget: {reason}")
                    stats["skipped"] += 1
                    stats["details"].append({"id": msg_id.decode(), "subject": subj, "status": "exceeds_budget", "reason": reason})
                else:
                    print(f"  ✦ Found {len(events)} event(s) under $50 CAD: {reason}")
                    for ev in events:
                        stats["events_found"] += 1
                        eid = ev.get("event_id")
                        name = ev.get("event_name", "")

                        # Deduplicate
                        if eid in known_ids or (name and name.lower() in known_titles):
                            print(f"    - Duplicate '{name}' ({eid}); skipping.")
                            continue

                        status = ev.get("approval_status", "Auto-Approved")
                        ev["discovery_url"] = ev.get("discovery_url") or f"mailto:{sender}"
                        ev["curator_notes"] = f"Ingested from email: {subj} ({datetime.now().strftime('%Y-%m-%d')})"

                        if status == "Auto-Approved" and ev.get("show_1", {}).get("date") and ev.get("ticket_url"):
                            price_val = float(ev.get("pricing_all_in_cad", {}).get("regular", 0.0) or 0.0)
                            print(f'[NEW EVENT ADDED] "{name}" at {ev.get("venue_name")} (${price_val:.2f} CAD)', flush=True)
                            existing_events.append(ev)
                            known_ids.add(eid)
                            known_titles.add(name.lower())
                            stats["added_to_active"] += 1
                        else:
                            q_msg = f"Ingested from email ({subj}): {ev.get('curator_notes', '')}"
                            print(f'[QUARANTINED] "{name}" • Reason: {q_msg}', flush=True)
                            quarantined.append({
                                "id": eid,
                                "title": name,
                                "venue": ev.get("venue_name"),
                                "address": ev.get("full_address"),
                                "neighborhood": ev.get("neighborhood"),
                                "price": ev.get("pricing_all_in_cad", {}).get("regular", 0.0),
                                "priceLabel": f"${ev.get('pricing_all_in_cad', {}).get('regular', 0.0):.2f} CAD",
                                "category": ev.get("category"),
                                "websiteUrl": ev.get("ticket_url") or ev.get("details_url"),
                                "quarantineReason": q_msg,
                                "flaggedAt": datetime.now().strftime("%Y-%m-%d")
                            })
                            known_ids.add(eid)
                            known_titles.add(name.lower())
                            stats["staged_for_review"] += 1

                # Merge discovered venues
                for v in disc_venues:
                    v_name = v.get("venue_name")
                    if v_name and not any(ex.get("venue_name", "").lower() == v_name.lower() for ex in venues_data):
                        print(f'[NEW VENUE ADDED] "{v_name}" ({v.get("neighborhood") or "Vancouver"})', flush=True)
                        venues_data.append(v)

                # Merge discovered festivals
                for f in disc_festivals:
                    f_name = f.get("festival_name")
                    if f_name and not any(ex.get("festival_name", "").lower() == f_name.lower() for ex in festivals_data):
                        print(f'[NEW FESTIVAL ADDED] "{f_name}" ({f.get("location") or "Vancouver"})', flush=True)
                        festivals_data.append(f)

                if mark_as_read and not dry_run:
                    mail.store(msg_id, "+FLAGS", "\\Seen")

                time.sleep(1.0)

            except Exception as ex:
                print(f"[ERROR] Failed processing email {msg_id}: {ex}")

        # Save changes if not dry_run
        if not dry_run and (stats["added_to_active"] > 0 or stats["staged_for_review"] > 0 or disc_venues or disc_festivals):
            if stats["added_to_active"] > 0:
                with open(EVENTS_PATH, "w", encoding="utf-8") as f:
                    json.dump(existing_events, f, indent=2, ensure_ascii=False)

            if stats["staged_for_review"] > 0:
                queue_data["quarantinedEvents"] = quarantined
                queue_data["pendingCount"] = len(quarantined)
                queue_data.setdefault("metadata", {})["updatedAt"] = datetime.now().strftime("%Y-%m-%d")
                with open(QUEUE_PATH, "w", encoding="utf-8") as f:
                    json.dump(queue_data, f, indent=2, ensure_ascii=False)

            if venues_data:
                with open(VENUES_PATH, "w", encoding="utf-8") as f:
                    json.dump(venues_data, f, indent=2, ensure_ascii=False)

            if festivals_data:
                with open(FESTIVALS_PATH, "w", encoding="utf-8") as f:
                    json.dump(festivals_data, f, indent=2, ensure_ascii=False)

            try:
                from curator_server import sync_js_data_file
                sync_js_data_file()
            except Exception as e:
                print(f"[WARN] js/data.js sync note: {e}")

        mail.logout()
        return stats

    except Exception as e:
        print(f"[EMAIL SCOUT ERROR] {e}")
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Van50 Gemini AI Inbound Email Scout")
    parser.add_argument("--all", action="store_true", help="Process all emails, not just unread")
    parser.add_argument("--limit", type=int, default=25, help="Number of latest emails to inspect")
    parser.add_argument("--mark-read", action="store_true", help="Mark inspected emails as seen/read")
    parser.add_argument("--dry-run", action="store_true", help="Dry run without writing to disk")
    args = parser.parse_args()

    results = run_gemini_email_scout(
        unread_only=not args.all,
        limit=args.limit,
        mark_as_read=args.mark_read,
        dry_run=args.dry_run
    )
    print("\n[SUMMARY RESULTS]:", json.dumps(results, indent=2))
