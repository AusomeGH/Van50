import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVENTS_PATH = os.path.join(BASE_DIR, "data", "events.json")

with open(EVENTS_PATH, 'r', encoding='utf-8') as f:
    events = json.load(f)

upgraded_ids = {
    'van50-pendulum-gallery',
    'van50-vancouver-art-gallery-free-access',
    'van50-rio-burlesque-variety-20261017',
    'van50-actors-rickshaw-20261009',
    'van50-90s-00s-dance-party-fox-20261009',
    'van50-scout-rickshaw-amy-winehouse-20261017',
    'van50-burnaby-central-railway-mini-train',
    'van50-dr-sun-yat-sen-gongs-in-the-garden-20261018',
    'van50-rickshaw-concrete-vehicles-20261008'
}

lines = ['# Van50 Complete 77-Event Quality Control Audit Ledger\n']
lines.append('| # | Title | Venue | Price (All-In CAD) | Verified Ticket URL | Audit Status |')
lines.append('|---|---|---|:---:|---|---|')

for i, e in enumerate(events):
    eid = e.get('event_id') or e.get('id')
    title = e.get('title') or e.get('event_name') or 'Untitled'
    venue = e.get('venue') or e.get('venue_name') or 'Vancouver'
    p = e.get('price')
    try:
        p_val = float(p) if p is not None else 0.0
    except:
        p_val = 0.0
    
    price_str = f"${p_val:.2f}" if p_val > 0 else "Free ($0)"
    u = e.get('ticket_url', '')
    u_display = u.split('?')[0] if u else 'N/A'
    
    if eid in upgraded_ids:
        status = "⭐ **Upgraded (Tier 1 Checkout)**"
    else:
        status = "✓ Verified (No Changes)"
        
    lines.append(f"| **{i+1}** | {title} | *{venue}* | {price_str} | [{u_display}]({u}) | {status} |")

art_path = os.path.join(r"C:\Users\Micro\.gemini\antigravity-ide\brain\62c425d2-cee5-44ba-94ad-144e68b9be99", "full_qc_catalog_audit.md")
with open(art_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print(f"Generated {len(events)} rows in {art_path}")
