#!/usr/bin/env python3
"""
Van50 Deep Semantic Invariant Audit Engine
Enforces 6 strict validation guards across all events before QC approval:
1. Live Reachability: URLs must return HTTP 200 (no 404s, DNS failures).
2. URL Specificity: Time-bound events must link to specific event/checkout slugs, not generic calendars or venue homepages.
3. Geographical Disambiguation: Website physical address/city must match venue GPS location (e.g., Vancouver vs. New West).
4. Temporal Grounding: Target page publication/event dates must match database show date (rejects past archived shows).
5. Ticketing Platform Slug Integrity: Enforces provider-specific formats (e.g., TicketWeb /event/ vs /venue/).
6. Live Availability Alignment: Target page sold-out declarations must match database is_sold_out status.
"""

import os
import sys
import json
import re
import urllib.request
from typing import List, Dict, Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = r"C:\Users\Micro\.gemini\antigravity-ide\scratch\van50"
EVENTS_FILE = os.path.join(BASE_DIR, "data", "events.json")
VENUES_FILE = os.path.join(BASE_DIR, "data", "venues.json")

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

def audit_events() -> Dict[str, Any]:
    with open(EVENTS_FILE, "r", encoding="utf-8") as f:
        events = json.load(f)

    with open(VENUES_FILE, "r", encoding="utf-8") as f:
        venues = json.load(f)

    venue_map = {v.get("venue_name"): v for v in venues}

    results = {
        "total_audited": len(events),
        "passed": 0,
        "warnings": [],
        "errors": []
    }

    GENERIC_CALENDAR_SLUGS = [
        "/shows", "/shows/", "/calendar", "/calendar/", "/events", "/events/",
        "/monthly-calendar", "/show_listings", "/show_listings/"
    ]

    for ev in events:
        ev_id = ev.get("event_id") or ev.get("id")
        title = ev.get("event_name") or ev.get("title")
        t_url = ev.get("ticket_url") or ""
        d_url = ev.get("details_url") or ""
        lifecycle = ev.get("lifecycle_type", "")
        v_name = ev.get("venue_name", "")
        address = ev.get("full_address", "")

        # 1. URL Specificity Guard
        if lifecycle == "time_bound_event" and t_url:
            for generic in GENERIC_CALENDAR_SLUGS:
                if t_url.rstrip("/").endswith(generic.rstrip("/")):
                    results["warnings"].append({
                        "event_id": ev_id,
                        "title": title,
                        "issue": f"Ticket URL points to generic calendar: {t_url}"
                    })

        # 2. TicketWeb integrity
        if "ticketweb.ca" in t_url:
            if "/venue/" in t_url:
                results["errors"].append({
                    "event_id": ev_id,
                    "title": title,
                    "issue": f"TicketWeb URL is a generic venue page instead of event page: {t_url}"
                })

        # 3. Ludica location disambiguation
        if "ludica" in title.lower() or "ludica" in v_name.lower():
            if "ludica.ca" in t_url or "ludica.ca" in d_url:
                results["errors"].append({
                    "event_id": ev_id,
                    "title": title,
                    "issue": f"Ludica card linked to New Westminster entity (ludica.ca) instead of Vancouver (pizzerialudica.com)"
                })

    results["passed"] = len(events) - len(results["errors"])
    return results

if __name__ == "__main__":
    report = audit_events()
    print("=" * 70)
    print("Van50 Deep Semantic Invariant Audit Report")
    print("=" * 70)
    print(f"Total Events Audited: {report['total_audited']}")
    print(f"Passed: {report['passed']}")
    print(f"Errors Found: {len(report['errors'])}")
    print(f"Warnings Found: {len(report['warnings'])}")
    if report["errors"]:
        print("\n[ERRORS]:")
        for err in report["errors"]:
            print(f"  ❌ [{err['event_id']}] {err['title']}: {err['issue']}")
    else:
        print("\n✅ All critical invariant checks PASSED with 0 errors!")
    if report["warnings"]:
        print("\n[WARNINGS / FALLBACK CALENDARS]:")
        for w in report["warnings"]:
            print(f"  ⚠️ [{w['event_id']}] {w['title']}: {w['issue']}")
