#!/usr/bin/env python3
"""
Van50 — Hourly Status & Sold-Out Monitor
=========================================
Autonomous monitor designed to run hourly via GitHub Actions or local background daemon.
1. Local Expiry Check (0ms):
   Compares event date and end time against current Vancouver local time.
   - For recurring/multi-showing events: advances to the next available showing.
   - For concluded one-off events: flags as past/expired without network overhead.
2. Targeted Sold-Out Check:
   Inspects live ticketing checkout URLs for sold-out indicators across Eventbrite,
   Showpass, Ticketweb, Ticketmaster, OrangeTickets, and independent theatre portals.
   - Bypasses perpetual open-access and free walk-in civic spaces that never sell out.
   - Throttles requests gently (0.5s pause, 5s timeout) to prevent bot-shield blocks.
3. Atomic Sync:
   Synchronizes data/events.json, updates js/data.js, and logs live activity to
   data/live_ai_activity.json for real-time Curator Studio visibility.

Usage:
    python scripts/hourly_status_monitor.py [--run-once] [--daemon] [--dry-run]
"""

from __future__ import annotations
import os
import sys
import json
import re
import time
import argparse
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

# Fix UTF-8 encoding on Windows console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
LOGS_DIR = os.path.join(DATA_DIR, "automation_logs")
MONITOR_LOG_PATH = os.path.join(LOGS_DIR, "hourly_monitor.log")

# Import activity logger if available
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
try:
    from activity_logger import log_activity, set_ai_status
except ImportError:
    def log_activity(log_type, message, **kwargs):
        print(f"[{log_type}] {message}", flush=True)
    def set_ai_status(status, task=None, step=None, progress=None):
        pass

try:
    from curator_server import sync_js_data_file
except ImportError:
    def sync_js_data_file():
        sync_script = os.path.join(BASE_DIR, "scripts", "sync_data_js.py")
        if os.path.exists(sync_script):
            os.system(f'"{sys.executable}" "{sync_script}"')

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 (Van50 Monitor)"

# Standard patterns indicating sold-out status in checkout DOM / microdata
SOLD_OUT_PATTERNS = [
    r'\bsold\s*out\b',
    r'\btickets?\s+(unavailable|sold\s*out)\b',
    r'\bsales?\s+(ended|closed)\b',
    r'\boff\s*sale\b',
    r'schema\.org/SoldOut',
    r'class=[\'"][^\'"]*(sold-out|tickets-unavailable)[^\'"]*',
    r'data-sold-out=[\'"]true[\'"]',
    r'"availability":\s*"http://schema\.org/SoldOut"',
    r'"status":\s*"soldout"',
]

# Patterns that indicate false positive matches (e.g. "not sold out", "never sold out")
FALSE_POSITIVE_PATTERNS = [
    r'not\s+sold\s*out',
    r'never\s+sold\s*out',
    r'almost\s+sold\s*out',
    r'nearly\s+sold\s*out',
    r'sold\s+out\s+in\s+advance\s+only',
]

# Open-access and civic parks/markets that never sell out
PERPETUAL_NON_TICKETED_MODELS = {
    'free_access',
    'open_civic_space',
    'donation_entry',
    'drop_in_perennial'
}


def log_monitor(msg: str):
    os.makedirs(LOGS_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{ts}] {msg}"
    print(formatted, flush=True)
    try:
        with open(MONITOR_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(formatted + "\n")
    except Exception:
        pass


def is_perpetual_open_access(event: dict) -> bool:
    """Identifies venues and outings that cannot sell out (parks, public markets, walks)."""
    access = event.get('access_model', '')
    lifecycle = event.get('lifecycle_type', '')
    pricing = event.get('pricing_model', '')
    price = event.get('price', 0)

    if lifecycle == 'perennial_drop_in' and price == 0:
        return True
    if pricing in PERPETUAL_NON_TICKETED_MODELS:
        return True
    if access in {'open_public_space', 'public_realm', 'unfenced_outdoor'}:
        return True

    title = (event.get('title') or '').lower()
    venue = (event.get('venue') or '').lower()
    for kw in ['park', 'promenade', 'public market', 'waterfront', 'boardwalk', 'trail']:
        if kw in title and price == 0:
            return True
        if kw in venue and price == 0 and not event.get('tiers'):
            return True

    return False


def check_sold_out_network(url: str) -> tuple[bool, str]:
    """
    Safely inspects a ticketing checkout URL for sold-out markers.
    Returns (is_sold_out, matched_indicator).
    """
    if not url or not url.startswith("http"):
        return False, ""

    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            }
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            # Check if response code indicates gone/inactive
            if resp.status == 410:
                return True, "HTTP 410 Gone (Event Sales Concluded)"

            html = resp.read().decode("utf-8", errors="ignore")

            # Check false positive filters first
            for fp in FALSE_POSITIVE_PATTERNS:
                if re.search(fp, html, re.IGNORECASE):
                    return False, ""

            # Check positive sold out patterns
            for pat in SOLD_OUT_PATTERNS:
                match = re.search(pat, html, re.IGNORECASE)
                if match:
                    return True, match.group(0)

    except urllib.error.HTTPError as e:
        if e.code == 410:
            return True, f"HTTP {e.code} (Sales Concluded)"
    except Exception:
        # Network errors or timeouts should never fail the run or falsely mark sold-out
        pass

    return False, ""


def run_monitor_pass(dry_run: bool = False) -> dict:
    """Executes a complete hourly pass across all catalog events."""
    start_time = datetime.now()
    now_iso = start_time.isoformat()
    log_monitor("⚡ Starting Van50 Hourly Status & Sold-Out Monitor pass...")
    set_ai_status("running", task="Hourly Status Monitor", step="Evaluating catalog events", progress=10)

    if not os.path.exists(EVENTS_PATH):
        log_monitor(f"❌ Events catalog not found at {EVENTS_PATH}")
        return {"error": "Catalog file not found"}

    with open(EVENTS_PATH, "r", encoding="utf-8") as f:
        events = json.load(f)

    total_events = len(events)
    expired_count = 0
    rolled_count = 0
    newly_sold_out_count = 0
    reopened_count = 0
    checked_network_count = 0
    modified = False

    for i, e in enumerate(events):
        eid = e.get('event_id') or e.get('id')
        title = e.get('title') or e.get('event_name') or 'Untitled'
        date_str = e.get('date') or e.get('start_date')
        end_time_str = e.get('end_time') or '23:59'
        orig_sold_out = bool(e.get('is_sold_out'))
        orig_past = bool(e.get('is_past'))

        # -------------------------------------------------------------
        # 1. LOCAL EXPIRY / TIME-BOUND CHECK (0ms network cost)
        # -------------------------------------------------------------
        if date_str and not is_perpetual_open_access(e):
            try:
                # Handle time strings like "19:00" or "7:00 PM"
                clean_time = end_time_str.strip()
                if ":" in clean_time:
                    parts = clean_time.split(":")
                    hour = int(parts[0])
                    minute = int(parts[1].split()[0])
                    if "PM" in clean_time.upper() and hour < 12:
                        hour += 12
                    event_end_dt = datetime.strptime(date_str, "%Y-%m-%d").replace(hour=hour, minute=minute)
                else:
                    event_end_dt = datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=1)

                if event_end_dt < start_time:
                    # Event date has passed!
                    # Check if event has subsequent showings to roll forward
                    showings = e.get('showings', [])
                    future_showings = []
                    archived = e.setdefault('archived_showings', [])
                    cur_day_str = start_time.strftime("%Y-%m-%d")

                    for s in showings:
                        s_date = s.get('date')
                        if s_date and s_date >= cur_day_str:
                            future_showings.append(s)
                        elif s_date:
                            s_copy = dict(s)
                            s_copy['status'] = 'concluded'
                            s_copy['archived_at'] = now_iso
                            archived.append(s_copy)

                    if future_showings:
                        # Advance to next showing
                        next_show = future_showings[0]
                        e['date'] = next_show['date']
                        e['start_time'] = next_show.get('start_time', e.get('start_time'))
                        e['end_time'] = next_show.get('end_time', e.get('end_time'))
                        e['showings'] = future_showings
                        e['show_1'] = {
                            'date': next_show['date'],
                            'start_time': next_show.get('start_time', e.get('start_time')),
                            'end_time': next_show.get('end_time', e.get('end_time')),
                            'cost': next_show.get('cost', e.get('price'))
                        }
                        e['is_past'] = False
                        e['operational_status'] = 'scheduled'
                        rolled_count += 1
                        modified = True
                        log_monitor(f"🔄 Rolled forward schedule: '{title}' -> {e['date']} {e.get('start_time')}")
                        log_activity("CONFIRMED", f"Schedule rolled forward to upcoming showing: {title} ({e['date']})")
                    elif not orig_past:
                        e['showings'] = []
                        e['is_past'] = True
                        e['is_sold_out'] = False
                        e['operational_status'] = 'concluded'
                        expired_count += 1
                        modified = True
                        log_monitor(f"⌛ Marked event expired/past: '{title}' (concluded on {date_str})")
                        log_activity("ARCHIVED", f"Event concluded and marked past: {title}", stat_key="archived")

            except Exception as ex:
                pass

        # -------------------------------------------------------------
        # 2. TARGETED SOLD-OUT SCAN
        # -------------------------------------------------------------
        # Skip if event is already past, perpetual free civic space, or sold-out already verified
        if e.get('is_past') or is_perpetual_open_access(e):
            continue

        ticket_url = e.get('ticket_url', '')
        if not ticket_url or not ticket_url.startswith("http"):
            continue

        # Check prioritizing events happening within the next 7 days
        days_ahead = 999
        if date_str:
            try:
                ev_dt = datetime.strptime(date_str, "%Y-%m-%d")
                days_ahead = (ev_dt.date() - start_time.date()).days
            except Exception:
                pass

        # Check if upcoming within 7 days or already marked sold-out (to check if tickets reopened)
        should_check = (days_ahead <= 7) or orig_sold_out

        if should_check:
            checked_network_count += 1
            is_sold_out, matched = check_sold_out_network(ticket_url)
            time.sleep(0.3)  # Gentle micro-pause to avoid burst flooding

            if is_sold_out and not orig_sold_out:
                e['is_sold_out'] = True
                newly_sold_out_count += 1
                modified = True
                log_monitor(f"🚨 SOLD OUT DETECTED: '{title}' ({ticket_url}) [Match: {matched}]")
                log_activity("CONFIRMED", f"Sold-out detected: {title}")

                # Update 20-dimension audit record D19
                if 'dimension_audit' in e and 'dimensions' in e['dimension_audit']:
                    e['dimension_audit']['dimensions']['D19_sold_out'] = {
                        "status": "verified_sold_out",
                        "confirmed_at": now_iso,
                        "is_sold_out": True,
                        "indicator": matched
                    }
                    e['dimension_audit']['last_full_qc_at'] = now_iso

            elif not is_sold_out and orig_sold_out:
                # Tickets reopened or extra inventory released!
                e['is_sold_out'] = False
                reopened_count += 1
                modified = True
                log_monitor(f"🎟️ TICKETS REOPENED: '{title}' ({ticket_url})")
                log_activity("CONFIRMED", f"Tickets reopened / inventory released: {title}")

                if 'dimension_audit' in e and 'dimensions' in e['dimension_audit']:
                    e['dimension_audit']['dimensions']['D19_sold_out'] = {
                        "status": "verified_available",
                        "confirmed_at": now_iso,
                        "is_sold_out": False
                    }
                    e['dimension_audit']['last_full_qc_at'] = now_iso

    # -------------------------------------------------------------
    # 3. ATOMIC PERSISTENCE & SYNC
    # -------------------------------------------------------------
    elapsed = (datetime.now() - start_time).total_seconds()

    if modified and not dry_run:
        # Atomic file write
        temp_file = f"{EVENTS_PATH}.tmp.{os.getpid()}"
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(events, f, indent=2, ensure_ascii=False)
        os.replace(temp_file, EVENTS_PATH)
        log_monitor("✅ Saved updated events.json checkpoint.")

        # Sync client-side js/data.js
        sync_js_data_file()
        log_monitor("✅ Synced updates to js/data.js.")

    summary = {
        "timestamp": now_iso,
        "elapsed_seconds": round(elapsed, 2),
        "total_events": total_events,
        "checked_network": checked_network_count,
        "expired": expired_count,
        "rolled_forward": rolled_count,
        "newly_sold_out": newly_sold_out_count,
        "reopened": reopened_count,
        "changes_made": modified
    }

    log_monitor(
        f"🏁 Monitor pass complete in {summary['elapsed_seconds']}s: "
        f"{expired_count} expired, {rolled_count} rolled, "
        f"{newly_sold_out_count} sold-out, {reopened_count} reopened. "
        f"(Checked {checked_network_count} URLs)."
    )

    set_ai_status("complete", task="Hourly Status Monitor", step="Idle awaiting next hourly trigger", progress=100)
    return summary


def main():
    parser = argparse.ArgumentParser(description="Van50 Hourly Status & Sold-Out Monitor")
    parser.add_argument("--run-once", action="store_true", default=True, help="Execute single pass and exit (default for CI/cron)")
    parser.add_argument("--daemon", action="store_true", help="Run indefinitely, repeating every hour")
    parser.add_argument("--interval", type=int, default=3600, help="Interval in seconds for daemon mode (default: 3600)")
    parser.add_argument("--dry-run", action="store_true", help="Audit without saving changes to disk")
    args = parser.parse_args()

    if args.daemon:
        log_monitor(f"🚀 Starting Van50 Hourly Status Monitor in DAEMON mode (interval: {args.interval}s)...")
        while True:
            try:
                run_monitor_pass(dry_run=args.dry_run)
            except Exception as e:
                log_monitor(f"⚠️ Unhandled error in monitor pass: {e}")
            time.sleep(args.interval)
    else:
        run_monitor_pass(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
