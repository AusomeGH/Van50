#!/usr/bin/env python3
"""
Van50 Calendar Conflict Resolution & Investigation Engine
Arbitrates discrepancies between regularly occurring venue baselines (weekly residencies,
open mics, dance nights) and specific live calendar entries (touring gigs, festivals, closures).

Investigation Rules:
1. Closure / Blackout Preemption: If the calendar notes private buyouts or closures, suppress the date.
2. Dual-Program Coexistence: If events operate in distinct time slots (early concert vs. late dance), partition into separate cards.
3. Specific Ticketed Event Preemption: If a specific dated gig replaces a generic residency in the same time slot, the specific gig takes precedence.
4. Budget Cap Enforcement: Events exceeding $50.00 CAD are quarantined.
"""

from datetime import datetime
import re
import sys
from typing import Dict, List, Optional, Tuple, Any

sys.stdout.reconfigure(encoding='utf-8')

class CalendarConflictResolver:
    """
    Investigates and resolves schedule, lineup, and pricing conflicts
    between a venue's recurring baseline and its live calendar entries.
    """

    BLACKOUT_KEYWORDS = [
        "closed for private event", "private party", "private buyout",
        "holiday closure", "closed for maintenance", "venue closed",
        "no public admission", "dark night", "temporarily closed"
    ]

    @classmethod
    def investigate_day_conflict(
        cls,
        venue_name: str,
        target_dow: str,
        baseline_event: Dict[str, Any],
        live_calendar_events: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Investigates which event is most likely to occur on target_dow.
        Returns a decision payload with resolution status, selected event(s), and audit trail.
        """
        audit_trail = []
        matching_live = []

        # 1. Filter live calendar events matching target day of week
        for ev in live_calendar_events:
            ev_dows = ev.get("daysOfWeek", [])
            if target_dow.lower() in [d.lower() for d in ev_dows] or "all" in ev_dows or "daily" in ev_dows:
                matching_live.append(ev)

        if not matching_live:
            audit_trail.append(f"No conflicting live calendar entries on {target_dow.upper()}. Baseline residency retained.")
            return {
                "status": "baseline_retained",
                "events": [baseline_event],
                "auditTrail": audit_trail
            }

        # 2. Check for explicit closure / blackout notices
        for ev in matching_live:
            title_desc = f"{ev.get('title', '')} {ev.get('description', '')}".lower()
            for kw in cls.BLACKOUT_KEYWORDS:
                if kw in title_desc:
                    audit_trail.append(f"Blackout detected on {target_dow.upper()}: '{kw}' found in '{ev.get('title')}'. Day suppressed.")
                    # Remove target_dow from baseline
                    updated_baseline = dict(baseline_event)
                    updated_dows = [d for d in updated_baseline.get("daysOfWeek", []) if d.lower() != target_dow.lower()]
                    updated_baseline["daysOfWeek"] = updated_dows
                    return {
                        "status": "blackout_suppressed",
                        "events": [updated_baseline],
                        "blackoutReason": kw,
                        "auditTrail": audit_trail
                    }

        # 3. Check for Time Slot Partitioning (Dual-Program Coexistence)
        # e.g., 7:00 PM live concert (early-evening) + 10:30 PM dance night (late-evening)
        baseline_slots = set(baseline_event.get("timeSlots", []))
        coexisting_events = []
        preempted_events = []

        for live_ev in matching_live:
            live_slots = set(live_ev.get("timeSlots", []))
            
            # If time slots are disjoint (e.g. early-evening vs late-evening)
            if baseline_slots and live_slots and baseline_slots.isdisjoint(live_slots):
                audit_trail.append(
                    f"Dual-Program Coexistence: '{live_ev.get('title')}' ({list(live_slots)}) "
                    f"does not collide with baseline '{baseline_event.get('title')}' ({list(baseline_slots)}). Both emitted."
                )
                coexisting_events.append(live_ev)
            else:
                # Direct collision in time slot
                # Investigate: Is the live event confirmed, ticketed, and within budget?
                live_price = float(live_ev.get("price", live_ev.get("basePrice", 0.0)))
                if live_price > 50.00:
                    audit_trail.append(
                        f"Live event '{live_ev.get('title')}' price ${live_price:.2f} CAD exceeds $50.00 cap. "
                        f"Quarantining live event and evaluating baseline."
                    )
                    continue

                audit_trail.append(
                    f"Direct Time Slot Collision on {target_dow.upper()}: "
                    f"Live calendar ticketed event '{live_ev.get('title')}' preempts generic baseline '{baseline_event.get('title')}'."
                )
                preempted_events.append(live_ev)

        # 4. Construct Final Resolution
        if preempted_events:
            # The specific live event(s) take precedence
            final_list = preempted_events + coexisting_events
            return {
                "status": "calendar_preempted",
                "events": final_list,
                "auditTrail": audit_trail
            }
        elif coexisting_events:
            # Baseline and live co-exist in different slots
            final_list = [baseline_event] + coexisting_events
            return {
                "status": "dual_coexistence",
                "events": final_list,
                "auditTrail": audit_trail
            }

        audit_trail.append(f"No higher-priority calendar entries on {target_dow.upper()}. Baseline retained.")
        return {
            "status": "baseline_retained",
            "events": [baseline_event],
            "auditTrail": audit_trail
        }

    @classmethod
    def reconcile_venue_programming(
        cls,
        venue_name: str,
        baseline_events: List[Dict[str, Any]],
        live_calendar_events: List[Dict[str, Any]]
    ) -> Tuple[List[Dict[str, Any]], List[str]]:
        """
        Reconciles the full programming schedule for a venue across all days of the week.
        Returns (reconciled_events, audit_logs).
        """
        all_audit_logs = []
        final_events = []
        days_of_week = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

        # If no live calendar events available, retain baselines
        if not live_calendar_events:
            return baseline_events, [f"No live calendar events found for '{venue_name}'. Baseline programming preserved."]

        # If no baseline events exist, all live calendar events under $50 become active
        if not baseline_events:
            valid_live = [e for e in live_calendar_events if float(e.get("price", e.get("basePrice", 0.0))) <= 50.00]
            return valid_live, [f"No baseline for '{venue_name}'. Emitting {len(valid_live)} authenticated live calendar events."]

        # Process each baseline event
        for base in baseline_events:
            base_dows = base.get("daysOfWeek", [])
            modified_base = dict(base)
            suppressed_days = set()

            for dow in days_of_week:
                if dow in base_dows:
                    res = cls.investigate_day_conflict(venue_name, dow, base, live_calendar_events)
                    all_audit_logs.extend(res["auditTrail"])

                    if res["status"] == "blackout_suppressed":
                        suppressed_days.add(dow)
                    elif res["status"] == "calendar_preempted":
                        # Specific live events take over that day
                        for ev in res["events"]:
                            if ev not in final_events:
                                final_events.append(ev)
                        suppressed_days.add(dow)
                    elif res["status"] == "dual_coexistence":
                        # Add the non-baseline events
                        for ev in res["events"]:
                            if ev != base and ev not in final_events:
                                final_events.append(ev)

            # Update baseline operating days if any days were preempted or blacked out
            active_dows = [d for d in base_dows if d not in suppressed_days]
            if active_dows:
                modified_base["daysOfWeek"] = active_dows
                if modified_base not in final_events:
                    final_events.append(modified_base)

        return final_events, all_audit_logs


if __name__ == "__main__":
    print("=== TESTING CALENDAR CONFLICT RESOLUTION ENGINE ===")
    
    # Test 1: Specific concert replacing generic baseline
    sample_baseline = {
        "id": "sample-rock-night",
        "title": "Weekend Rock Showcase",
        "venue": "The Fox Cabaret",
        "daysOfWeek": ["fri", "sat"],
        "timeSlots": ["early-evening"],
        "price": 12.00,
        "dateSchedule": "Fridays & Saturdays • 8:00 PM"
    }

    sample_live_tour = {
        "id": "fox-album-release",
        "title": "Yukon Blonde Live at The Fox",
        "venue": "The Fox Cabaret",
        "daysOfWeek": ["fri"],
        "timeSlots": ["early-evening"],
        "price": 24.50,
        "dateSchedule": "Friday, Oct 16 • Doors 7:00 PM"
    }

    res1 = CalendarConflictResolver.investigate_day_conflict("The Fox Cabaret", "fri", sample_baseline, [sample_live_tour])
    print(f"Test 1 (Concert Preemption) Status: {res1['status']}")
    print(f"  • Selected title: {res1['events'][0]['title']}")
    assert res1['status'] == "calendar_preempted"
    assert res1['events'][0]['title'] == "Yukon Blonde Live at The Fox"

    # Test 2: Dual program coexistence (Early concert + Late dance party)
    sample_late_dance = {
        "id": "fox-retro-dance",
        "title": "90s Retro Dance Night",
        "venue": "The Fox Cabaret",
        "daysOfWeek": ["fri"],
        "timeSlots": ["late-evening"],
        "price": 18.50,
        "dateSchedule": "Fridays • 10:30 PM - 2:00 AM"
    }

    res2 = CalendarConflictResolver.investigate_day_conflict("The Fox Cabaret", "fri", sample_baseline, [sample_late_dance])
    print(f"\nTest 2 (Dual Coexistence) Status: {res2['status']}")
    print(f"  • Emitted {len(res2['events'])} events: {[e['title'] for e in res2['events']]}")
    assert res2['status'] == "dual_coexistence"
    assert len(res2['events']) == 2

    # Test 3: Blackout private party
    sample_blackout = {
        "id": "fox-private",
        "title": "Closed for Private Event",
        "venue": "The Fox Cabaret",
        "daysOfWeek": ["sat"],
        "timeSlots": ["early-evening", "late-evening"],
        "price": 0.0,
        "dateSchedule": "Saturday • Closed"
    }

    res3 = CalendarConflictResolver.investigate_day_conflict("The Fox Cabaret", "sat", sample_baseline, [sample_blackout])
    print(f"\nTest 3 (Blackout Suppression) Status: {res3['status']}")
    print(f"  • Remaining days for baseline: {res3['events'][0]['daysOfWeek']}")
    assert res3['status'] == "blackout_suppressed"
    assert "sat" not in res3['events'][0]['daysOfWeek']

    print("\n✓ ALL CALENDAR CONFLICT RESOLVER TESTS PASSED CLEANLY!")
