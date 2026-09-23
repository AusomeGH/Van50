"""
Test script to verify date inclusion in Confirmed vs Unconfirmed Details in Curator Mode.
"""
import json
import re
import sys

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def evaluate_curator_date(ev):
    """
    Python mirror of evaluateCuratorDateStatus in js/curator.js
    """
    raw_date_str = ev.get("dateSchedule") or ""
    if not raw_date_str and ev.get("startIso"):
        raw_date_str = ev.get("startIso")
    elif not raw_date_str and ev.get("daysOfWeek"):
        raw_date_str = ", ".join(ev["daysOfWeek"])
    elif not raw_date_str and ev.get("isDaily"):
        raw_date_str = "Daily"
    
    is_date_missing = (not raw_date_str or 
                       raw_date_str == "Schedule details pending review" or 
                       (not ev.get("dateSchedule") and not ev.get("startIso") and not ev.get("daysOfWeek") and not ev.get("isDaily")))
    
    reason = ev.get("quarantineReason") or ev.get("flagReason") or ev.get("archivedReason") or ""
    reason_text = " ".join([str(x) for x in [reason, ev.get("quarantineReason"), ev.get("flagReason"), ev.get("archivedReason")] if x]).lower()
    
    is_schedule_flagged = any(k in reason_text for k in [
        "schedule", "ended", "expired", "past date", "schedule drift", "drift", 
        "generic catalog index", "generic link", "bare root"
    ])
    
    is_date_past = False
    ref_date = "2026-09-22"
    if ev.get("endIso"):
        if ev["endIso"][:10] < ref_date:
            is_date_past = True
    elif ev.get("startIso") and not ev.get("isDaily") and ev.get("frequency") != "daily" and not ev.get("daysOfWeek"):
        if ev["startIso"][:10] < ref_date:
            is_date_past = True
            
    is_unconfirmed = is_date_missing or is_schedule_flagged or is_date_past
    
    if is_unconfirmed:
        if is_date_past:
            diag = f"📅 Event Date (Past / Expired): {raw_date_str} — scheduled date has passed; needs upcoming show date"
        elif "schedule changed" in reason_text or "schedule drift" in reason_text:
            diag = f"📅 Event Date (Schedule Drift): {raw_date_str} — live source differs from saved schedule"
        elif any(k in reason_text for k in ["generic", "catalog index", "bare root"]):
            diag = "📅 Event Date (Unconfirmed): Specific show date unconfirmed (links to general venue calendar)"
        elif is_date_missing:
            diag = "📅 Event Date (Unconfirmed): Show date & time not confirmed by automated crawl (pending curator review)"
        else:
            diag = f"📅 Event Date (Unconfirmed): {raw_date_str} (requires curator verification)"
    else:
        diag = f"📅 Event Date: {raw_date_str}"
        
    return {
        "is_unconfirmed": is_unconfirmed,
        "raw_date_str": raw_date_str,
        "diag": diag
    }

def main():
    print("=== TESTING CURATOR DATE DIAGNOSTICS ===")
    with open("data/manual_review_queue.json", "r", encoding="utf-8") as f:
        queue = json.load(f)
        
    events = queue.get("quarantinedEvents", [])
    print(f"Loaded {len(events)} quarantined events from manual_review_queue.json")
    
    # Also create synthetic test cases
    test_cases = list(events) + [
        {
            "id": "synthetic-confirmed-date",
            "title": "Confirmed Jazz Trio",
            "venue": "Guilt & Co",
            "dateSchedule": "Friday, Sept 25, 2026 • 7:00 PM",
            "startIso": "2026-09-25T19:00:00-07:00",
            "flagReason": "Unverified door rate"
        },
        {
            "id": "synthetic-missing-date",
            "title": "Mystery Show",
            "venue": "Generic Bar",
            "flagReason": "Unverified checkout"
        },
        {
            "id": "synthetic-past-date",
            "title": "Last Week's Comedy",
            "venue": "Comedy Cellar",
            "startIso": "2026-09-10T19:00:00-07:00",
            "dateSchedule": "Sept 10, 2026",
            "flagReason": "Needs review"
        },
        {
            "id": "synthetic-schedule-drift",
            "title": "Drifting Gig",
            "venue": "The Fox",
            "startIso": "2026-09-28T20:00:00-07:00",
            "dateSchedule": "Sept 28, 2026",
            "flagReason": "Detected schedule drift from source"
        }
    ]
    
    for ev in test_cases:
        res = evaluate_curator_date(ev)
        assert res["diag"].startswith("📅 Event Date"), f"Failed for {ev.get('id')}: {res['diag']}"
        if res["is_unconfirmed"]:
            box = "⚠️ Unconfirmed Details / Issues"
        else:
            box = "✅ Confirmed Details"
        print(f"[{ev.get('id')}] -> {box} -> '{res['diag']}'")
        
    print("\n✓ ALL CURATOR DATE DIAGNOSTIC TESTS PASSED!")

if __name__ == "__main__":
    main()
