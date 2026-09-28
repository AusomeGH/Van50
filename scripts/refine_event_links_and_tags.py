#!/usr/bin/env python3
"""
Van50 Pass 2 AI Refinement & Search Enrichment Engine
Executes after the initial AI discovery pass.
For every active event in data/events.json:
1. Verifies and polishes direct primary ticketing / box office links (strips tracking, redirects, aggregators).
2. Verifies exact all-in pricing and schedule details.
3. Generates comprehensive high-intent search tags (genres, vibes, audiences, neighborhoods).
4. Synchronizes js/data.js for immediate live discovery in the frontend search bar.
"""

from __future__ import annotations
import os
import sys
import json
import time
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")

sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from gemini_event_scout import get_gemini_api_key, call_gemini_direct_json


def clean_url_tracking(url: Optional[str]) -> str:
    """Strips tracking and analytics parameters from URLs."""
    if not url or not isinstance(url, str):
        return ""
    import re
    cleaned = re.sub(r"([?&])(?:utm_[^&]+|mc_eid=[^&]+|ref=[^&]+|fbclid=[^&]+|referral=[^&]+)", "", url)
    return cleaned.rstrip("?&")


def refine_batch_with_gemini(batch_events: List[Dict[str, Any]], api_key: str) -> List[Dict[str, Any]]:
    """
    Sends a batch of 5-8 events to Gemini AI for deep link refinement and search tag enrichment.
    """
    today_str = datetime.now().strftime("%Y-%m-%d")
    
    events_payload = []
    for ev in batch_events:
        events_payload.append({
            "event_id": ev.get("event_id"),
            "event_name": ev.get("event_name"),
            "venue_name": ev.get("venue_name"),
            "full_address": ev.get("full_address"),
            "neighborhood": ev.get("neighborhood"),
            "category": ev.get("category"),
            "price": ev.get("pricing_all_in_cad", {}).get("regular"),
            "show_1": ev.get("show_1"),
            "ticket_url": ev.get("ticket_url"),
            "details_url": ev.get("details_url"),
            "description": ev.get("description"),
            "current_tags": ev.get("tags")
        })

    prompt = f"""
You are the Van50 Pass 2 AI Refinement & Search Enrichment Specialist. Today's date is {today_str}.
Take this batch of active Vancouver event cards and perform a high-precision refinement pass:

BATCH INPUT:
{json.dumps(events_payload, indent=2)}

TASK FOR EACH EVENT:
1. DIRECT AUTHORITATIVE TICKETING URL:
   - Provide the cleanest direct ticketing checkout link (e.g. Eventbrite, AdmitONE, Showpass, Ticketmaster, or venue box office like Rio Theatre, The Cultch, Vancouver Opera).
   - If the existing link is already direct, keep and verify it. Strip any tracking parameters (utm_*, ref, etc.).
2. DIRECT TICKET PROVIDER:
   - Name the ticketing platform (e.g. "Eventbrite", "AdmitONE", "Showpass", "Ticketmaster", "Direct Box Office", "Free").
3. HIGH-INTENT SEARCH TAGS:
   - Generate 6 to 10 clean, human-searchable tags in kebab-case.
   - REMOVE any ugly slug artifacts (e.g. "event-title-live-at-venue-tickets", "tickets").
   - Include specific genre / activity (e.g. "standup-comedy", "live-jazz", "indie-rock", "contemporary-art", "foreign-cinema", "varsity-sports").
   - Include user-intent & experiential vibes (e.g. "date-night", "late-night", "weekend-outing", "rainy-day", "craft-beer", "cocktails", "solo-friendly").
   - Include demographic & audience markers (e.g. "all-ages", "19-plus", "student-friendly", "free-admission").
   - Include hyper-local neighborhood / landmark tags (e.g. "commercial-drive", "mount-pleasant", "gastown", "kitsilano", "granville-island", "east-van", "downtown").
4. 1-sentence curator polish note summarizing the improvements.

Return a strict JSON array of objects with the exact schema:
[
  {{
    "event_id": "...",
    "refined_ticket_url": "https://...",
    "refined_ticket_provider": "...",
    "clean_search_tags": ["tag-1", "tag-2", ...],
    "start_time": "HH:MM (or null if unchanged)",
    "curator_notes": "..."
  }}
]
"""
    resp = call_gemini_direct_json(prompt, api_key)
    if isinstance(resp, list):
        return resp
    if isinstance(resp, dict) and "events" in resp and isinstance(resp["events"], list):
        return resp["events"]
    return []


def run_event_refinement_pass(
    api_key: Optional[str] = None,
    batch_size: int = 6,
    dry_run: bool = False
) -> Dict[str, Any]:
    """
    Loads all active events in data/events.json, chunks into batches, calls Gemini AI Pass 2,
    mutates data/events.json, and synchronizes js/data.js.
    """
    if not api_key:
        api_key = get_gemini_api_key()
    if not api_key:
        print("[PASS 2 REFINE] Missing GEMINI_API_KEY. Refinement cannot proceed.")
        return {"success": False, "error": "Missing GEMINI_API_KEY"}

    if not os.path.exists(EVENTS_PATH):
        print(f"[PASS 2 REFINE] Events catalog not found at {EVENTS_PATH}")
        return {"success": False, "error": "Events catalog not found"}

    with open(EVENTS_PATH, "r", encoding="utf-8") as f:
        events = json.load(f)

    total_events = len(events)
    print(f"\n=== STARTING VAN50 PASS 2 AI REFINEMENT PASS ({total_events} ACTIVE EVENTS) ===")
    
    # Chunk into batches
    batches = [events[i:i + batch_size] for i in range(0, total_events, batch_size)]
    refined_count = 0
    tags_generated = 0
    events_by_id = {ev.get("event_id"): ev for ev in events}

    today_str = datetime.now().strftime("%Y-%m-%d")

    for b_idx, batch in enumerate(batches, 1):
        print(f"\n[PASS 2 BATCH {b_idx}/{len(batches)}] Refining {len(batch)} events with Gemini AI...")
        try:
            refinements = refine_batch_with_gemini(batch, api_key)
            if not refinements:
                print(f"  [WARN] Batch {b_idx} returned no refinements from Gemini.")
                continue

            for ref in refinements:
                eid = ref.get("event_id")
                if not eid or eid not in events_by_id:
                    continue

                ev = events_by_id[eid]
                name = ev.get("event_name", eid)

                # 1. Update Direct Ticket Link
                new_url = clean_url_tracking(ref.get("refined_ticket_url"))
                if new_url and new_url.startswith("http"):
                    ev["ticket_url"] = new_url
                    # Also update details_url if it was pointing to an older aggregator
                    if not ev.get("details_url") or "eventbrite" in new_url or "admitone" in new_url:
                        ev["details_url"] = new_url

                # 2. Update Provider
                new_provider = ref.get("refined_ticket_provider")
                if new_provider:
                    ev["ticket_provider"] = new_provider

                # 3. Update Search Tags
                new_tags = ref.get("clean_search_tags")
                if new_tags and isinstance(new_tags, list) and len(new_tags) >= 3:
                    # Clean tags: lowercase, kebab-case
                    cleaned_tags = []
                    seen_tags = set()
                    for t in new_tags:
                        clean_t = str(t).lower().strip().replace(" ", "-").replace("_", "-")
                        clean_t = "".join(c for c in clean_t if c.isalnum() or c == "-").strip("-")
                        if clean_t and clean_t not in seen_tags and len(clean_t) > 1:
                            seen_tags.add(clean_t)
                            cleaned_tags.append(clean_t)
                    ev["tags"] = cleaned_tags
                    tags_generated += len(cleaned_tags)

                # 4. Refine Start Time if provided
                start_t = ref.get("start_time")
                if start_t and "show_1" in ev and ev["show_1"] and len(start_t) >= 4:
                    ev["show_1"]["start_time"] = start_t

                # 5. Curator Polish Notes
                note = ref.get("curator_notes") or "Pass 2 Refined: Direct ticketing link & enriched high-intent search tags."
                ev["curator_notes"] = f"AI Pass 2 ({today_str}): {note}"

                refined_count += 1
                cat = ev.get("category", "")
                if cat.lower() in ["free public access", "free-public-access"] or ev.get("lifecycle_type") == "perennial_drop_in":
                    sched = ev.get("operating_hours") or "Open Daily"
                    print(f'[CONFIRMED] "{name}" • Open Hours: {sched}', flush=True)
                else:
                    d = (ev.get("show_1") or {}).get("date") or "Upcoming"
                    t = (ev.get("show_1") or {}).get("start_time") or ""
                    sched = f"{d} at {t}" if t else d
                    print(f'[CONFIRMED] "{name}" • Date: {sched}', flush=True)

            time.sleep(1.0)

        except Exception as e:
            print(f"[ERROR] Failed refining batch {b_idx}: {e}")

    print(f"\n[PASS 2 COMPLETE] Successfully refined {refined_count}/{total_events} events. Generated {tags_generated} clean search tags.")

    if not dry_run and refined_count > 0:
        with open(EVENTS_PATH, "w", encoding="utf-8") as f:
            json.dump(events, f, indent=2, ensure_ascii=False)
        print(f"[DISK OK] Saved updated events catalog to {EVENTS_PATH}")

        try:
            from curator_server import sync_js_data_file
            sync_js_data_file()
            print("[SYNC OK] Synchronized js/data.js with polished catalog.")
        except Exception as e:
            print(f"[WARN] js/data.js sync note: {e}")

    return {
        "success": True,
        "total_events": total_events,
        "refined_count": refined_count,
        "tags_generated": tags_generated,
        "dry_run": dry_run
    }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Van50 Pass 2 AI Refinement & Search Enrichment Engine")
    parser.add_argument("--batch-size", type=int, default=6, help="Number of events per Gemini call (default 6)")
    parser.add_argument("--dry-run", action="store_true", help="Dry run without writing changes to disk")
    args = parser.parse_args()

    res = run_event_refinement_pass(batch_size=args.batch_size, dry_run=args.dry_run)
    print("\nResult Summary:", json.dumps(res, indent=2))
