import re
import json

# 1. Check CATEGORIES in js/data.js
with open("js/data.js", "r", encoding="utf-8") as f:
    data_content = f.read()

m = re.search(r"const CATEGORIES = (\[.*?\]);", data_content, re.DOTALL)
assert m, "CATEGORIES not found in js/data.js"
categories_json = re.sub(r",\s*]", "]", m.group(1))
# Replace JS object property names without quotes if any
categories_json = re.sub(r'(\b[a-zA-Z0-9_]+\b):', r'"\1":', categories_json)
print("CATEGORIES definition in js/data.js:")
print(categories_json)

# 2. Check CATEGORIES in js/app.js
with open("js/app.js", "r", encoding="utf-8") as f:
    app_content = f.read()

assert '{ id: "music", label: "Music", icon: "🎵" }' in app_content, "Music label not updated in js/app.js"
assert '{ id: "shows", label: "Comedy & Stage", icon: "🎭" }' in app_content, "Comedy & Stage not in js/app.js"

# 3. Check events in data/events.json
with open("data/events.json", "r", encoding="utf-8") as f:
    events = json.load(f)

cheap_thrills = next((e for e in events if e.get("title") == "Cheap Thrills Dance Party" or e.get("event_name") == "Cheap Thrills Dance Party"), None)
assert cheap_thrills, "Cheap Thrills Dance Party not found"
print("Cheap Thrills in events.json:")
print("  Category:", cheap_thrills.get("category"))
print("  Tags:", cheap_thrills.get("tags"))

dance_90s = next((e for e in events if "00s vs 10s" in (e.get("title") or e.get("event_name") or "")), None)
assert dance_90s, "00s vs 10s Party not found"
print("00s vs 10s Party in events.json:")
print("  Category:", dance_90s.get("category"))
print("  Tags:", dance_90s.get("tags"))

# 4. Test filtering logic replication
def classify_event(item):
    cat_raw = str(item.get("category", "shows")).lower()
    tags_str = " ".join([str(t) for t in (item.get("tags") or [])]).lower()
    title_lower = str(item.get("title") or item.get("event_name") or "").lower()
    venue_lower = str(item.get("venue_name") or item.get("venue") or "").lower()
    desc_lower = str(item.get("description") or "").lower()
    combined_context = f"{cat_raw} {tags_str} {title_lower} {venue_lower} {desc_lower}"
    
    is_music = (
        ("music" in cat_raw) or
        bool(re.search(r"music|concert|band|jazz|orchestra|metal|punk|symphony|dj|dance-party|dance|disco|techno|house-music|house|electronic|vinyl|nightlife|club-night|hip-hop|r&b|funk", tags_str)) or
        bool(re.search(r"jazz|blues|orchestra|concert|metal|punk|symphony|strings|vso|dj|dance party|dance night|techno|disco|funk|synth-pop|electronic|house music|groove|indie rock|post-punk", title_lower))
    )
    
    is_shows = (
        ("show" in cat_raw) or
        ("comedy" in cat_raw) or
        ("theatre" in cat_raw) or
        ("stage" in cat_raw) or
        bool(re.search(r"comedy|improv|stand-up|burlesque|theatre|opera|stage play", combined_context)) or
        (bool(re.search(r"cabaret|showcase", combined_context)) and not bool(re.search(r"dance-party|dance party|dj|dance night|disco", tags_str + " " + title_lower)))
    ) and not bool(re.search(r"dance party|dance-party|dance night", title_lower + " " + tags_str))
    
    cats = []
    if is_music: cats.append("music")
    if is_shows: cats.append("shows")
    return cats

ct_cats = classify_event(cheap_thrills)
d9_cats = classify_event(dance_90s)
print("\nClassification results:")
print(f"Cheap Thrills Dance Party: {ct_cats}")
print(f"00s vs 10s Party: {d9_cats}")

assert "music" in ct_cats, "Cheap Thrills must be classified as music"
assert "shows" not in ct_cats, "Cheap Thrills must NOT be classified as shows"
assert "music" in d9_cats, "00s vs 10s Party must be classified as music"
assert "shows" not in d9_cats, "00s vs 10s Party must NOT be classified as shows"

print("\nALL TAXONOMY CHECKS PASSED PERFECTLY!")
