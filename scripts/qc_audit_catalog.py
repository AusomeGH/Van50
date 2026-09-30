import json
import urllib.request
import urllib.parse
from datetime import datetime

with open('data/events.json', 'r', encoding='utf-8') as f:
    events = json.load(f)

today = datetime.now().strftime('%Y-%m-%d')
print(f"=== QC AI 100% CATALOG AUDIT ===")
print(f"Total Active Events to Audit: {len(events)}")
print(f"Audit Reference Date: {today}\n")

audit_results = []
failing_cards = []

for i, e in enumerate(events):
    eid = e.get('event_id') or e.get('id')
    name = e.get('event_name') or e.get('title') or 'Untitled'
    venue = e.get('venue_name') or e.get('venue') or 'Unknown Venue'
    ltype = e.get('lifecycle_type') or 'time_bound_event'
    price = e.get('price')
    if price is None and isinstance(e.get('pricing_all_in_cad'), dict):
        price = e['pricing_all_in_cad'].get('regular')
    
    url = e.get('ticket_url') or e.get('details_url') or e.get('discovery_url') or ''
    
    # Check date
    date = None
    if ltype == 'perennial_drop_in':
        date = 'PERENNIAL_DROP_IN'
    elif e.get('show_1') and e['show_1'].get('date'):
        date = e['show_1']['date']
    elif e.get('date'):
        date = e['date']
    
    issues = []
    
    # 1. Date Check
    if ltype != 'perennial_drop_in':
        if not date or len(str(date)) != 10:
            issues.append(f"Missing/Invalid discrete date ({date})")
        elif str(date) < today:
            issues.append(f"Past event date ({date} < {today})")
            
    # 2. Budget Cap Check (<= $50 CAD)
    if price is None:
        issues.append("Unconfirmed price in CAD")
    else:
        try:
            p_val = float(price)
            if p_val > 50.0:
                issues.append(f"Exceeds $50 CAD cap (${p_val:.2f} CAD)")
        except (ValueError, TypeError):
            issues.append(f"Invalid price value ({price})")
            
    # 3. URL & Basket Check
    if not url or not url.startswith('http'):
        issues.append("Missing or invalid ticketing/details URL")
    elif url.rstrip('/').lower() in ['https://vancouvercivictheatres.com', 'https://vancouvercivictheatres.com/events']:
        issues.append("Generic civic landing page rather than specific production basket")
        
    status = "PASS" if not issues else "FAIL"
    res = {
        "index": i + 1,
        "id": eid,
        "name": name,
        "venue": venue,
        "date": date,
        "price": price,
        "url": url,
        "status": status,
        "issues": issues
    }
    audit_results.append(res)
    if issues:
        failing_cards.append(res)

print(f"Audit Complete:")
print(f"  • PASSED: {len(events) - len(failing_cards)} cards")
print(f"  • FAILING / DEFICIENT: {len(failing_cards)} cards\n")

if failing_cards:
    print("=== FAILING CARDS ===")
    for fc in failing_cards:
        print(f"[{fc['index']}] ID: {fc['id']} | {fc['name']} @ {fc['venue']}")
        print(f"    Date: {fc['date']} | Price: {fc['price']} | URL: {fc['url']}")
        print(f"    Issues: {', '.join(fc['issues'])}")
        print("-" * 50)
else:
    print("[ALL 60 CARDS 100% PASSED QC AUDIT]")
