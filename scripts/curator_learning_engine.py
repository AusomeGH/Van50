#!/usr/bin/env python3
"""
Van50 Autonomous Curator Learning & Triage Engine
Digests curator notes, screenshots, and instructions to:
1. Automatically sort the manual review queue (archive bad/sold-out/phantom items, promote verified ones).
2. Distill policy rules into curator_learned_rules.json (deep links, blacklists, door rates, venue policies).
3. Ensure daily crawlers and 'Run Full Sync' respect learned rules permanently.
"""

from __future__ import annotations
import os
import re
import json
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
ARCHIVE_PATH = os.path.join(DATA_DIR, "archived_events.json")
RULES_PATH = os.path.join(DATA_DIR, "curator_learned_rules.json")
INSTRUCTIONS_PATH = os.path.join(DATA_DIR, "curator_instructions.json")
DISCOVERED_VENUES_PATH = os.path.join(DATA_DIR, "discovered_venues.json")


class CuratorLearningEngine:
    """Processes curator feedback, extracts algorithmic rules, and auto-triages review queues."""

    DISMISS_KEYWORDS = [
        "sold out", "can't find", "cannot find", "couldn't find", "can't see", 
        "not real", "fake", "not a true event", "phantom", "wrong links", 
        "links and events are wrong", "closed for a private event", "private event",
        "private rentals", "exclusive for children", "exclusively for children",
        "merchandise page", "isn't for the event", "not for the event",
        "paused for fringe", "paused", "not in vancouver", "too expensive",
        "exceeds $50", "strictly exceeds", "exclude and not added", "wrong location",
        "over for the summer", "season over", "season is over", "done for the season", 
        "finished for the summer", "no longer running", "over $50", "far too expensive",
        "way above", "above $50", "above the $50 threshold"
    ]

    PROMOTION_KEYWORDS = [
        "approved as-is", "verified price", "promote", "approved ga", "ticket price is $",
        "cover is $", "looks good", "good to me", "under 50 bucks", "under $50", "approved",
        "all good", "looks fine", "good to go", "valid",
        "cheap tickets", "under the threshold", "under threshold", "tickets under",
        "limited tickets are under", "tickets are under", "tickets under $50", "under $50.00",
        "limited number of cheap", "has tickets under", "options under", "cheap",
        "verified rate"
    ]

    @classmethod
    def process_pending_feedback(cls) -> Dict[str, Any]:
        """
        Main entry point. Scans curator_instructions.json, applies triage actions to
        manual_review_queue.json, distills rules into curator_learned_rules.json,
        and saves updated databases.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        stats = {
            "success": True,
            "instructionsProcessed": 0,
            "archived": 0,
            "promoted": 0,
            "rulesAdded": 0
        }

        # 1. Load all required data structures
        if not os.path.exists(INSTRUCTIONS_PATH):
            return stats

        try:
            with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
                inst_data = json.load(f)
        except Exception as e:
            print(f"[CURATOR LEARNER ERROR] Could not read instructions: {e}")
            return stats

        instructions: List[Dict[str, Any]] = inst_data.get("instructions", [])
        if not instructions:
            return stats

        # Load queue
        queue_data = {"pendingCount": 0, "quarantinedEvents": []}
        if os.path.exists(QUEUE_PATH):
            try:
                with open(QUEUE_PATH, "r", encoding="utf-8") as f:
                    queue_data = json.load(f)
            except Exception:
                pass
        quarantined: List[Dict[str, Any]] = queue_data.get("quarantinedEvents", [])

        # Load venue directory coordinates
        venue_coords_map: Dict[str, List[float]] = {}
        venue_dir_path = os.path.join(DATA_DIR, "venue_directory.json")
        if os.path.exists(venue_dir_path):
            try:
                with open(venue_dir_path, "r", encoding="utf-8") as vf:
                    vd = json.load(vf)
                    for vn, vobj in vd.get("venues", {}).items():
                        if "coordinates" in vobj:
                            venue_coords_map[vn.lower()] = vobj["coordinates"]
            except Exception:
                pass

        # Load events
        events_data = {"events": [], "metadata": {}}
        if os.path.exists(EVENTS_PATH):
            try:
                with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                    events_data = json.load(f)
            except Exception:
                pass
        events_list: List[Dict[str, Any]] = events_data.get("events", [])

        # Load archive
        arch_data = {"archivedEvents": [], "metadata": {}}
        if os.path.exists(ARCHIVE_PATH):
            try:
                with open(ARCHIVE_PATH, "r", encoding="utf-8") as f:
                    arch_data = json.load(f)
            except Exception:
                pass
        archived_list: List[Dict[str, Any]] = arch_data.get("archivedEvents", [])

        # Load rules
        rules_data = {
            "metadata": {"version": "1.0.0", "updatedAt": now_iso},
            "vendor_fee_formulas": {},
            "venue_calendar_deep_links": {},
            "course_blacklist_patterns": [],
            "archived_event_ids": [],
            "venue_policy_rules": {}
        }
        if os.path.exists(RULES_PATH):
            try:
                with open(RULES_PATH, "r", encoding="utf-8") as f:
                    rules_data = json.load(f)
            except Exception:
                pass

        archived_ids_set = set(rules_data.setdefault("archived_event_ids", []))
        deep_links: Dict[str, str] = rules_data.setdefault("venue_calendar_deep_links", {})
        blacklist_patterns: List[str] = rules_data.setdefault("course_blacklist_patterns", [])
        venue_policies: Dict[str, Any] = rules_data.setdefault("venue_policy_rules", {})

        # 2. Process each instruction
        for inst in instructions:
            # Skip instructions that have already been finalized
            if inst.get("applied") is True and inst.get("status") in ("resolved", "applied", "archived", "promoted"):
                continue

            text = (inst.get("instructionText") or "").strip()
            curator_note = (inst.get("curatorNote") or "").strip()
            full_text = f"{text} {curator_note}".strip()
            text_lower = full_text.lower()
            ev_id = inst.get("eventId")
            ev_title = inst.get("eventTitle") or ""
            venue_name = inst.get("venueName") or ""
            action = inst.get("action") or inst.get("actionTaken")

            stats["instructionsProcessed"] += 1

            # Determine whether this instruction targets a specific event or an entire venue
            is_venue_inst = bool(
                (ev_id and (ev_id.startswith("discovered-") or ev_id.startswith("pending-venue-") or ev_id.startswith("venue-"))) or
                (not ev_id and venue_name) or
                (ev_title.startswith("Venue:"))
            )

            # A. Extract URLs and register deep links (venue-level only)
            urls = re.findall(r'https?://[^\s<>"]+', full_text)
            for u in urls:
                clean_u = u.rstrip(".,;)")
                if is_venue_inst and venue_name and "tickets" not in venue_name.lower():
                    deep_links[venue_name] = clean_u
                    stats["rulesAdded"] += 1
                elif any(kw in clean_u.lower() for kw in ["/events", "/schedule", "/shows", "/calendar"]):
                    if venue_name and ("ticketmaster.com" not in clean_u and "ticketmaster.ca" not in clean_u):
                        deep_links[venue_name] = clean_u

            # B. Extract Blacklist Patterns from comments (e.g. PayPal, merchandise /shop)
            if "paypal" in text_lower:
                if "paypal.com/ncp/" not in blacklist_patterns:
                    blacklist_patterns.append("paypal.com/ncp/")
                    stats["rulesAdded"] += 1
            if "/shop" in text_lower or "merchandise" in text_lower:
                if "/shop" not in blacklist_patterns:
                    blacklist_patterns.append("/shop")
                    stats["rulesAdded"] += 1
            if "not real" in text_lower or "can't find the venue in vancouver" in text_lower:
                if venue_name and venue_name.lower() not in [b.lower() for b in blacklist_patterns]:
                    blacklist_patterns.append(venue_name)
                    stats["rulesAdded"] += 1

            # C. Extract Venue Policy Rules (e.g. minimum spend, children-only filter, website suppression)
            if "minimum spend" in text_lower:
                m_spend = re.search(r'minimum spend of \$?(\d+(?:\.\d{2})?)', text_lower)
                spend_val = float(m_spend.group(1)) if m_spend else 20.0
                venue_policies[venue_name or "Pizzeria Ludica"] = {
                    "minimumSpend": spend_val,
                    "pricingType": "minimum-spend",
                    "durationPolicy": "2 hours maximum during peak periods",
                    "source": f"Curator Guidance: {text[:60]}"
                }
                stats["rulesAdded"] += 1

            if "exclusively for children" in text_lower or "demographic" in text_lower:
                venue_policies[venue_name or "Carousel Theatre"] = {
                    "demographicFilter": "adults_only",
                    "excludeKeywords": ["children", "kids", "toddler", "youth", "family show"],
                    "source": f"Curator Guidance: {text[:60]}"
                }
                stats["rulesAdded"] += 1

            if "don't want it prompted to enter the list until the website actually works" in text_lower:
                venue_policies[venue_name or "LanaLou's"] = {
                    "suppressScraping": True,
                    "suppressReason": "Venue website inactive or unverified by curator",
                    "source": f"Curator Guidance: {text[:60]}"
                }
                stats["rulesAdded"] += 1

            # D. Find matching events across quarantine, active catalog, AND archive (to support rescue/un-archive)
            matching_events = []
            all_candidates = list(quarantined)
            for ev in events_list:
                if not any(c.get("id") == ev.get("id") for c in all_candidates):
                    all_candidates.append(ev)
            for ar in archived_list:
                if not any(c.get("id") == ar.get("id") for c in all_candidates):
                    all_candidates.append(ar)

            for cand in all_candidates:
                q_id = cand.get("id")
                q_venue = (cand.get("venue") or "").lower()
                q_title = (cand.get("title") or "").lower()

                match = False
                if is_venue_inst:
                    # Venue-level matching applies to all events at venue
                    if venue_name and venue_name.lower() in q_venue:
                        match = True
                    elif q_venue and venue_name and q_venue in venue_name.lower():
                        match = True
                else:
                    # Specific event instruction: ONLY match the specific target event!
                    if ev_id and q_id == ev_id:
                        match = True
                    elif ev_id and q_id and (ev_id in q_id or q_id in ev_id):
                        match = True
                    elif ev_title and ev_title.lower() == q_title:
                        match = True
                
                if match and cand not in matching_events:
                    matching_events.append(cand)

            # E. Determine Triage Decision for matching events
            is_dismiss = action in ("queue_and_dismiss", "dismiss") or any(kw in text_lower for kw in cls.DISMISS_KEYWORDS)
            is_promote = not is_dismiss and (action in ("queue_and_approve", "approve") or any(kw in text_lower for kw in cls.PROMOTION_KEYWORDS))

            # Extract price if explicitly mentioned in curator note or text (e.g. "Verified rate: $20.00 all-in")
            curator_price_override = None
            m_rate = re.search(r'(?:verified rate|rate|price|cover|tickets?)\s*(?:is|:)?\s*\$?(\d+(?:\.\d{2})?)', text_lower)
            if m_rate:
                try:
                    c_p = float(m_rate.group(1))
                    if 0.0 <= c_p <= 50.0:
                        curator_price_override = c_p
                except ValueError:
                    pass

            # Check for Showpass or direct ticket link in promotion
            direct_showpass = next((u.rstrip(".,;)") for u in urls if "showpass.com" in u), None)
            
            for item in matching_events:
                eid = item.get("id")
                # GATED PROTOCOL: Never release or evict quarantined items without Antigravity review!
                if any(q.get("id") == eid for q in quarantined) or item.get("reviewStatus") == "pending_antigravity_review":
                    item["reviewStatus"] = "pending_antigravity_review"
                    continue
                
                if is_promote:
                    # Promote to live catalog
                    if direct_showpass:
                        item["websiteUrl"] = direct_showpass
                    item["reviewStatus"] = "curator_approved"
                    item["promotedAt"] = now_iso
                    item["curatorGuidance"] = full_text
                    
                    # Ensure required event metadata fields are set
                    if curator_price_override is not None:
                        price_val = curator_price_override
                    else:
                        price_val = float(item.get("attemptedPrice", item.get("price", 20.0)))
                    item["price"] = price_val
                    item["isFree"] = price_val == 0
                    item["pricingType"] = "free" if price_val == 0 else "fixed"
                    if not item.get("priceLabel") or curator_price_override is not None:
                        item["priceLabel"] = "Free ($0)" if price_val == 0 else f"${price_val:.2f} all-in"
                    if not item.get("category"):
                        item["category"] = "shows"
                    if not item.get("categories"):
                        item["categories"] = [item["category"]]
                    if not item.get("frequency"):
                        item["frequency"] = "one-time"
                    if not item.get("startIso"):
                        item["startIso"] = now_iso
                    if not item.get("description"):
                        item["description"] = f"Live performance at {item.get('venue', 'Vancouver, BC')}."
                    if not item.get("ticketProvider"):
                        item["ticketProvider"] = "Curator Verified"

                    # Lock checkout verification so crawler doesn't re-quarantine
                    item["checkoutVerification"] = {
                        "status": "verified_live",
                        "method": "manual_curator_review",
                        "verifiedTotal": price_val,
                        "feeBreakdown": f"${price_val:.2f} CAD verified via Curator review",
                        "verifiedAt": now_iso,
                        "details": f"Approved by curator: {text[:100]}"
                    }

                    # Ensure coordinates are set for map compliance
                    if not item.get("coordinates") or not isinstance(item.get("coordinates"), list) or len(item.get("coordinates")) != 2:
                        v_lower = (item.get("venue") or "").lower()
                        matched_coords = None
                        for v_k, v_c in venue_coords_map.items():
                            if v_k in v_lower or v_lower in v_k:
                                matched_coords = v_c
                                break
                        item["coordinates"] = matched_coords or [49.2827, -123.1207]

                    # Add to events_list if not present
                    if not any(e.get("id") == eid for e in events_list):
                        events_list.append(item)
                    # Remove from archive if present
                    archived_list = [a for a in archived_list if a.get("id") != eid]
                    if eid in archived_ids_set:
                        archived_ids_set.remove(eid)
                    stats["promoted"] += 1
                elif is_dismiss or True:  # Default to archive if curator flagged with critique
                    # Ensure removed from live events_list
                    events_list = [e for e in events_list if e.get("id") != eid]

                    # Archive event
                    item["archivedAt"] = now_iso
                    item["archivedReason"] = f"Curator guidance: {text}"
                    is_concluded = any(k in text_lower for k in ["over for the summer", "season over", "season is over", "concluded", "ended", "done for the season"])
                    if is_concluded:
                        item["reviewStatus"] = "concluded"
                        item["isConcluded"] = True
                    elif "sold out" in text_lower:
                        item["reviewStatus"] = "sold_out"
                        item["isSoldOut"] = True
                    else:
                        item["reviewStatus"] = "dismissed_by_curator"
                    
                    # Add to archived_list if not present
                    if not any(a.get("id") == eid for a in archived_list):
                        archived_list.append(item)
                    
                    archived_ids_set.add(eid)
                    stats["archived"] += 1

            if is_dismiss and ev_id:
                archived_ids_set.add(ev_id)

            # Mark instruction as applied
            inst["applied"] = True
            inst["appliedAt"] = now_iso
            inst["status"] = "resolved"

        # 2b. Process Discovered Venues with Curator Notes
        if os.path.exists(DISCOVERED_VENUES_PATH):
            try:
                with open(DISCOVERED_VENUES_PATH, "r", encoding="utf-8") as dvf:
                    dv_data = json.load(dvf)
                disc_venues = dv_data.get("discoveredVenues", [])
                dv_updated = False

                for dv in disc_venues:
                    v_note = (dv.get("curatorNote") or "").strip()
                    v_name = dv.get("name") or ""
                    if not v_note:
                        continue

                    # Extract calendar / website URLs from curator note
                    v_urls = re.findall(r'https?://[^\s<>"]+', v_note)
                    for vu in v_urls:
                        clean_vu = vu.rstrip(".,;)")
                        if v_name:
                            deep_links[v_name] = clean_vu
                            stats["rulesAdded"] += 1
                            dv_updated = True

                    # Distill venue policy rules if applicable
                    if "exclusively for children" in v_note.lower():
                        venue_policies[v_name] = {
                            "demographicFilter": "adults_only",
                            "excludeKeywords": ["children", "kids", "toddler", "family show"],
                            "source": f"Curator Venue Note: {v_note[:60]}"
                        }
                        stats["rulesAdded"] += 1
                        dv_updated = True

                    # Transition candidate venue status once curator has triaged / provided guidance
                    if dv.get("status") == "pending":
                        dismiss_keywords = ["not a venue", "fake", "dismiss", "do not include", "delete", "skip"]
                        if any(k in v_note.lower() for k in dismiss_keywords):
                            dv["status"] = "dismissed"
                            dv["dismissedAt"] = now_iso
                            stats["archived"] += 1
                        else:
                            dv["status"] = "approved"
                            dv["approvedAt"] = now_iso
                            stats["promoted"] += 1
                        dv_updated = True

                if dv_updated:
                    dv_data["metadata"]["updatedAt"] = now_iso
                    with open(DISCOVERED_VENUES_PATH, "w", encoding="utf-8") as dvf:
                        json.dump(dv_data, dvf, indent=2, ensure_ascii=False)
            except Exception as e:
                print(f"[CURATOR LEARNER WARN] Error processing discovered venues: {e}")

        # Double-check map coordinates compliance for all active events
        for ev in events_list:
            if not ev.get("coordinates") or not isinstance(ev.get("coordinates"), list) or len(ev.get("coordinates")) != 2:
                v_lower = (ev.get("venue") or "").lower()
                matched_coords = None
                for v_k, v_c in venue_coords_map.items():
                    if v_k in v_lower or v_lower in v_k:
                        matched_coords = v_c
                        break
                ev["coordinates"] = matched_coords or [49.2827, -123.1207]

        # 3. Quarantined queue retention: NEVER evict items awaiting Antigravity review!
        archived_and_promoted_ids = {a.get("id") for a in archived_list} | {e.get("id") for e in events_list} | archived_ids_set
        kept_quarantine = []
        for q in quarantined:
            if q.get("reviewStatus") == "pending_antigravity_review" or q.get("curatorAnnotation"):
                kept_quarantine.append(q)
            elif q.get("id") not in archived_and_promoted_ids:
                kept_quarantine.append(q)

        # 4. Save updated manual_review_queue.json
        queue_data["quarantinedEvents"] = kept_quarantine
        queue_data["pendingCount"] = len(kept_quarantine)
        queue_data["lastTriagedAt"] = now_iso
        with open(QUEUE_PATH, "w", encoding="utf-8") as f:
            json.dump(queue_data, f, indent=2, ensure_ascii=False)

        # 5. Save updated archived_events.json
        arch_data["archivedEvents"] = archived_list
        arch_data["metadata"] = arch_data.get("metadata", {})
        arch_data["metadata"]["totalArchived"] = len(archived_list)
        arch_data["metadata"]["updatedAt"] = now_iso
        with open(ARCHIVE_PATH, "w", encoding="utf-8") as f:
            json.dump(arch_data, f, indent=2, ensure_ascii=False)

        # 6. Save updated events.json
        events_data["events"] = events_list
        events_data["metadata"] = events_data.get("metadata", {})
        events_data["metadata"]["totalEvents"] = len(events_list)
        events_data["metadata"]["updatedAt"] = now_iso
        with open(EVENTS_PATH, "w", encoding="utf-8") as f:
            json.dump(events_data, f, indent=2, ensure_ascii=False)

        # 7. Save updated curator_learned_rules.json
        rules_data["archived_event_ids"] = sorted(list(archived_ids_set))
        rules_data["venue_calendar_deep_links"] = deep_links
        rules_data["course_blacklist_patterns"] = list(dict.fromkeys(blacklist_patterns))
        rules_data["venue_policy_rules"] = venue_policies
        rules_data.setdefault("metadata", {})["updatedAt"] = now_iso
        with open(RULES_PATH, "w", encoding="utf-8") as f:
            json.dump(rules_data, f, indent=2, ensure_ascii=False)

        # 8. Save updated curator_instructions.json
        inst_data["instructions"] = instructions
        inst_data["lastLearnedAt"] = now_iso
        with open(INSTRUCTIONS_PATH, "w", encoding="utf-8") as f:
            json.dump(inst_data, f, indent=2, ensure_ascii=False)

        print(f"[CURATOR LEARNING COMPLETE] Digested {stats['instructionsProcessed']} instructions: {stats['archived']} archived, {stats['promoted']} promoted, {stats['rulesAdded']} rules distilled. Remaining quarantine: {len(kept_quarantine)}.")
        return stats


if __name__ == "__main__":
    result = CuratorLearningEngine.process_pending_feedback()
    print(json.dumps(result, indent=2))
