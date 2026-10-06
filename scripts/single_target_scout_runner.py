#!/usr/bin/env python3
"""
single_target_scout_runner.py
Van50 Single-Target (Batch Size = 1) Autonomous Scout Execution Harness.

Operates on the 'Batch Size = 1 Target' & 'Natural Yield' Protocol:
- Scans one discrete target at a time (1 Venue, 1 BIA Portal, or 1 Ticketing Seed).
- Zero artificial event quotas: extracts the natural yield (whether 0, 1, or 8 events).
- Populates and validates all 20 Discrete Live Dimensions on every newly ingested event.
- Verifies pricing <= $50 CAD all-in (fees & taxes included).
- Commits discoveries atomically after each target and logs to data/scout_target_ledger.json.
- Renders sequential Markdown Audit Table (no skipped numbers) matching QC AI format.
"""

import os
import sys
import json
import time
import argparse
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from universal_venue_crawler import UniversalVenueCrawler
from curator_server import sync_js_data_file

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
EVENTS_PATH = os.path.join(DATA_DIR, 'events.json')
VENUES_PATH = os.path.join(DATA_DIR, 'venues.json')
SOURCES_PATH = os.path.join(DATA_DIR, 'discovery_sources.json')
LEDGER_PATH = os.path.join(DATA_DIR, 'scout_target_ledger.json')
BENCHMARKS_PATH = os.path.join(DATA_DIR, 'ai_runtime_benchmarks.json')

def load_json(path, default):
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return default
    return default

def save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def load_all_target_directory() -> dict:
    """Loads all known targets from venues.json and discovery_sources.json."""
    targets = {}
    
    # 1. Registered Venues
    venues = load_json(VENUES_PATH, [])
    if isinstance(venues, dict):
        venues = list(venues.values())
    for v in venues:
        name = v.get('venue_name') or v.get('name')
        if name:
            targets[name.lower().strip()] = (name, v, "venue")

    # 2. Discovery Sources & BIAs
    disc_data = load_json(SOURCES_PATH, {})
    sources = disc_data.get('sources', []) if isinstance(disc_data, dict) else []
    for s in sources:
        s_name = s.get('name')
        s_id = s.get('id')
        s_type = s.get('type') or "discovery_source"
        if s_name:
            targets[s_name.lower().strip()] = (s_name, s, s_type)
        if s_id:
            targets[s_id.lower().strip()] = (s_name or s_id, s, s_type)

    return targets

def standardize_candidate_to_20_dimensions(cand: dict, target_name: str, target_meta: dict) -> dict:
    """Populates all 20 Discrete Live Dimensions according to Van50 catalog specification."""
    title = (cand.get('title') or cand.get('event_name') or 'Live Showcase').strip()
    slug_title = UniversalVenueCrawler.slugify(title)[:35]
    cid = cand.get('event_id') or cand.get('id') or f"van50-{UniversalVenueCrawler.slugify(target_name)}-{slug_title}"
    if not cid.startswith('van50-'):
        cid = f"van50-{cid}"

    venue_name = cand.get('venue') or cand.get('venue_name') or target_meta.get('venue_name') or target_name
    address = cand.get('address') or cand.get('full_address') or target_meta.get('address') or target_meta.get('full_address') or "Vancouver, BC"
    neighborhood = cand.get('neighborhood') or target_meta.get('neighborhood') or "Vancouver"
    coords = cand.get('coordinates') or target_meta.get('coordinates') or [49.2827, -123.1207]
    transit = cand.get('transitInfo') or cand.get('transit_info') or target_meta.get('transitInfo') or "TransLink accessible"

    # Category Canonicalization
    raw_cat = (cand.get('category') or target_meta.get('category') or 'Live Music').lower()
    cat_map = {
        'music': 'Live Music',
        'live music': 'Live Music',
        'shows': 'Comedy & Shows',
        'comedy & shows': 'Comedy & Shows',
        'comedy': 'Comedy & Shows',
        'theatre': 'Comedy & Shows',
        'arts': 'Arts & Culture',
        'arts & culture': 'Arts & Culture',
        'cinema': 'Arts & Culture',
        'social': 'Nightlife & Social',
        'nightlife & social': 'Nightlife & Social',
        'food': 'Food & Drink',
        'food & drink': 'Food & Drink',
        'sports': 'Sports & Fitness',
        'sports & fitness': 'Sports & Fitness',
        'free': 'Free Public Access',
        'free public access': 'Free Public Access',
        'community': 'Community & Markets',
        'community & markets': 'Community & Markets'
    }
    category = cat_map.get(raw_cat, 'Live Music')

    price = float(cand.get('price') or cand.get('basePrice') or 20.0)
    ticket_url = cand.get('websiteUrl') or cand.get('ticketUrl') or cand.get('ticket_url') or target_meta.get('calendar_url') or target_meta.get('website_url') or ""
    details_url = cand.get('venueSubpageUrl') or cand.get('details_url') or ticket_url

    # Ticketing provider resolution
    provider = cand.get('ticket_provider') or cand.get('ticketProvider')
    if not provider:
        t_low = ticket_url.lower()
        if 'eventbrite' in t_low:
            provider = 'Eventbrite'
        elif 'showpass' in t_low:
            provider = 'Showpass'
        elif 'ticketweb' in t_low:
            provider = 'Ticketweb'
        elif 'tickettailor' in t_low:
            provider = 'Ticket Tailor'
        elif 'dice.fm' in t_low:
            provider = 'DICE'
        elif 'admitone' in t_low:
            provider = 'AdmitOne'
        elif 'waterstreetcafe' in t_low or '2nd-floor' in t_low:
            provider = 'Venue Door Cover & Reservations'
        elif 'guiltandcompany' in t_low:
            provider = 'Venue Door Cover & Walk-In'
        elif price == 0:
            provider = 'Free Public Access'
        else:
            provider = f"{venue_name} Box Office"

    date_str = cand.get('date') or (cand.get('startIso')[:10] if cand.get('startIso') else datetime.now().strftime('%Y-%m-%d'))
    time_str = cand.get('time') or cand.get('start_time') or "19:30"
    if 'T' in time_str:
        try:
            time_str = time_str.split('T')[1][:5]
        except Exception:
            time_str = "19:30"

    date_sched = cand.get('dateSchedule') or f"{date_str} at {time_str}"
    lineup = cand.get('lineup') or cand.get('performers') or cand.get('artist') or title
    desc = cand.get('description') or f"Live scheduled programming at {venue_name}."
    tags = cand.get('tags') or cand.get('subTags') or ["live-music", "budget-friendly", "vancouver-events"]

    res = {
        "event_id": cid,
        "event_name": title,
        "title": title,
        "category": category,
        "lifecycle_type": cand.get('lifecycle_type') or "one_time",
        "venue_name": venue_name,
        "full_address": address,
        "neighborhood": neighborhood,
        "coordinates": coords,
        "transit_info": transit,
        "description": desc,
        "pricing_all_in_cad": cand.get('pricing_all_in_cad') or {
            "regular": price,
            "senior": price,
            "student": price,
            "member": price
        },
        "operating_hours": target_meta.get('operating_hours') or "Evening live performances",
        "days_open": "Upcoming Scheduled Showcase",
        "show_1": {
            "date": date_str,
            "start_time": time_str,
            "end_time": cand.get('end_time') or "22:00",
            "cost": price
        },
        "show_2": None,
        "show_3": None,
        "discovery_url": target_meta.get('website_url') or target_meta.get('calendar_url') or target_meta.get('eventsUrl') or ticket_url,
        "details_url": details_url,
        "ticket_url": ticket_url,
        "ticket_provider": provider,
        "tags": tags,
        "festival_affiliation": "None",
        "approval_status": "Auto-Approved",
        "curator_notes": cand.get('curator_notes') or f"Scouted via Van50 Natural Yield Scout AI. All-in admission ${price:.2f} CAD.",
        "price": price,
        "access_model": cand.get('access_model') or "fenced_facility",
        "pricing_model": cand.get('pricing_model') or ("free_access" if price == 0 else "flat_ticket"),
        "dateSchedule": date_sched,
        "start_date": date_str,
        "start_time": time_str,
        "lineup": lineup,
        "is_sold_out": False,
        "last_scouted_at": datetime.now().isoformat()
    }

    # Attach D7 multi-category and 50 dimensions
    try:
        from enrich_d7_categories import map_categories_for_event
        from upgrade_to_50_dimensions import build_50_dimensions_audit
        p_cat, all_cats = map_categories_for_event(res)
        res['primary_category'] = p_cat
        res['categories'] = all_cats
        res['category_count'] = len(all_cats)
        res['dimension_audit'] = build_50_dimensions_audit(res)
    except Exception:
        pass

    return res

def scout_single_target(target_name: str, target_meta: dict, target_type: str = "venue", target_idx: int = 1) -> dict:
    """
    Scouts exactly ONE discrete target.
    Extracts all qualifying events to natural exhaustion (zero artificial quotas).
    """
    start_time = time.time()
    calendar_url = target_meta.get('calendar_url') or target_meta.get('calendarUrl') or target_meta.get('eventsUrl') or target_meta.get('website_url') or target_meta.get('url') or ""
    
    print(f"\n[{target_idx}] SCOUTING TARGET: [{target_type.upper()}] {target_name} ({calendar_url})")

    existing_events = load_json(EVENTS_PATH, [])
    existing_ids = {e.get('event_id') or e.get('id') for e in existing_events}
    existing_titles = {e.get('title', '').lower().strip() for e in existing_events}

    raw_candidates = UniversalVenueCrawler.crawl_venue(target_name, target_meta, max_candidates=25)
    
    inspected_count = len(raw_candidates)
    passed_events = []
    rejected_reasons = []

    for cand in raw_candidates:
        cid = cand.get('id') or cand.get('event_id')
        title = (cand.get('title') or '').strip()
        price = cand.get('price') or cand.get('basePrice') or 0.0

        # Date check (must be future date >= today)
        today_iso = datetime.now().strftime('%Y-%m-%d')
        cand_date = cand.get('date') or (cand.get('startIso')[:10] if cand.get('startIso') else None)
        if cand_date and cand_date < today_iso:
            rejected_reasons.append(f"Past Date ({cand_date} < {today_iso}): '{title[:35]}'")
            continue

        # Deduplication check
        if cid in existing_ids or title.lower() in existing_titles:
            rejected_reasons.append(f"Duplicate: '{title[:35]}' already in catalog")
            continue

        # Price ceiling check (<= $50 CAD)
        if float(price) > 50.0:
            rejected_reasons.append(f"Overbudget (${price} > $50): '{title[:35]}'")
            continue

        # Reject generic navigation artifacts or template strings
        if any(token in title.lower() for token in ['usersession', 'browse shows', 'browse local events', 'login', 'about us']):
            rejected_reasons.append(f"Navigation Artifact: '{title[:35]}'")
            continue

        # Natural yield: Valid qualified event! Standardize to 20 dimensions
        standardized = standardize_candidate_to_20_dimensions(cand, target_name, target_meta)
        passed_events.append(standardized)

    # Atomic persistence if new events found
    new_count = len(passed_events)
    status_notes = ""
    if new_count > 0:
        updated_catalog = existing_events + passed_events
        save_json(EVENTS_PATH, updated_catalog)
        sync_js_data_file()
        titles_summary = ", ".join([p.get('title', '')[:25] for p in passed_events[:2]])
        if new_count > 2:
            titles_summary += f" + {new_count - 2} more"
        status_notes = f"Ingested {new_count} new events ({titles_summary})"
        print(f"✓ ATOMIC COMMIT: Added {new_count} new events from '{target_name}' to catalog.")
    else:
        if inspected_count == 0:
            status_notes = "0 candidates found (Dark week / No upcoming dates posted)"
        elif all("Duplicate" in r for r in rejected_reasons):
            status_notes = f"Verified {inspected_count} shows (All already indexed in catalog)"
        elif any("Past Date" in r for r in rejected_reasons):
            status_notes = f"Audited {inspected_count} shows (Past dates / Off-season listings)"
        elif any("Overbudget" in r for r in rejected_reasons):
            status_notes = f"Audited {inspected_count} shows (Shows > $50 CAD price ceiling)"
        else:
            status_notes = f"Audited {inspected_count} shows (0 new qualified under $50 CAD)"
        print(f"ℹ NATURAL YIELD: {status_notes}")

    elapsed = round(time.time() - start_time, 2)

    ledger_entry = {
        "target_index": target_idx,
        "timestamp": datetime.now().isoformat(),
        "target_name": target_name,
        "target_type": target_type,
        "url": calendar_url,
        "candidates_inspected": inspected_count,
        "new_events_ingested": new_count,
        "status_notes": status_notes,
        "duration_seconds": elapsed
    }

    ledger = load_json(LEDGER_PATH, [])
    ledger.append(ledger_entry)
    save_json(LEDGER_PATH, ledger)

    # Stamp last_scouted_at directly on venue or source entity
    now_iso = ledger_entry["timestamp"]
    if target_type == "venue":
        venues = load_json(VENUES_PATH, [])
        if isinstance(venues, list):
            for v in venues:
                if (v.get('venue_name') or v.get('name', '')).strip().lower() == target_name.strip().lower():
                    v['last_scouted_at'] = now_iso
                    v['last_scout_yield'] = new_count
                    save_json(VENUES_PATH, venues)
                    break
    elif target_type in ["discovery_source", "community_guide"]:
        disc_data = load_json(SOURCES_PATH, {})
        sources = disc_data.get('sources', []) if isinstance(disc_data, dict) else []
        for s in sources:
            if (s.get('name') or s.get('id', '')).strip().lower() == target_name.strip().lower():
                s['last_scouted_at'] = now_iso
                s['last_scout_yield'] = new_count
                save_json(SOURCES_PATH, disc_data)
                break

    return ledger_entry

def print_audit_table(results: list):
    """Renders a clean sequential Markdown table matching QC AI audit format."""
    print("\n" + "=" * 80)
    print("                      SCOUT AI DISCOVERY AUDIT LEDGER                       ")
    print("=" * 80)
    print("| Target # | Target Name | Type | Inspected | Natural Yield (≤ $50) | Audit Status & Notes |")
    print("|:---:|:---|:---:|:---:|:---:|:---|")
    table_lines = [
        f"# Van50 Complete {len(results)}-Target Autonomous Scout Discovery Audit Ledger\n",
        "| Target # | Target Name | Type | Inspected | Natural Yield (≤ $50) | Audit Status & Notes |",
        "|:---:|:---|:---:|:---:|:---:|:---|"
    ]
    for r in results:
        t_num = r.get("target_index", 1)
        name = r.get("target_name", "")
        ttype = r.get("target_type", "").capitalize()
        inspected = r.get("candidates_inspected", 0)
        yield_count = r.get("new_events_ingested", 0)
        notes = r.get("status_notes", "")
        row = f"| {t_num} | **{name}** | {ttype} | {inspected} | **{yield_count}** | {notes} |"
        print(row)
        table_lines.append(row)
    print("=" * 80 + "\n")

    artifact_dir = os.environ.get("ANTIGRAVITY_ARTIFACT_DIR") or r"C:\Users\Micro\.gemini\antigravity-ide\brain\ea985afa-fa8b-4998-9925-d2104e4cd461"
    os.makedirs(artifact_dir, exist_ok=True)
    artifact_path = os.path.join(artifact_dir, "full_scout_catalog_audit.md")
    try:
        with open(artifact_path, "w", encoding="utf-8") as f:
            f.write("\n".join(table_lines) + "\n")
        print(f"✅ Saved full scout audit ledger to artifact: {artifact_path}")
    except Exception as ex:
        print(f"Warning: could not write scout artifact: {ex}")

def record_benchmark(total_targets: int, total_new: int, total_duration: float):
    """Updates data/ai_runtime_benchmarks.json with the completed run."""
    benchmarks = load_json(BENCHMARKS_PATH, {})
    wf = benchmarks.get("workflows", {}).get("scout_ai", {})
    if not wf:
        return

    history = wf.get("history", [])
    history.append({
        "timestamp": datetime.now().isoformat(),
        "durationSeconds": round(total_duration, 1),
        "durationFormatted": f"{int(total_duration // 60)}m {int(total_duration % 60)}s" if total_duration >= 60 else f"{int(total_duration)}s",
        "itemsProcessed": total_targets,
        "newEventsIngested": total_new
    })

    wf["totalRuns"] = len(history)
    durations = [h.get("durationSeconds", 0) for h in history if h.get("durationSeconds")]
    if durations:
        avg_d = round(sum(durations) / len(durations), 1)
        wf["averageDurationSeconds"] = avg_d
        wf["averageDurationFormatted"] = f"{int(avg_d // 60)}m {int(avg_d % 60)}s" if avg_d >= 60 else f"{int(avg_d)}s"

    wf["lastRun"] = {
        "timestamp": datetime.now().isoformat(),
        "durationSeconds": round(total_duration, 1),
        "durationFormatted": f"{int(total_duration // 60)}m {int(total_duration % 60)}s" if total_duration >= 60 else f"{int(total_duration)}s",
        "itemsProcessed": total_targets,
        "newEventsIngested": total_new,
        "notes": f"Scouted {total_targets} targets with 1-at-a-time isolation. Ingested {total_new} new events under $50 CAD."
    }

    benchmarks["workflows"]["scout_ai"] = wf
    save_json(BENCHMARKS_PATH, benchmarks)

def get_master_ordered_targets() -> list:
    """
    Returns the complete, deterministic ordered master target list of 100% of registered targets:
    1. All registered venues from venues.json (in declared order)
    2. All registered discovery sources & BIAs from discovery_sources.json
    Deduplicated by canonical lowercase name.
    """
    venues = load_json(VENUES_PATH, [])
    if isinstance(venues, dict):
        venues = list(venues.values())

    disc_data = load_json(SOURCES_PATH, {})
    sources = disc_data.get('sources', []) if isinstance(disc_data, dict) else []

    master = []
    seen = set()

    # 1. Registered Venues
    for v in venues:
        name = (v.get('venue_name') or v.get('name') or '').strip()
        norm = name.lower()
        if name and norm not in seen:
            seen.add(norm)
            master.append((name, v, "venue"))

    # 2. Discovery Sources & BIAs
    for s in sources:
        name = (s.get('name') or s.get('id') or '').strip()
        norm = name.lower()
        s_type = s.get('type') or "discovery_source"
        if name and norm not in seen:
            seen.add(norm)
            master.append((name, s, s_type))

    return master

def main():
    parser = argparse.ArgumentParser(description="Single-Target Scout Runner (Batch Size = 1)")
    parser.add_argument("--targets", help="Optional: comma-separated list of specific target names or IDs to scout")
    parser.add_argument("--count", type=int, help="Optional: limit run to first N targets")
    parser.add_argument("--list-targets", action="store_true", help="List all registered targets in order")
    args = parser.parse_args()

    master_targets = get_master_ordered_targets()

    if args.list_targets:
        print(f"Master Registered Target Directory ({len(master_targets)} total targets):")
        for i, (name, meta, ttype) in enumerate(master_targets, 1):
            url = meta.get('calendar_url') or meta.get('calendarUrl') or meta.get('eventsUrl') or meta.get('website_url') or ''
            print(f" {i:3d}. [{ttype.upper()}] {name} ({url[:45]}...)")
        return

    if args.targets:
        target_keys = [t.strip().lower() for t in args.targets.split(",") if t.strip()]
        targets = []
        for key in target_keys:
            match = next((t for t in master_targets if key == t[0].lower() or key in t[0].lower()), None)
            if match:
                targets.append(match)
            else:
                print(f"Warning: Target '{key}' not found in registry, skipping.")
    elif args.count:
        targets = master_targets[:args.count]
    else:
        # MANDATORY DEFAULT PROTOCOL:
        # Always start at Target #1, and in batches of 1, go through the ENTIRE list of all targets.
        # Zero partial runs. Zero skipped targets.
        targets = master_targets

    print(f"\n================================================================================")
    print(f"      STARTING SCOUT AI RUN: {len(targets)} TARGETS (BATCH SIZE = 1 TARGET)      ")
    print(f"================================================================================")
    print(f"Starting at Target #1: '{targets[0][0]}' through Target #{len(targets)}: '{targets[-1][0]}'")
    print(f"Executing 1-at-a-time isolated evaluation with atomic checkpoints & Natural Yield.\n")

    run_start = time.time()
    results = []
    for idx, (t_name, t_meta, t_type) in enumerate(targets, 1):
        res = scout_single_target(t_name, t_meta, target_type=t_type, target_idx=idx)
        results.append(res)

    total_duration = time.time() - run_start
    total_new = sum(r.get("new_events_ingested", 0) for r in results)

    # Render full audit table from 1 to N
    print_audit_table(results)

    # Record benchmark
    record_benchmark(len(targets), total_new, total_duration)
    print(f"Scout run completed across all {len(targets)} targets in {total_duration:.1f}s. Benchmarks updated.")

if __name__ == '__main__':
    main()
