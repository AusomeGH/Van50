#!/usr/bin/env python3
"""
scripts/review_quarantine.py
Antigravity Quarantine Inspection and Release Tool.

Usage:
  # 1. Inspect all quarantined items awaiting Antigravity review:
  python scripts/review_quarantine.py

  # 2. Inspect all items in quarantine (including unannotated):
  python scripts/review_quarantine.py --all

  # 3. Release an event to live catalog after user alignment:
  python scripts/review_quarantine.py --release <event_id> --action approve --price 20.00 --category shows

  # 4. Release an event to archive after user alignment:
  python scripts/review_quarantine.py --release <event_id> --action archive --reason "True price $65 exceeds $50 cap"
"""

import os
import sys
import json
import argparse
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
ARCHIVE_PATH = os.path.join(DATA_DIR, "archived_events.json")
INSTRUCTIONS_PATH = os.path.join(DATA_DIR, "curator_instructions.json")
RULES_PATH = os.path.join(DATA_DIR, "curator_learned_rules.json")


def load_json(path: str, default=None):
    if default is None:
        default = {}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return default


def save_json(path: str, data: dict):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def inspect_quarantine(show_all=False):
    q_data = load_json(QUEUE_PATH, {"quarantinedEvents": []})
    events = q_data.get("quarantinedEvents", [])
    
    if not events:
        print("[QUARANTINE REVIEW] Manual review queue is empty (0 items).")
        return []

    pending_antigravity = [
        e for e in events 
        if e.get("reviewStatus") == "pending_antigravity_review" or e.get("curatorAnnotation")
    ]
    
    targets = events if show_all else pending_antigravity
    
    print("=" * 80)
    print(f"VAN50 QUARANTINE INSPECTION: {len(targets)} item(s) to inspect (Total in queue: {len(events)})")
    if not show_all and not pending_antigravity:
        print("No items currently marked with 'pending_antigravity_review'.")
        print("Tip: Run with --all to see unannotated quarantined items.")
        print("=" * 80)
        return []

    print("=" * 80)

    for idx, ev in enumerate(targets, 1):
        ev_id = ev.get("id")
        title = ev.get("title", "Untitled")
        venue = ev.get("venue", "Unknown Venue")
        price = ev.get("price") or ev.get("attemptedPrice", 0.0)
        price_label = ev.get("priceLabel") or ev.get("attemptedPriceLabel", f"${price:.2f}")
        url = ev.get("websiteUrl") or ev.get("url", "No URL")
        reason = ev.get("quarantineReason") or ev.get("flagReason", "Unverified")
        date_sched = ev.get("dateSchedule") or ev.get("startIso", "TBD")
        annotation = ev.get("curatorAnnotation") or {}
        
        print(f"\n[{idx}] EVENT ID: {ev_id}")
        print(f"    Title:         {title}")
        print(f"    Venue:         {venue}")
        print(f"    Date/Schedule: {date_sched}")
        print(f"    Detected Price:{price_label} (${price:.2f})")
        print(f"    URL:           {url}")
        print(f"    Status:        {ev.get('reviewStatus', 'quarantined')}")
        print(f"    Flag Reason:   {reason}")
        
        if annotation:
            print(f"    --- CURATOR ANNOTATION ---")
            print(f"    Proposed Act:  {annotation.get('proposedAction', 'N/A')}")
            print(f"    Curator Note:  {annotation.get('note', 'No note')}")
            if annotation.get("userSuppliedPrice") is not None:
                print(f"    Target Price:  ${annotation.get('userSuppliedPrice'):.2f} CAD")
            shots = annotation.get("screenshotPaths", [])
            if shots:
                print(f"    Screenshots ({len(shots)}):")
                for s in shots:
                    abs_shot = os.path.join(BASE_DIR, s)
                    print(f"      - file:///{abs_shot.replace(os.sep, '/')}")
            else:
                print(f"    Screenshots:   None")
        else:
            print(f"    Curator Notes: None attached")

    print("\n" + "=" * 80)
    return targets


def release_quarantined_event(event_id: str, action: str, price: float = None, category: str = None, reason: str = None):
    """
    Executes Antigravity-authorized release from quarantine to live catalog or archive.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    q_data = load_json(QUEUE_PATH, {"quarantinedEvents": [], "metadata": {}})
    q_list = q_data.get("quarantinedEvents", [])
    
    target_ev = next((e for e in q_list if e.get("id") == event_id), None)
    if not target_ev:
        print(f"[ERROR] Event ID '{event_id}' not found in manual_review_queue.json")
        return False

    # Remove from quarantine
    new_q = [e for e in q_list if e.get("id") != event_id]
    q_data["quarantinedEvents"] = new_q
    q_data.setdefault("metadata", {})["pendingCount"] = len(new_q)
    q_data["metadata"]["updatedAt"] = now_iso
    save_json(QUEUE_PATH, q_data)

    if action == "approve":
        # Promote to live catalog
        final_price = price if price is not None else float(target_ev.get("attemptedPrice", target_ev.get("price", 0.0)))
        if final_price > 50.0:
            print(f"[ERROR] Cannot promote: Price ${final_price:.2f} CAD exceeds strict $50 cap.")
            return False

        target_ev["price"] = final_price
        target_ev["isFree"] = final_price == 0
        target_ev["pricingType"] = "free" if final_price == 0 else "fixed"
        target_ev["priceLabel"] = "Free ($0)" if final_price == 0 else f"${final_price:.2f} all-in"
        if category:
            target_ev["category"] = category
            target_ev["categories"] = [category]
        target_ev["reviewStatus"] = "curator_approved"
        target_ev["promotedAt"] = now_iso
        target_ev["checkoutVerification"] = {
            "status": "verified_live",
            "method": "antigravity_curator_review",
            "verifiedTotal": final_price,
            "feeBreakdown": f"${final_price:.2f} CAD verified via Antigravity curator review",
            "verifiedAt": now_iso,
            "details": f"Approved by Antigravity with user confirmation. {reason or ''}".strip()
        }

        events_db = load_json(EVENTS_PATH, {"events": [], "metadata": {}})
        ev_list = [e for e in events_db.get("events", []) if e.get("id") != event_id]
        ev_list.append(target_ev)
        events_db["events"] = ev_list
        events_db.setdefault("metadata", {})["totalEvents"] = len(ev_list)
        events_db["metadata"]["updatedAt"] = now_iso
        save_json(EVENTS_PATH, events_db)
        print(f"[RELEASE APPROVED] Event '{target_ev.get('title')}' promoted to events.json at ${final_price:.2f} CAD.")

    elif action == "archive":
        # Archive event
        target_ev["archivedAt"] = now_iso
        target_ev["reviewStatus"] = "dismissed_by_curator"
        target_ev["archivedReason"] = reason or "Dismissed following Antigravity curator review"
        
        arch_db = load_json(ARCHIVE_PATH, {"archivedEvents": [], "metadata": {}})
        arch_list = [a for a in arch_db.get("archivedEvents", []) if a.get("id") != event_id]
        arch_list.append(target_ev)
        arch_db["archivedEvents"] = arch_list
        arch_db.setdefault("metadata", {})["totalArchived"] = len(arch_list)
        arch_db["metadata"]["updatedAt"] = now_iso
        save_json(ARCHIVE_PATH, arch_db)

        # Register in learned rules archived IDs
        rules_data = load_json(RULES_PATH, {})
        arch_ids = rules_data.setdefault("archived_event_ids", [])
        if event_id not in arch_ids:
            arch_ids.append(event_id)
            save_json(RULES_PATH, rules_data)
        print(f"[RELEASE ARCHIVED] Event '{target_ev.get('title')}' moved to archived_events.json.")

    # Re-sync js/data.js
    try:
        from scripts.curator_server import sync_js_data_file
        sync_js_data_file()
    except Exception:
        pass

    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Antigravity Quarantine Inspection and Release Tool")
    parser.add_argument("--all", action="store_true", help="Display all quarantined items regardless of review status")
    parser.add_argument("--release", type=str, help="Event ID to release from quarantine")
    parser.add_argument("--action", choices=["approve", "archive"], help="Release action to take")
    parser.add_argument("--price", type=float, help="Verified final price in CAD (for approve action)")
    parser.add_argument("--category", type=str, help="Verified activity category (for approve action)")
    parser.add_argument("--reason", type=str, help="Notes or rationale for release/archival")
    
    args = parser.parse_args()
    
    if args.release:
        if not args.action:
            print("[ERROR] Must specify --action approve or --action archive when releasing.")
            sys.exit(1)
        success = release_quarantined_event(
            event_id=args.release,
            action=args.action,
            price=args.price,
            category=args.category,
            reason=args.reason
        )
        sys.exit(0 if success else 1)
    else:
        inspect_quarantine(show_all=args.all)
