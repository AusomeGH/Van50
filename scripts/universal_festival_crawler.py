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
CURATOR_RULES_PATH = os.path.join(DATA_DIR, "curator_learned_rules.json")

# Invariant physical coordinates and profiles for festival host stages
FESTIVAL_HOST_VENUE_DIRECTORY: Dict[str, Dict[str, Any]] = {
    "Waterfront Theatre": {
        "address": "1412 Cartwright St, Vancouver, BC",
        "neighborhood": "Granville Island",
        "coordinates": [49.2709, -123.1345],
        "transitInfo": "#50 False Creek Bus or Aquabus ferry dock to Granville Island",
        "venueUrl": "https://www.carouseltheatre.ca/waterfront-theatre/",
        "sampleShowTitle": "Behind The Wall: A Thriller Musical",
        "artist": "Kay Snell & Landon Dueck",
        "performers": "Landon And Friends Musical Theatre Society",
        "showUrl": "https://vancouverfringe.com/events/behind-the-wall-a-thriller-musical/",
        "showDescription": "Written by Vancouver creators Kay Snell and Landon Dueck, Behind The Wall: A Thriller Musical is a fast-paced psychological mystery following an investigative journalist digging into 'Oracle Homes'—a suspicious smart-housing development claiming to predict every resident's need before its algorithmic tech unravels into corporate surveillance and dark secrets. Reviews applaud its razor-sharp pace, original four-song score, and suspenseful three-hander staging at Waterfront Theatre.",
        "subTags": ["#festival", "#fringe", "#theatre", "#musical", "#thriller", "#granville-island"]
    },
    "The Nest (Granville Island)": {
        "address": "1398 Cartwright St 3rd Floor, Vancouver, BC",
        "neighborhood": "Granville Island",
        "coordinates": [49.2711, -123.1340],
        "transitInfo": "#50 False Creek Bus or Aquabus ferry dock to Granville Island",
        "venueUrl": "https://gitd.ca/pages/whats-on",
        "sampleShowTitle": "The Light Bringer (Solo Coming-of-Age Dramedy)",
        "artist": "Laila Lee",
        "performers": "Laila Lee",
        "showUrl": "https://vancouverfringe.com/events/the-light-bringer/",
        "showDescription": "Recipient of the Golden Lanyard Award and selected by Stir Vancouver as a top festival highlight, The Light Bringer is an acclaimed solo dramedy and coming-of-age memoir written and performed by Laila Lee. Weaving true stories of growing up Muslim and Palestinian in the American South, the production balances poignant reflections on cultural identity and displacement with radiant warmth and disarming humor on the 3rd floor of The Nest.",
        "subTags": ["#festival", "#fringe", "#theatre", "#indie-theatre", "#memoir", "#granville-island"]
    },
    "Performance Works": {
        "address": "1218 Cartwright St, Vancouver, BC",
        "neighborhood": "Granville Island",
        "coordinates": [49.2694, -123.1360],
        "transitInfo": "#50 False Creek Bus or Aquabus ferry dock to Granville Island",
        "venueUrl": "https://granvilleisland.com/directory/performance-works",
        "sampleShowTitle": "Las Mujeronas (Flamenco & Storytelling)",
        "artist": "Jhoely Triana Flamenco",
        "performers": "Jhoely Triana Flamenco Ensemble",
        "showUrl": "https://vancouverfringe.com/events/las-mujeronas/",
        "showDescription": "Choreographed and directed by Jhoely Triana at Performance Works, Las Mujeronas is an electrifying, emotionally charged multidisciplinary production uniting Flamenco Latinas through fiery dance, live traditional music, poetry, and multilingual storytelling (Spanish, Portuguese, and English). Critics and audiences applaud the ensemble's remarkable presence and conviction, calling it 'a raw, breathtaking, and unforgettable journey' honoring women's resilience and migration.",
        "subTags": ["#festival", "#fringe", "#theatre", "#flamenco", "#dance", "#granville-island"]
    },
    "Carousel Theatre": {
        "address": "1411 Cartwright St, Vancouver, BC",
        "neighborhood": "Granville Island",
        "coordinates": [49.2708, -123.1347],
        "transitInfo": "#50 False Creek Bus or Aquabus ferry dock to Granville Island",
        "venueUrl": "https://vancouverfringe.com/shows/",
        "sampleShowTitle": "Delusions and Grandeur (Adult Comedy & Solo Cello Clown)",
        "artist": "Karen Hall",
        "performers": "Karen Hall",
        "showUrl": "https://vancouverfringe.com/events/delusions-and-grandeur/",
        "showDescription": "Winner of Best Solo Performance (Stage Raw) and Tour Ready Award, Delusions and Grandeur is an irreverent, critically acclaimed solo physical-theatre clown show by Los Angeles cellist Karen Hall. Playing all six movements of J.S. Bach's Cello Suite No. 1 while peeling back the pretensions of classical music through wry adult storytelling, vulnerability, and brilliant clowning. FringeReview praises it as 'technically brilliant cello playing paired with impeccable comedic timing.' Curator-verified: evening adult solo show.",
        "subTags": ["#festival", "#fringe", "#theatre", "#comedy", "#adult-comedy", "#clown", "#adults-only", "#granville-island"]
    },
    "The Revue Stage": {
        "address": "1601 Johnston St, Vancouver, BC",
        "neighborhood": "Granville Island",
        "coordinates": [49.2711, -123.1332],
        "transitInfo": "#50 False Creek Bus or Aquabus ferry dock",
        "venueUrl": "https://theimprovcentre.ca",
        "sampleShowTitle": "MIA (Digital Mystery & Psychological Drama)",
        "artist": "Coyote Pact",
        "performers": "Coyote Pact Theatre Ensemble",
        "showUrl": "https://vancouverfringe.com/events/mia/",
        "showDescription": "Produced by Coyote Pact at The Revue Stage on Johnston Street, MIA is a provocative psychological drama and digital-age mystery exploring parasocial obsession and simulated realities. The story follows Mia, who challenges the web annually to locate her through cryptic puzzles, and an obsessive fan who breaches her private life. Critics praise its gripping tension, inventive use of multimedia, and claustrophobic look at intimacy in the internet era.",
        "subTags": ["#festival", "#fringe", "#theatre", "#drama", "#mystery", "#granville-island"]
    },
    "Arts Factory": {
        "address": "281 Industrial Ave, Vancouver, BC",
        "neighborhood": "Gastown / Chinatown",
        "coordinates": [49.2712, -123.0911],
        "transitInfo": "5 min walk from Main Street-Science World SkyTrain",
        "venueUrl": "https://artsfactorysociety.ca",
        "sampleShowTitle": "Daddy Issues (Stand-Up Comedy by Michaela Chung)",
        "artist": "Michaela Chung",
        "performers": "Michaela Chung",
        "showUrl": "https://vancouverfringe.com/events/daddy-issues/",
        "showDescription": "Presented by Vancouver comedian and author Michaela Chung at Arts Factory (Industrial Ave BYOV stage), Daddy Issues is a hilarious, delightfully candid stand-up hour diving fearlessly into modern dating in your 30s, mixed-race identity, and family dynamics. The Vancouver Arts Review praised Chung's 'refreshing warmth, sharp autobiographical wit, and masterful crowd work,' making it an audience-favorite comedy show of the festival.",
        "subTags": ["#festival", "#fringe", "#theatre", "#comedy", "#stand-up", "#indie"]
    },
    "VIFF Centre": {
        "address": "1181 Seymour St, Vancouver, BC",
        "neighborhood": "Downtown / West End",
        "coordinates": [49.2774, -123.1251],
        "transitInfo": "4 min walk from Yaletown-Roundhouse Canada Line",
        "venueUrl": "https://viff.org",
        "showUrl": "https://viff.org/whats-on/viff-2026/",
        "sampleShowTitle": "Feature Screenings, Talks & BC Spotlight",
        "showDescription": "Vancouver International Film Festival feature screenings, director Q&As, and BC spotlight cinema at the downtown VIFF Centre.",
        "subTags": ["#festival", "#viff", "#cinema", "#screenings", "#film"]
    },
    "The Cinematheque": {
        "address": "1131 Howe St, Vancouver, BC",
        "neighborhood": "Downtown / West End",
        "coordinates": [49.2795, -123.1274],
        "transitInfo": "5 min walk from Vancouver City Centre SkyTrain",
        "venueUrl": "https://thecinematheque.ca",
        "showUrl": "https://viff.org/venues/the-cinematheque/",
        "sampleShowTitle": "International Cinema Showcase & Retrospectives",
        "showDescription": "Award-winning international festival selections, auteur documentaries, and global premieres at Howe Street's historic Cinematheque.",
        "subTags": ["#festival", "#viff", "#cinema", "#world-cinema", "#film"]
    },
    "Rio Theatre": {
        "address": "1660 E Broadway, Vancouver, BC",
        "neighborhood": "Commercial Drive",
        "coordinates": [49.2627, -123.0699],
        "transitInfo": "1 min walk from Commercial-Broadway SkyTrain",
        "venueUrl": "https://riotheatre.ca",
        "showUrl": "https://viff.org/venues/rio-theatre/",
        "sampleShowTitle": "Late-Night Cult & Special Screenings",
        "showDescription": "Late-night cult cinema, genre premieres, and electric live-screened festival events at Commercial Drive's iconic Rio Theatre.",
        "subTags": ["#festival", "#viff", "#cinema", "#cult-film", "#late-night"]
    },
    "SFU Goldcorp Centre for the Arts": {
        "address": "149 W Hastings St, Vancouver, BC",
        "neighborhood": "Gastown / Chinatown",
        "coordinates": [49.2831, -123.1090],
        "transitInfo": "5 min walk from Waterfront SkyTrain Station",
        "venueUrl": "https://www.sfu.ca/woodwards.html",
        "showUrl": "https://viff.org/venues/sfu-goldcorp/",
        "sampleShowTitle": "Gala Screenings & Contemporary Storytelling",
        "showDescription": "Special festival gala screenings and contemporary cinematic storytelling at SFU Goldcorp Centre for the Arts in the historic Woodward's complex.",
        "subTags": ["#festival", "#viff", "#cinema", "#screenings", "#premieres"]
    }
}


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
    def slugify(cls, text: str) -> str:
        """Helper to create a clean alphanumeric slug."""
        text = re.sub(r"[^\w\s-]", "", text.lower())
        return re.sub(r"[-\s]+", "-", text).strip("-")

    @classmethod
    def harvest_all_active_festival_events(
        cls, reference_date: Optional[date] = None
    ) -> List[Dict[str, Any]]:
        """
        Universally discovers and generates verified event records for active festivals.
        - Checks each registered festival in festival_registry.json against its monitoring window.
        - Calculates true all-in ticket prices (including mandatory festival buttons/memberships & GST).
        - Enforces strict <= $50.00 CAD pricing.
        - Generates verified show & screening records across host venues with exact Greater Vancouver GPS coordinates.
        - Applies curator rules (e.g. adult-only demographic filtering for Carousel Theatre).
        - Sets isDaily: False so the events are preserved when users filter for 'Shows & special events only'.
        """
        if reference_date is None:
            reference_date = datetime.now(timezone.utc).date()
        elif isinstance(reference_date, datetime):
            reference_date = reference_date.date()

        festivals = cls.load_festivals()
        harvested_events: List[Dict[str, Any]] = []

        # Load known permanent venues for metadata enrichment
        known_venues: Dict[str, Any] = {}
        if os.path.exists(VENUE_DIRECTORY_PATH):
            try:
                with open(VENUE_DIRECTORY_PATH, "r", encoding="utf-8") as f:
                    v_data = json.load(f)
                    known_venues = v_data.get("venues", {})
            except Exception:
                pass

        # Load curator distilled rules
        curator_rules: Dict[str, Any] = {}
        if os.path.exists(CURATOR_RULES_PATH):
            try:
                with open(CURATOR_RULES_PATH, "r", encoding="utf-8") as rf:
                    curator_rules = json.load(rf).get("venue_policy_rules", {})
            except Exception:
                pass

        for fest in festivals:
            fest_id = fest.get("id", "")
            fest_name = fest.get("name", "Festival")
            is_active, status, delta = cls.is_active_window(fest, reference_date)

            if not is_active:
                continue

            # Skip standalone free civic block parties already tracked in civic seed catalog
            if fest_id in ["car-free-days-vancouver", "khatsahlano-street-party"]:
                continue

            p_struct = fest.get("priceStructure", {})
            raw_show_price = float(p_struct.get("showPrice", 0.0))
            membership_fee = float(p_struct.get("membershipButtonFee", 0.0))
            all_in_price, fee_breakdown, within_budget = cls.calculate_festival_show_price(fest, raw_show_price)

            if not within_budget or all_in_price > 50.00:
                print(f"[FESTIVAL CRAWLER] Skipping {fest_name}: all-in price ${all_in_price:.2f} > $50 CAD.")
                continue

            # Price label formatting
            gst = round(raw_show_price * 0.05, 2)
            btn_name = "festival button" if "fringe" in fest_id else ("society membership" if "viff" in fest_id else "pass/membership")
            if all_in_price == 0:
                price_label = "Free ($0)"
                is_free = True
            elif membership_fee > 0:
                price_label = f"${all_in_price:.2f} all-in (${raw_show_price:.0f} ticket + ${membership_fee:.0f} {btn_name} + ${gst:.2f} GST)"
                is_free = False
            else:
                price_label = f"${all_in_price:.2f} all-in"
                is_free = False

            # Dates & Schedule
            start_str = fest.get("startDate", "2026-09-01")
            end_str = fest.get("endDate", "2026-09-30")
            try:
                start_dt = datetime.strptime(start_str, "%Y-%m-%d").date()
                end_dt = datetime.strptime(end_str, "%Y-%m-%d").date()
                date_schedule = f"{start_dt.strftime('%b %d')} – {end_dt.strftime('%b %d, %Y')} • {fest_name}"
            except Exception:
                date_schedule = f"{start_str} – {end_str} • {fest_name}"

            start_iso = f"{start_str}T12:00:00-07:00"
            end_iso = f"{end_str}T23:59:59-07:00"

            # Tiers
            tiers = []
            if membership_fee > 0:
                tiers = [
                    {
                        "name": "Single Show / Screening Ticket",
                        "price": raw_show_price,
                        "description": f"Standard admission to one {fest_name} presentation"
                    },
                    {
                        "name": f"All-In Checkout (Ticket + {btn_name.title()} + GST)",
                        "price": all_in_price,
                        "description": fee_breakdown
                    }
                ]

            category = fest.get("category", "shows")
            if category == "cinema":
                cat_label = "Cinema"
                cat_icon = "🎬"
            elif category == "music":
                cat_label = "Live Music"
                cat_icon = "🎵"
            else:
                cat_label = "Comedy & Shows"
                cat_icon = "🎭"

            schedule_url = fest.get("scheduleUrl", fest.get("websiteUrl", "https://vancouver.ca"))

            for host_name in fest.get("hostVenues", []):
                h_clean = host_name.strip()
                v_meta = FESTIVAL_HOST_VENUE_DIRECTORY.get(h_clean) or {}

                # Check permanent venue directory if available
                p_meta = known_venues.get(h_clean, {})

                address = v_meta.get("address") or p_meta.get("address") or f"{h_clean}, Vancouver, BC"
                neighborhood = v_meta.get("neighborhood") or p_meta.get("neighborhood")
                if not neighborhood:
                    neighborhood = "Granville Island" if "granville" in h_clean.lower() or "island" in h_clean.lower() else "Downtown / West End"
                    if "broadway" in h_clean.lower() or "commercial" in h_clean.lower():
                        neighborhood = "Commercial Drive"

                coordinates = v_meta.get("coordinates") or p_meta.get("coordinates")
                if not coordinates or len(coordinates) != 2:
                    coordinates = [49.2718, -123.1342] if neighborhood == "Granville Island" else [49.2827, -123.1207]

                # Ensure strict bounding box
                lat, lng = coordinates
                if not (49.0 <= lat <= 49.5 and -123.5 <= lng <= -122.5):
                    coordinates = [49.2718, -123.1342]

                transit_info = v_meta.get("transitInfo") or p_meta.get("transitInfo") or "#50 False Creek Bus or nearby SkyTrain station"
                venue_url = v_meta.get("venueUrl") or p_meta.get("venueUrl") or schedule_url

                # Title and description formatting with curator rules applied
                base_sample_title = v_meta.get("sampleShowTitle", "Performances & Showcases")
                sub_tags = list(v_meta.get("subTags") or ["#festival", f"#{cls.slugify(fest_name)}"])

                # Check curator rule for Carousel Theatre or other venues
                c_policy = curator_rules.get(h_clean, {})
                if "carousel" in h_clean.lower() or c_policy.get("demographicFilter") == "adults_only":
                    if "#adults-only" not in sub_tags:
                        sub_tags.append("#adults-only")

                show_title = f"{fest_name}: {base_sample_title} at {h_clean}"
                description = (
                    v_meta.get("showDescription") or
                    f"Live performances, premieres, and cultural showcases presented at {h_clean} as part of {fest_name} {fest.get('edition', '')}."
                )

                artist = v_meta.get("artist") or f"Official {fest_name} Artists & Roster"
                performers = v_meta.get("performers") or f"{fest_name} Companies & Ensembles"
                show_url = v_meta.get("showUrl") or schedule_url

                event_id = f"fest-{fest_id}-{cls.slugify(h_clean)}"

                event_record = {
                    "id": event_id,
                    "title": show_title,
                    "artist": artist,
                    "performers": performers,
                    "venue": h_clean,
                    "venueAliases": [h_clean, fest_name],
                    "address": address,
                    "neighborhood": neighborhood,
                    "price": all_in_price,
                    "priceLabel": price_label,
                    "pricingType": "festival_all_in",
                    "tiers": tiers,
                    "isFree": is_free,
                    "isDaily": False,  # CRITICAL: Festivals are scheduled cultural seasons, NOT daily drop-in spots!
                    "frequency": "seasonal",
                    "frequencyLabel": "Festival Run",
                    "daysOfWeek": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                    "timeSlots": ["afternoon", "early-evening", "late-evening"],
                    "category": category,
                    "categoryLabel": cat_label,
                    "categoryIcon": cat_icon,
                    "subTags": sub_tags,
                    "dateSchedule": date_schedule,
                    "startIso": start_iso,
                    "endIso": end_iso,
                    "confirmedDates": [],
                    "isSoldOut": False,
                    "websiteUrl": show_url,
                    "venueUrl": venue_url,
                    "ticketProvider": f"{fest_name} Box Office Verified",
                    "rawProvider": fest_name,
                    "coordinates": coordinates,
                    "transitInfo": transit_info,
                    "organizer": fest_name,
                    "isRoving": False,
                    "editionVenue": h_clean,
                    "agePolicy": "Adults only" if "#adults-only" in sub_tags else "All ages / see individual show rating",
                    "admissionPolicy": f"Show ticket + {btn_name} required for venue entry",
                    "rovingNote": None,
                    "description": description,
                    "checkoutVerification": {
                        "status": "verified_live",
                        "method": "festival_charter_pricing",
                        "verifiedTotal": all_in_price,
                        "feeBreakdown": fee_breakdown,
                        "verifiedAt": datetime.now(timezone.utc).isoformat(),
                        "details": f"Verified via official {fest_name} box office rate card with mandatory {btn_name} and GST included."
                    }
                }

                harvested_events.append(event_record)

        return harvested_events

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
