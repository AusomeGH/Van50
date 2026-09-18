#!/usr/bin/env python3
"""
Van50 Universal Festival Crawler
Specialized multi-day & seasonal festival crawler with autonomous 30-day pre-window activation,
auto-off lifecycle, fee/membership button verification, and host venue discovery.
"""

import os
import sys
import json
import re
from datetime import datetime, date, timedelta, timezone
from typing import Dict, List, Tuple, Any, Optional
from urllib.parse import urljoin, urlparse

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    requests = None
    BeautifulSoup = None

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
FESTIVAL_REGISTRY_PATH = os.path.join(DATA_DIR, "festival_registry.json")
VENUE_DIRECTORY_PATH = os.path.join(DATA_DIR, "venue_directory.json")
DISCOVERED_VENUES_PATH = os.path.join(DATA_DIR, "discovered_venues.json")


class UniversalFestivalCrawler:
    """Orchestrates seasonal festival discovery with automated on/off lifecycle."""

    @classmethod
    def load_festivals(cls) -> List[Dict[str, Any]]:
        """Loads all festivals from data/festival_registry.json."""
        if not os.path.exists(FESTIVAL_REGISTRY_PATH):
            return []
        try:
            with open(FESTIVAL_REGISTRY_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("festivals", [])
        except Exception as e:
            print(f"[FESTIVAL CRAWLER] Error loading festivals: {e}")
            return []

    @classmethod
    def is_active_window(
        cls, festival: Dict[str, Any], reference_date: Optional[date] = None
    ) -> Tuple[bool, str, int]:
        """
        Determines whether a festival is within its active monitoring window.
        Returns (is_active, status_label, days_delta).
        
        Active window rule:
        - Starts exactly `preWindowDays` (default: 30) before festival opening date.
        - Concludes `postWindowDays` (default: 2) after closing date.
        """
        if reference_date is None:
            reference_date = datetime.now(timezone.utc).date()
        elif isinstance(reference_date, datetime):
            reference_date = reference_date.date()

        start_str = festival.get("startDate")
        end_str = festival.get("endDate")
        if not start_str or not end_str:
            return False, "missing_dates", 0

        start_dt = datetime.strptime(start_str, "%Y-%m-%d").date()
        end_dt = datetime.strptime(end_str, "%Y-%m-%d").date()

        pre_days = int(festival.get("preWindowDays", 30))
        post_days = int(festival.get("postWindowDays", 2))

        window_start = start_dt - timedelta(days=pre_days)
        window_end = end_dt + timedelta(days=post_days)

        if reference_date < window_start:
            days_until_window = (window_start - reference_date).days
            return False, "dormant_upcoming", days_until_window
        elif reference_date > window_end:
            days_past = (reference_date - window_end).days
            return False, "concluded", days_past
        else:
            if reference_date < start_dt:
                days_until_start = (start_dt - reference_date).days
                return True, "active_pre_window", days_until_start
            elif reference_date <= end_dt:
                days_remaining = (end_dt - reference_date).days
                return True, "active_live", days_remaining
            else:
                days_wrapup = (window_end - reference_date).days
                return True, "active_post_window", days_wrapup

    @classmethod
    def discover_and_register_host_venues(
        cls, festival: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Cross-references festival host venues against the permanent venue directory.
        Any unknown venue is registered in data/discovered_venues.json as 'pending'.
        """
        known_venues = {}
        if os.path.exists(VENUE_DIRECTORY_PATH):
            try:
                with open(VENUE_DIRECTORY_PATH, "r", encoding="utf-8") as f:
                    vdata = json.load(f)
                    known_venues = vdata.get("venues", {})
            except Exception:
                pass

        known_names = set(k.lower() for k in known_venues.keys())
        for v in known_venues.values():
            for alias in v.get("aliases", []):
                known_names.add(alias.lower())

        existing_discovered = []
        if os.path.exists(DISCOVERED_VENUES_PATH):
            try:
                with open(DISCOVERED_VENUES_PATH, "r", encoding="utf-8") as f:
                    disc_data = json.load(f)
                    existing_discovered = disc_data.get("discoveredVenues", [])
            except Exception:
                pass

        discovered_names = set(d.get("name", "").lower() for d in existing_discovered)
        newly_flagged = []

        fest_name = festival.get("name", "Unknown Festival")
        fest_id = festival.get("id", "festival")

        for host_venue_name in festival.get("hostVenues", []):
            h_clean = host_venue_name.strip()
            h_lower = h_clean.lower()

            if h_lower in known_names:
                continue

            if h_lower in discovered_names:
                continue

            slug = re.sub(r"[^\w\s-]", "", h_lower)
            venue_id = f"discovered-{re.sub(r'[-\s]+', '-', slug).strip('-')}"

            # Default neighborhood heuristic
            neighborhood = "Granville Island" if "granville" in h_lower or "island" in h_lower else "Downtown / West End"
            if "commercial" in h_lower or "east" in h_lower:
                neighborhood = "Commercial Drive"
            elif "main" in h_lower or "pleasant" in h_lower:
                neighborhood = "Mount Pleasant"

            new_entry = {
                "id": venue_id,
                "name": h_clean,
                "address": f"{h_clean}, Vancouver, BC",
                "neighborhood": neighborhood,
                "category": festival.get("category", "shows"),
                "websiteUrl": festival.get("websiteUrl", ""),
                "calendarUrl": festival.get("scheduleUrl", festival.get("websiteUrl", "")),
                "discoveredVia": fest_name,
                "discoverySourceId": fest_id,
                "sampleEvent": f"{fest_name} Performances & Showcases",
                "status": "pending",
                "discoveredAt": datetime.now(timezone.utc).isoformat(),
                "curatorNote": ""
            }

            existing_discovered.append(new_entry)
            discovered_names.add(h_lower)
            newly_flagged.append(new_entry)

        if newly_flagged:
            try:
                os.makedirs(DATA_DIR, exist_ok=True)
                with open(DISCOVERED_VENUES_PATH, "w", encoding="utf-8") as f:
                    json.dump(
                        {
                            "metadata": {
                                "version": "1.0.0",
                                "description": "Candidate venues detected via discovery feeds and festival programs.",
                                "updatedAt": datetime.now(timezone.utc).isoformat(),
                                "totalDiscovered": len(existing_discovered)
                            },
                            "discoveredVenues": existing_discovered
                        },
                        f,
                        indent=2,
                        ensure_ascii=False
                    )
                print(f"[FESTIVAL CRAWLER] Flagged {len(newly_flagged)} new venue candidate(s) from {fest_name}.")
            except Exception as e:
                print(f"[FESTIVAL CRAWLER ERROR] Failed to update discovered venues: {e}")

        return newly_flagged

    @classmethod
    def calculate_festival_show_price(
        cls, festival: Dict[str, Any], raw_show_price: float
    ) -> Tuple[float, str, bool]:
        """
        Calculates all-in ticket price for a festival show, incorporating
        mandatory one-time membership buttons / badges (e.g. Fringe $10 button).
        Returns (all_in_price, fee_breakdown, within_budget).
        """
        p_struct = festival.get("priceStructure", {})
        membership_fee = float(p_struct.get("membershipButtonFee", 0.0))
        gst = round(raw_show_price * 0.05, 2)
        total = round(raw_show_price + membership_fee + gst, 2)

        breakdown = f"${raw_show_price:.2f} show ticket"
        if membership_fee > 0:
            breakdown += f" + ${membership_fee:.2f} festival button"
        if gst > 0:
            breakdown += f" + ${gst:.2f} GST"
        breakdown += f" = ${total:.2f} CAD total out-of-pocket"

        within_budget = total <= 50.0
        return total, breakdown, within_budget

    @classmethod
    def run_cycle(cls, reference_date: Optional[date] = None) -> Dict[str, Any]:
        """
        Main execution cycle for festival monitoring.
        - Evaluates all registered festivals.
        - Activates active ones (within 30-day window).
        - Discovers host venues and registers them.
        """
        festivals = cls.load_festivals()
        active_list = []
        dormant_list = []
        all_new_venues = []

        for fest in festivals:
            fest_id = fest.get("id")
            name = fest.get("name")
            is_active, status, delta = cls.is_active_window(fest, reference_date)

            fest_report = {
                "id": fest_id,
                "name": name,
                "status": status,
                "daysDelta": delta,
                "startDate": fest.get("startDate"),
                "endDate": fest.get("endDate")
            }

            if is_active:
                active_list.append(fest_report)
                # Register host venues
                new_venues = cls.discover_and_register_host_venues(fest)
                all_new_venues.extend(new_venues)
            else:
                dormant_list.append(fest_report)

        return {
            "totalFestivals": len(festivals),
            "activeCount": len(active_list),
            "dormantCount": len(dormant_list),
            "activeFestivals": active_list,
            "dormantFestivals": dormant_list,
            "newlyDiscoveredVenues": all_new_venues,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


if __name__ == "__main__":
    result = UniversalFestivalCrawler.run_cycle()
    print(json.dumps(result, indent=2))
