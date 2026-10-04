import json
import os
import sys
from datetime import datetime

BASE_DIR = r"C:\Users\Micro\.gemini\antigravity-ide\scratch\van50"
DATA_DIR = os.path.join(BASE_DIR, "data")
EVENTS_JSON = os.path.join(DATA_DIR, "events.json")
ARCHIVE_JSON = os.path.join(DATA_DIR, "events_archive.json")
BENCHMARKS_JSON = os.path.join(DATA_DIR, "ai_runtime_benchmarks.json")

today_str = datetime.now().strftime("%Y-%m-%d")

# 1. Load active events
with open(EVENTS_JSON, "r", encoding="utf-8") as ef:
    events = json.load(ef)

with open(ARCHIVE_JSON, "r", encoding="utf-8") as af:
    archive = json.load(af)

existing_arch_ids = {e.get("event_id") or e.get("id") for e in archive}

# 2. Archive concluded events whose sole date was prior to 2026-10-04
concluded_ids = {
    "van50-scout-mike-vaneyes-roots-blues-20261003",
    "van50-scout-vso-orpheum-sat-night-20261003",
    "van50-scout-what-else-comedy-trivia-20261003",
    "van50-scout-lola-rickshaw-tour-20261003",
    "van50-scout-ethan-regan-rickshaw-20261003"
}

still_active = []
archived_count = 0

for ev in events:
    eid = ev.get("event_id") or ev.get("id")
    s1_date = (ev.get("show_1") or {}).get("date")
    has_subsequent = bool(ev.get("show_2") or ev.get("show_3") or (ev.get("showings") and len(ev.get("showings")) > 1))
    is_perennial = ev.get("category") == "Free Public Access" or ev.get("lifecycle_type") == "perennial_drop_in"
    
    if (eid in concluded_ids or (s1_date and s1_date < "2026-10-04" and not has_subsequent and not is_perennial)):
        ev["archived_at"] = today_str
        ev["archive_reason"] = f"QC AI Concluded Date Archive ({s1_date} < 2026-10-04)"
        if eid not in existing_arch_ids:
            archive.append(ev)
            existing_arch_ids.add(eid)
        archived_count += 1
        print(f"[ARCHIVED CONCLUDED SHOW] {ev.get('event_name')} ({s1_date})")
    else:
        still_active.append(ev)

# 3. Ground D13 Spend Calibration on newly scouted events
spend_calibrations = {
    "van50-vandusen-harvest-days-20261010": {
        "typical_drink_spend": "$4.50 – $6.50 CAD (Truffles Cafe coffee & hot cider)",
        "typical_item_spend": "$4.50 – $8.00 CAD (Truffles Cafe & garden snacks)"
    },
    "van50-rio-paul-anthony-talent-time-halloween-20261023": {
        "typical_drink_spend": "$8.50 – $14.00 CAD (Rio Theatre craft beer / cocktail)",
        "typical_item_spend": "$7.00 – $9.00 CAD (Rio Theatre organic buttered popcorn)"
    },
    "van50-dr-sun-yat-sen-gongs-in-the-garden-20261018": {
        "typical_drink_spend": "$4.50 CAD (Courtyard loose leaf tea & bottled water)",
        "typical_item_spend": "$4.50 – $7.00 CAD (Garden shop refreshments)"
    },
    "van50-rickshaw-concrete-vehicles-20261008": {
        "typical_drink_spend": "$7.75 – $9.00 CAD (Rickshaw draft beer & cider)",
        "typical_item_spend": "$7.75 – $15.00 CAD (1-2 drinks)"
    },
    "van50-roundhouse-diwali-in-vancouver-mehfil-20261107": {
        "typical_drink_spend": "$4.00 – $6.00 CAD (Hot chai & bottled beverages)",
        "typical_item_spend": "$5.00 – $8.00 CAD (Samosas & festival snacks)"
    },
    "van50-cinematheque-vampyr-live-score-20261031": {
        "typical_drink_spend": "$6.50 – $8.00 CAD (Local craft beer & cider)",
        "typical_item_spend": "$5.00 – $7.00 CAD (Organic popcorn & candy)"
    },
    "van50-fox-bootylicious-halloween-20261030": {
        "typical_drink_spend": "$8.00 – $14.00 CAD (Fox Cabaret draft pint & mixed cocktails)",
        "typical_item_spend": "$8.00 – $16.00 CAD (Bar beverages)"
    },
    "van50-moa-haida-eyes-curator-tour-20261008": {
        "typical_drink_spend": "$4.50 – $6.00 CAD (MOA Cafe specialty coffee)",
        "typical_item_spend": "$5.00 – $9.00 CAD (Artisanal pastries & cafe snacks)"
    }
}

calibrated_count = 0
for ev in still_active:
    eid = ev.get("event_id") or ev.get("id")
    if eid in spend_calibrations:
        c = spend_calibrations[eid]
        ev["typical_drink_spend"] = c["typical_drink_spend"]
        ev["typical_item_spend"] = c["typical_item_spend"]
        calibrated_count += 1
        print(f"[D13 SPEND CALIBRATED] {ev.get('event_name')}")

# Save updated active events & archive
with open(EVENTS_JSON, "w", encoding="utf-8") as ef:
    json.dump(still_active, ef, indent=2, ensure_ascii=False)

with open(ARCHIVE_JSON, "w", encoding="utf-8") as af:
    json.dump(archive, af, indent=2, ensure_ascii=False)

print(f"\n[QC SUMMARY] Active: {len(still_active)} (-{archived_count} concluded archived) | Archived Total: {len(archive)} | Calibrated D13: {calibrated_count}")

# 4. Synchronize js/data.js
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from curator_server import sync_js_data_file
sync_js_data_file()
print("[OK] js/data.js synchronized.")
