#!/usr/bin/env python3
"""
Venue Inspection and Catalog Audit Utility for Van50.
Reads data/events.json and outputs structured venue and provider metrics.
"""

import os
import sys
import json

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(BASE_DIR, 'data', 'events.json')

def audit_venues():
    if not os.path.exists(JSON_PATH):
        print(f"Error: {JSON_PATH} not found. Run sync_events.py first.")
        sys.exit(1)

    with open(JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    events = data.get('events', [])
    print(f"=== Van50 Catalog Audit ({len(events)} Outings) ===")
    print(f"Last Synced: {data.get('metadata', {}).get('updatedAt')}")
    print(f"Budget Cap: <= ${data.get('metadata', {}).get('budgetLimit', 50):.2f} CAD\n")

    venues = {}
    neighborhoods = {}
    providers = {}
    free_count = 0
    under_20_count = 0
    under_35_count = 0

    for ev in events:
        v = ev.get('venue', 'Unknown')
        venues[v] = venues.get(v, 0) + 1

        nh = ev.get('neighborhood', 'Unknown')
        neighborhoods[nh] = neighborhoods.get(nh, 0) + 1

        p = ev.get('ticketProvider', 'Unknown')
        providers[p] = providers.get(p, 0) + 1

        pr = ev.get('price', 0)
        if pr == 0:
            free_count += 1
        if pr <= 20:
            under_20_count += 1
        if pr <= 35:
            under_35_count += 1

    print(f"Price Tier Distribution:")
    print(f"  • Free ($0): {free_count} events")
    print(f"  • Under $20 CAD: {under_20_count} events")
    print(f"  • Under $35 CAD: {under_35_count} events")
    print(f"  • All ($0 - $50 CAD): {len(events)} events\n")

    print(f"Neighborhoods ({len(neighborhoods)} distinct areas):")
    for nh, count in sorted(neighborhoods.items(), key=lambda x: -x[1]):
        print(f"  • {nh}: {count} event(s)")

    print(f"\nTicketing Providers ({len(providers)} providers):")
    for p, count in sorted(providers.items(), key=lambda x: -x[1]):
        print(f"  • {p}: {count} event(s)")

    print(f"\nTop Venues ({len(venues)} total unique venues):")
    for v, count in sorted(venues.items(), key=lambda x: -x[1])[:10]:
        print(f"  • {v}: {count} event(s)")

if __name__ == '__main__':
    audit_venues()
