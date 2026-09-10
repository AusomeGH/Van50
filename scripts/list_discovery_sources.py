#!/usr/bin/env python3
"""
Van50 Discovery Sources Inspector
Prints structured metadata about all external event aggregators, cultural publications,
and ticketing feeds used for initial event discovery in Vancouver.
"""

import os
import sys
import json

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES_PATH = os.path.join(BASE_DIR, 'data', 'discovery_sources.json')

def list_sources():
    if not os.path.exists(SOURCES_PATH):
        print(f"Error: {SOURCES_PATH} not found.")
        sys.exit(1)

    with open(SOURCES_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    meta = data.get('metadata', {})
    sources = data.get('sources', [])

    print(f"=== Van50 Discovery Sources Directory ({len(sources)} Sources) ===")
    print(f"Version: {meta.get('version')} | Last Updated: {meta.get('updatedAt')}")
    print(f"Region: {meta.get('region')} | Budget Target: <= $50.00 CAD\n")

    for idx, s in enumerate(sources, 1):
        print(f"[{idx}] {s['name']} ({s['domain']})")
        print(f"    Type: {s['typeLabel']} [{s['type']}]")
        print(f"    Events URL: {s['eventsUrl']}")
        if s.get('rssUrl'):
            print(f"    RSS Feed: {s['rssUrl']}")
        if s.get('apiUrl'):
            print(f"    API Endpoint: {s['apiUrl']}")
        print(f"    Focus: {s['focus']}")
        print(f"    Best For: {', '.join(s.get('bestForCategories', []))}")
        print(f"    Target Budget: {s.get('targetBudgetTier')}")
        print(f"    Resolution Policy: {s['resolutionPolicy']}")
        print()

if __name__ == '__main__':
    list_sources()
