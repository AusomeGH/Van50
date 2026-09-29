import json

KNOWN_VENUE_WEBSITES = {
    "Hero's Welcome": "https://heros-welcome.com/",
    "Village Studios": "https://villagestudios.life/",
    "Celebrities Night Club": "https://celebritiesnightclub.com/",
    "Celebrities Nightclub": "https://celebritiesnightclub.com/",
    "The American": "https://theamerican.bar/",
    "Bleach Listening Room": "https://bleachstudios.xyz/",
    "The Lido": "https://ra.co/clubs/107753",
    "Platform9": "https://ra.co/clubs/207030",
    "Fortune Sound Club": "https://fortunesoundclub.com/",
    "The Pearl": "https://thepearlvancouver.com/",
    "The Birdhouse": "https://thebirdhouse.ca/",
    "The Red Room": "https://redroomvancouver.com/",
    "The Rickshaw Theatre": "https://rickshawtheatre.com/",
    "The Fox Cabaret": "https://www.foxcabaret.com/",
    "The Biltmore Cabaret": "https://biltmorecabaret.com/",
    "33 Acres Brewing Company": "https://33acresbrewing.com/",
}

# Update data/events.json
with open('data/events.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

events = data['events'] if isinstance(data, dict) and 'events' in data else data
updated_count = 0

for ev in events:
    v_url = ev.get('venueUrl', '')
    venue_name = ev.get('venue', '')
    if 'ra.co/events/' in v_url or 'residentadvisor.net/events/' in v_url:
        new_url = KNOWN_VENUE_WEBSITES.get(venue_name)
        if not new_url:
            for k, val in KNOWN_VENUE_WEBSITES.items():
                if k.lower() in venue_name.lower() or venue_name.lower() in k.lower():
                    new_url = val
                    break
        if new_url:
            print(f"Updating '{ev['id']}' ({venue_name}): {v_url} -> {new_url}")
            ev['venueUrl'] = new_url
            updated_count += 1
        else:
            print(f"WARNING: No venue URL found for {venue_name} ({ev['id']})")

with open('data/events.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"Updated {updated_count} events in data/events.json")

# Synchronize to js/data.js
with open('js/data.js', 'r', encoding='utf-8') as f:
    js_text = f.read()

# Update the events array in js/data.js
prefix = "const VANCOUVER_EVENTS = "
start_idx = js_text.find(prefix)
if start_idx != -1:
    end_idx = js_text.find(";\n\n// Direct Venue Official URLs Dictionary", start_idx)
    if end_idx == -1:
        end_idx = js_text.find(";\nconst VENUE_URLS =", start_idx)
    if end_idx != -1:
        new_events_json = json.dumps(events, indent=2, ensure_ascii=False)
        js_text = js_text[:start_idx + len(prefix)] + new_events_json + js_text[end_idx:]
        print("Updated VANCOUVER_EVENTS in js/data.js")

with open('js/data.js', 'w', encoding='utf-8') as f:
    f.write(js_text)
