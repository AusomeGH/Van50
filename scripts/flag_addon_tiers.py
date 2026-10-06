import json
import shutil
from datetime import datetime

with open("data/events.json", "r", encoding="utf-8") as f:
    events = json.load(f)

addon_keywords = ["rental", "rent", "caddy", "ball rental", "club rental", "tasting tent", "add-on", "addon"]

def is_addon_name(name):
    if not name: return False
    lower = name.lower()
    if any(k in lower for k in ["nightclub", "comedy club", "supper club", "jazz club", "club pass"]):
        return False
    return any(k in lower for k in addon_keywords)

updated_count = 0

for e in events:
    title = e.get("title", "")
    is_target = any(k in title.lower() for k in ["pitch", "apple festival"])
    
    # Check custom tiers
    has_addon = False
    for i in range(1, 6):
        tname = e.get(f"tier_custom_name_{i}")
        if tname and is_addon_name(tname):
            e[f"tier_custom_is_addon_{i}"] = True
            has_addon = True
            print(f"[{title}] Flagged tier_custom_{i}: {tname} as addon")

    # Update tiers array
    if has_addon or is_target:
        current_tiers = e.get("tiers") or []
        new_tiers = []
        for t in current_tiers:
            t_obj = dict(t)
            if is_addon_name(t_obj.get("name")):
                t_obj["isAddon"] = True
                t_obj["is_addon"] = True
            new_tiers.append(t_obj)
        
        # If the add-on tier wasn't in tiers array, add it explicitly as an add-on
        for i in range(1, 6):
            tname = e.get(f"tier_custom_name_{i}")
            tprice = e.get(f"tier_custom_price_{i}")
            if tname and tprice is not None and is_addon_name(tname):
                if not any(t.get("name") == tname for t in new_tiers):
                    new_tiers.append({
                        "name": tname,
                        "price": float(tprice),
                        "isAddon": True,
                        "is_addon": True,
                        "isAvailable": True
                    })
                    print(f"[{title}] Appended add-on {tname} (${tprice}) to tiers array")

        e["tiers"] = new_tiers
        updated_count += 1

print(f"\nUpdated {updated_count} events in data/events.json")

backup = f"data/events.json.bak_addons_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
shutil.copy2("data/events.json", backup)
with open("data/events.json", "w", encoding="utf-8") as f:
    json.dump(events, f, indent=2, ensure_ascii=False)
print(f"Saved changes to data/events.json (Backup: {backup})")
