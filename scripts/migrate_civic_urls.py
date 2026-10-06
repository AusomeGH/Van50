import json
import os
import shutil
from datetime import datetime

CIVIC_URL_REPLACEMENTS = {
    "https://vancouver.ca/parks-recreation-culture/stanley-park.aspx": "https://www.destinationvancouver.com/things-to-do/listings/stanley-park",
    "https://vancouver.ca/parks-recreation-culture/queen-elizabeth-park.aspx": "https://www.destinationvancouver.com/things-to-do/listings/queen-elizabeth-park",
    "https://vancouver.ca/parks-recreation-culture/bloedel-conservatory.aspx": "https://vandusengarden.org/plan-your-visit/bloedel-conservatory/",
    "https://vancouver.ca/parks-recreation-culture/stanley-park-pitch-and-putt.aspx": "https://stanleyparkvan.com/stanley-park-van-sport-facility-pitch-putt-golf-course.html",
    "https://vancouver.ca/parks-recreation-culture/stanley-park-pitch-putt.aspx": "https://stanleyparkvan.com/stanley-park-van-sport-facility-pitch-putt-golf-course.html",
    "https://vancouver.ca/parks-recreation-culture/queen-elizabeth-park-pitch-putt.aspx": "https://par3nearme.com/course/queen-elizabeth-park-pitch-and-putt/",
    "https://vancouver.ca/parks-recreation-culture/rupert-park-pitch-putt.aspx": "https://par3nearme.com/course/rupert-park-pitch-and-putt/",
    "https://vancouver.ca/parks-recreation-culture/roundhouse-community-centre.aspx": "https://www.roundhouse.ca/",
    "https://vancouver.ca/parks-recreation-culture/the-annex.aspx": "https://vancouvercivictheatres.com/venues/annex/",
    "https://vancouver.ca/parks-recreation-culture/vandusen-botanical-garden.aspx": "https://vandusengarden.org/",
    "https://vancouver.ca/events": "https://www.destinationvancouver.com/events/"
}

def migrate_val(val):
    if not isinstance(val, str):
        return val, 0
    c = 0
    for old_url, new_url in CIVIC_URL_REPLACEMENTS.items():
        if old_url in val:
            val = val.replace(old_url, new_url)
            c += 1
    return val, c

def migrate_obj(obj):
    count = 0
    if isinstance(obj, dict):
        new_d = {}
        for k, v in obj.items():
            if isinstance(v, (dict, list)):
                res_v, c = migrate_obj(v)
                new_d[k] = res_v
                count += c
            elif isinstance(v, str):
                new_str, c = migrate_val(v)
                new_d[k] = new_str
                count += c
            else:
                new_d[k] = v
        return new_d, count
    elif isinstance(obj, list):
        new_l = []
        for item in obj:
            if isinstance(item, (dict, list)):
                res_i, c = migrate_obj(item)
                new_l.append(res_i)
                count += c
            elif isinstance(item, str):
                new_str, c = migrate_val(item)
                new_l.append(new_str)
                count += c
            else:
                new_l.append(item)
        return new_l, count
    return obj, 0

def process_file(filepath):
    if not os.path.exists(filepath):
        print(f"[SKIP] {filepath} does not exist")
        return
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    new_data, count = migrate_obj(data)
    if count > 0:
        backup = filepath + f".bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.copy2(filepath, backup)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(new_data, f, indent=2, ensure_ascii=False)
        print(f"[UPDATED] {filepath}: {count} replacements made (backup at {os.path.basename(backup)})")
    else:
        print(f"[NO CHANGE] {filepath}")

# 1. Update data files
target_files = [
    "data/events.json",
    "data/venues.json",
    "data/discovery_sources.json",
    "data/scout_master_sources.json",
    "data/scout_sweep_session.json",
    "data/curator_learned_rules.json"
]

for tf in target_files:
    process_file(tf)
