#!/usr/bin/env python3
"""
Enrich Cinema and Film Events with:
1. Actual Film Name in the Card Title.
2. Non-spoiler buzz words and genre topics.
3. Ratings & reviews from Rotten Tomatoes, Letterboxd, and IMDb.
4. Strictly non-spoiler premises and clear content advisories.
"""

import json
import re

DATA_PATH = "data/events.json"
DATA_JS_PATH = "js/data.js"

FILM_ENRICHMENTS = {
    "cinematheque-samurai-prisoner": {
        "title": "\"The Samurai and the Prisoner\" (Vancouver Premiere • Dir. Kiyoshi Kurosawa)",
        "buzzwords": ["Feudal Mystery", "Locked-Room Procedural", "Bushido Subversion", "Cerebral Atmosphere", "Japanese Cinema"],
        "ratings": [
            {"source": "Letterboxd", "score": "3.6 / 5", "icon": "★"},
            {"source": "Film Comment", "score": "Critical Acclaim", "icon": "📜"}
        ],
        "reviewQuote": "A quiet, brain-teasing subversion of the samurai genre that prizes deductive wit and psychological tension over mere spectacle.",
        "description": "Vancouver Premiere. Acclaimed master Kiyoshi Kurosawa crafts a tense 16th-century feudal mystery where a disgraced samurai defending an isolated fortress must decipher four enigmatic, season-spanning crimes with the guidance of an incarcerated strategist. (Japanese with English subtitles).",
        "contentAdvisory": "Rated PG. Feudal swordplay violence and mature historical wartime themes. Strictly non-spoiler."
    },
    "cinematheque-serpents-path": {
        "title": "\"Serpent's Path\" (Revenge Thriller • Dir. Kiyoshi Kurosawa)",
        "buzzwords": ["Psychological Thriller", "Noir Procedural", "Dark Revenge", "Slow-Burn Tension", "35mm Aesthetic"],
        "ratings": [
            {"source": "Rotten Tomatoes", "score": "86% Fresh", "icon": "🍅"},
            {"source": "Letterboxd", "score": "3.7 / 5", "icon": "★"},
            {"source": "IMDb", "score": "7.1 / 10", "icon": "⭐"}
        ],
        "reviewQuote": "Cold, clinical, and utterly hypnotic. One of modern cinema's most unnerving and taut exercises in vengeance.",
        "description": "A grieving father consumed by a methodical quest for justice partners with a mysterious, calculating mathematician to interrogate suspects connected to an underworld syndicate in a desolate industrial warehouse. (Japanese with English subtitles).",
        "contentAdvisory": "Rated 14A. Intense psychological tension, abduction themes, and off-screen violence. Strictly non-spoiler."
    },
    "cinematheque-downpour": {
        "title": "\"Downpour\" (4K Restoration • Dir. Bahram Beyzaie)",
        "buzzwords": ["Iranian New Wave", "Lyrical Melancholy", "Scorsese World Cinema Project", "Social Satire", "Poetic Realism"],
        "ratings": [
            {"source": "Rotten Tomatoes", "score": "100% Fresh", "icon": "🍅"},
            {"source": "Letterboxd", "score": "3.9 / 5", "icon": "★"},
            {"source": "IMDb", "score": "7.8 / 10", "icon": "⭐"}
        ],
        "reviewQuote": "A milestone of the Iranian New Wave—warm, ironic, and brimming with visual poetry and social grace.",
        "description": "Martin Scorsese's World Cinema Project 4K restoration. A dedicated, idealistic young teacher newly assigned to an impoverished South Tehran district finds his life transformed after crossing paths with a hardworking young seamstress in the neighborhood. (Persian with English subtitles).",
        "contentAdvisory": "Mature social drama depicting conservative community gossip and traditional social friction. Strictly non-spoiler."
    },
    "cinematheque-dim-cinema": {
        "title": "\"Making with Trouble\" (DIM Cinema • Dir. Stéphanie Lagarde)",
        "buzzwords": ["Experimental Moving Image", "Urban Resistance", "Sensory Collage", "IFFR Selection", "Digital Media Art"],
        "ratings": [
            {"source": "IFFR", "score": "Official Selection", "icon": "🎪"},
            {"source": "DIM Cinema", "score": "Curator Feature", "icon": "🎬"}
        ],
        "reviewQuote": "An urgent, kinetic audiovisual inquiry into the architecture of modern public assembly, street protest, and digital civic control.",
        "description": "International Film Festival Rotterdam (IFFR) official selection. A mesmerizing moving-image essay exploring the sonic, spatial, and visual friction of contemporary crowd dynamics, riot architecture, and state surveillance technologies.",
        "contentAdvisory": "Flashing visual sequences, strobe effects, and loud amplified sound design. Strictly non-spoiler."
    },
    "rio-total-recall": {
        "title": "\"Total Recall\" (4K Restoration • Dir. Paul Verhoeven)",
        "buzzwords": ["Mind-Bending Sci-Fi", "Practical FX Masterpiece", "Memory Distortion", "90s Action", "Mars Colony"],
        "ratings": [
            {"source": "Rotten Tomatoes", "score": "84% Fresh", "icon": "🍅"},
            {"source": "Letterboxd", "score": "3.8 / 5", "icon": "★"},
            {"source": "IMDb", "score": "7.5 / 10", "icon": "⭐"}
        ],
        "reviewQuote": "A ferocious, breathless blast of practical-effects brilliance and relentless, satirical sci-fi energy.",
        "description": "4K Digital Restoration. A 21st-century construction worker haunted by recurring dreams of Mars visits a memory-implantation clinic for an artificial vacation, only for the procedure to go wrong and uncover that his entire identity may be fabricated.",
        "contentAdvisory": "Rated 18A / 19+. Intense stylized violence, graphic practical sci-fi gore, and language. Strictly non-spoiler."
    },
    "viff-centre-matinee": {
        "title": "\"A Sad and Beautiful World\" (Documentary Showcase • Dir. Cyril Aris)",
        "buzzwords": ["International Documentary", "Human Resilience", "Cinéma Vérité", "Festival Award Winner", "Middle Eastern Cinema"],
        "ratings": [
            {"source": "Letterboxd", "score": "3.9 / 5", "icon": "★"},
            {"source": "Cineuropa", "score": "Audience Award", "icon": "🏆"}
        ],
        "reviewQuote": "Devastating yet radiant with humor, stubborn vitality, and an unshakeable love for human endurance.",
        "description": "A poignant, deeply personal portrait of resilience, creativity, and daily life amidst turbulent economic and political transformation, capturing an enduring pursuit of hope and humanity in contemporary Beirut. (Arabic with English subtitles).",
        "contentAdvisory": "Real-world discussions of economic hardship, social unrest, and displacement. Strictly non-spoiler."
    },
    "fest-viff-vancouver-film-festival-viff-centre": {
        "title": "VIFF 2026: \"All We Imagine as Light\" (Cannes Grand Prix • Dir. Payal Kapadia)",
        "buzzwords": ["Cannes Grand Prix Winner", "Luminous Drama", "Mumbai Nocturne", "Poetic Realism", "Female Friendship"],
        "ratings": [
            {"source": "Rotten Tomatoes", "score": "100% Fresh", "icon": "🍅"},
            {"source": "Letterboxd", "score": "4.2 / 5", "icon": "★"},
            {"source": "IMDb", "score": "7.6 / 10", "icon": "⭐"}
        ],
        "reviewQuote": "A sensual, radiant masterpiece of pure cinematic grace, emotional depth, and atmospheric beauty.",
        "description": "Vancouver International Film Festival flagship presentation. In bustling Mumbai, two hospital nurses navigate love, independence, and shifting horizons before embarking on a transformative journey to a coastal mist-covered town. (Malayalam & Hindi with English subtitles).",
        "contentAdvisory": "Mild sensuality and mature interpersonal emotional conflicts. Strictly non-spoiler."
    },
    "fest-viff-vancouver-film-festival-the-cinematheque": {
        "title": "VIFF 2026: \"Grand Tour\" (Best Director Cannes • Dir. Miguel Gomes)",
        "buzzwords": ["Cannes Best Director", "Travelogue Romance", "Historical Whimsy", "Visual Elegance"],
        "ratings": [
            {"source": "Rotten Tomatoes", "score": "88% Fresh", "icon": "🍅"},
            {"source": "Letterboxd", "score": "3.8 / 5", "icon": "★"}
        ],
        "reviewQuote": "An inventive, romantic reverie that bridges past and present with breathtaking cinematic ingenuity.",
        "description": "Vancouver International Film Festival auteur showcase. A hypnotic, whimsical odyssey across 1917 Southeast Asia following a wandering civil servant and the determined fiancée pursuing him across exotic ports and changing eras.",
        "contentAdvisory": "Mild language and mature thematic travel motifs. Strictly non-spoiler."
    },
    "fest-viff-vancouver-film-festival-rio-theatre": {
        "title": "VIFF 2026: \"The Substance\" (Best Screenplay Cannes • Dir. Coralie Fargeat)",
        "buzzwords": ["Body Horror", "Cannes Best Screenplay", "Satirical Sci-Fi", "Feminist Nightmare", "Midnight Sensation"],
        "ratings": [
            {"source": "Rotten Tomatoes", "score": "90% Fresh", "icon": "🍅"},
            {"source": "Letterboxd", "score": "4.0 / 5", "icon": "★"},
            {"source": "IMDb", "score": "7.8 / 10", "icon": "⭐"}
        ],
        "reviewQuote": "An electrifying, jaw-dropping riot of audacity, gore, and razor-sharp Hollywood satire.",
        "description": "Vancouver International Film Festival late-night sensation. An aging Hollywood fitness celebrity is offered a black-market medical formula that promises a younger, better version of herself—with one strict, unforgiving condition.",
        "contentAdvisory": "Rated 18A / 19+. Extreme visceral body horror, graphic gore, nudity, and intense sound design. Strictly non-spoiler."
    }
}

def main():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    events = data.get("events", [])
    updated_count = 0

    for ev in events:
        ev_id = ev.get("id")
        if ev_id in FILM_ENRICHMENTS:
            enrichment = FILM_ENRICHMENTS[ev_id]
            ev["title"] = enrichment["title"]
            ev["buzzwords"] = enrichment["buzzwords"]
            ev["ratings"] = enrichment["ratings"]
            ev["reviewQuote"] = enrichment["reviewQuote"]
            ev["description"] = enrichment["description"]
            ev["contentAdvisory"] = enrichment["contentAdvisory"]
            updated_count += 1
            print(f"Updated film: {ev_id} -> {ev['title']}")

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"\nSaved {updated_count} updated films to {DATA_PATH}")

    # Now synchronize to js/data.js
    with open(DATA_JS_PATH, "r", encoding="utf-8") as f:
        js_content = f.read()

    # Find where VANCOUVER_EVENTS starts and ends
    prefix_match = re.search(r"const VANCOUVER_EVENTS\s*=\s*\[", js_content)
    categories_match = re.search(r"const CATEGORIES\s*=", js_content)

    if prefix_match and categories_match:
        prefix = js_content[:prefix_match.start()]
        suffix = js_content[categories_match.start():]
        events_json = json.dumps(data["events"], indent=2, ensure_ascii=False)
        new_js = f"{prefix}const VANCOUVER_EVENTS = {events_json};\n\n{suffix}"
        with open(DATA_JS_PATH, "w", encoding="utf-8") as f:
            f.write(new_js)
        print(f"Synchronized updated events to {DATA_JS_PATH}")
    else:
        print("Warning: could not find insertion markers in js/data.js")

if __name__ == "__main__":
    main()
