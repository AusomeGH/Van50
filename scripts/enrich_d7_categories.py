#!/usr/bin/env python3
"""
scripts/enrich_d7_categories.py
================================
Enriches D7 (Taxonomy & Categorization Standard) across all catalog events:
1. Assigns granular semantic backend categories without displaying them as top-level UI buttons.
2. Invariant: Every event belongs to >= 1 category, with no upper limit on the maximum.
3. Updates dimension_audit.dimensions.D7_category with primary_category, categories, and category_count.
4. Synchronizes data/events.json and js/data.js.
"""

import os
import sys
import json
import re
from datetime import datetime, timezone, timedelta

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")

PACIFIC_TZ = timezone(timedelta(hours=-7))
CURRENT_TIMESTAMP = datetime.now(PACIFIC_TZ).isoformat()


def map_categories_for_event(ev: dict) -> tuple[str, list[str]]:
    title = (ev.get("title") or ev.get("event_name") or "").lower()
    venue = (ev.get("venue_name") or ev.get("venue") or "").lower()
    desc = (ev.get("description") or "").lower()
    raw_cat = (ev.get("category") or "").lower()
    tags = [t.lower() for t in (ev.get("tags") or [])]
    tag_str = " ".join(tags)
    combined = f"{raw_cat} {tag_str} {title} {venue} {desc}"

    is_free = bool(ev.get("isFree") or ev.get("price", 0) == 0 or raw_cat == "free public access")
    is_perennial = ev.get("lifecycle_type") == "perennial_drop_in" or ev.get("access_model") == "open_public_space"

    cats = set()

    # 1. Free Public Access
    if is_free and (raw_cat == "free public access" or is_perennial or "free-public-access" in tags or "free-admission" in tags):
        cats.add("free_public_access")

    # 2. Films & Screenings
    if any(k in combined for k in ["cinema", "film", "screening", "35mm", "movie", "cinematheque", "viff", "rio theatre", "film-screening", "kwaidan", "pulse", "ski film"]):
        if not ("comedy" in tags and not "screening" in title):
            cats.add("films_screenings")

    # 3. Comedy, Stand-up & Improv
    if any(k in combined for k in ["comedy", "improv", "stand-up", "standup", "open mic comedy", "tightrope", "improv centre", "comedy department", "joke"]):
        cats.add("comedy_standup_improv")

    # 4. Theatre & Performing Arts
    if any(k in combined for k in ["theatre", "theater", "stage play", "musical", "burlesque", "cabaret", "drama", "opera", "monologue", "fringe"]):
        cats.add("theatre_performing_arts")

    # 5. Live Music & Concerts
    if any(k in combined for k in ["live music", "concert", "gig", "band", "jazz", "acoustic", "orchestra", "symphony", "vso", "blues", "folk", "indie rock", "metal", "punk", "choir"]):
        cats.add("live_music_concerts")

    # 6. Dance Parties & Club Nights
    if any(k in combined for k in ["dance party", "club night", "dj", "techno", "house music", "disco", "electronic", "nightlife", "rave", "groove"]):
        cats.add("dance_parties_club_nights")

    # 7. Visual Arts & Galleries
    if any(k in combined for k in ["art gallery", "art exhibit", "contemporary art", "visual art", "sculpture", "painting", "photography", "pendulum gallery", "vancouver art gallery", "arts umbrella"]):
        cats.add("visual_arts_galleries")

    # 8. Workshops, Classes & Crafts
    if any(k in combined for k in ["workshop", "class", "craft", "pottery", "ceramics", "linocut", "drawing", "life drawing", "figure drawing", "sketching", "learn", "maker"]):
        cats.add("workshops_classes_crafts")

    # 9. Trivia, Games & Board Games
    if any(k in combined for k in ["trivia", "board game", "chess", "quiz", "game night", "arcade"]):
        cats.add("trivia_games_boardgames")

    # 10. Food, Drink & Tastings
    if any(k in combined for k in ["tasting", "beer", "brewery", "wine", "cider", "crawl", "croissant crawl", "food crawl", "harvest tasting"]):
        cats.add("food_drink_tastings")

    # 11. Markets, Popups & Bazaars
    if any(k in combined for k in ["market", "popup", "pop-up", "bazaar", "artisan market", "flea market", "craft fair", "farmers market"]):
        cats.add("markets_popups_bazaars")

    # 12. Tours, Walks & Heritage
    if any(k in combined for k in ["walking tour", "heritage loop", "historical tour", "architecture walk", "guided walk"]):
        cats.add("tours_walks_heritage")

    # 13. Sports, Fitness & Recreation
    if any(k in combined for k in ["pitch & putt", "golf", "skating", "fitness", "yoga", "running", "soccer", "trail", "cycling", "recreation"]):
        cats.add("sports_fitness_recreation")

    # 14. Nature, Parks & Gardens
    if any(k in combined for k in ["park", "garden", "botanical", "seawall", "beach", "stanley park", "queen elizabeth park", "bloedel", "vandusen", "quarry gardens"]):
        cats.add("nature_parks_gardens")

    # 15. Literary, Spoken Word & Poetry
    if any(k in combined for k in ["poetry", "spoken word", "book launch", "reading", "author", "storytelling"]):
        cats.add("literary_spoken_word_poetry")

    # 16. Community, Civic & Social
    if any(k in combined for k in ["community", "civic", "social", "meetup", "gathering", "volunteer", "atrium"]):
        cats.add("community_civic_social")

    # 17. Festivals & Celebrations
    if ev.get("festival_affiliation") and ev.get("festival_affiliation") != "None":
        cats.add("festivals_celebrations")
    elif any(k in combined for k in ["festival", "fest", "celebration", "parade", "carnival"]):
        cats.add("festivals_celebrations")

    # 18. Family & Youth Activities
    if any(k in combined for k in ["all-ages", "family", "kids", "children", "miniature train", "youth"]):
        cats.add("family_youth_activities")

    # Determine canonical primary category for public UI display (one of the 8 clean tabs)
    primary = "shows"
    if "free_public_access" in cats and (is_perennial or is_free):
        primary = "free-public-access"
    elif "festivals_celebrations" in cats:
        primary = "festivals"
    elif "films_screenings" in cats:
        primary = "cinema"
    elif "live_music_concerts" in cats or "dance_parties_club_nights" in cats:
        primary = "music"
    elif "comedy_standup_improv" in cats or "theatre_performing_arts" in cats:
        primary = "shows"
    elif "markets_popups_bazaars" in cats:
        primary = "markets"
    elif "nature_parks_gardens" in cats or "sports_fitness_recreation" in cats:
        primary = "outdoors"
    elif "visual_arts_galleries" in cats or "workshops_classes_crafts" in cats or "trivia_games_boardgames" in cats:
        primary = "social"

    # Always add primary to categories set so it aligns with frontend tabs
    cats.add(primary)

    # Invariant: At least 1 category
    if len(cats) == 0:
        cats.add("shows")

    cat_list = sorted(list(cats))
    return primary, cat_list


def main():
    print("=== Enriching D7 Categories across events.json ===")
    if not os.path.exists(EVENTS_PATH):
        print(f"Error: {EVENTS_PATH} not found.")
        sys.exit(1)

    with open(EVENTS_PATH, "r", encoding="utf-8") as f:
        events = json.load(f)

    print(f"Loaded {len(events)} events.")

    category_distribution = {}
    multi_category_counts = []

    for ev in events:
        primary_cat, all_cats = map_categories_for_event(ev)

        # Invariant verification
        assert len(all_cats) >= 1, f"Event {ev.get('event_id')} has 0 categories!"

        # Attach to root
        ev["primary_category"] = primary_cat
        ev["categories"] = all_cats
        ev["category_count"] = len(all_cats)

        # Update dimension audit D7
        if "dimension_audit" not in ev:
            ev["dimension_audit"] = {}
        if "dimensions" not in ev["dimension_audit"]:
            ev["dimension_audit"]["dimensions"] = {}

        dims = ev["dimension_audit"]["dimensions"]
        dims["D7_category"] = {
            "status": "verified",
            "primary_category": primary_cat,
            "categories": all_cats,
            "category_count": len(all_cats),
            "backend_categories": [c for c in all_cats if c != primary_cat],
            "confirmed_at": CURRENT_TIMESTAMP
        }

        # Track stats
        multi_category_counts.append(len(all_cats))
        for c in all_cats:
            category_distribution[c] = category_distribution.get(c, 0) + 1

    with open(EVENTS_PATH, "w", encoding="utf-8") as f:
        json.dump(events, f, indent=2, ensure_ascii=False)

    print(f"✅ Successfully updated {len(events)} events with multi-category D7 standard.")
    print(f"Category count per event: min={min(multi_category_counts)}, max={max(multi_category_counts)}, avg={sum(multi_category_counts)/len(multi_category_counts):.1f}")
    print("\nCategory Distribution across catalog:")
    for cat_name, count in sorted(category_distribution.items(), key=lambda x: x[1], reverse=True):
        print(f"  - {cat_name}: {count} events")

    # Sync js/data.js
    sync_script = os.path.join(BASE_DIR, "scripts", "sync_data_js.py")
    if os.path.exists(sync_script):
        import subprocess
        subprocess.run([sys.executable, sync_script], check=True)
        print("✅ js/data.js synchronized.")


if __name__ == "__main__":
    main()
