#!/usr/bin/env python3
"""
ingest_guilt_and_co.py (Deprecated - Use calendar_widget_engine.py)
This script is now a lightweight alias to the generalized CalendarWidgetEngine.
The AI Scout and UniversalVenueCrawler now automatically detect and extract
any embedded calendar widget (Tockify, Eventbrite, Google Calendar, etc.)
across all venues without venue-specific code.
"""

import sys
import os
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from calendar_widget_engine import CalendarWidgetEngine

def main():
    target_url = "https://www.guiltandcompany.com/"
    print(f"[DEPRECATION NOTICE] Use 'python scripts/calendar_widget_engine.py --url <URL>' instead.")
    print(f"[WIDGET DISPATCH] Inspecting {target_url} via universal CalendarWidgetEngine...")
    
    req = urllib.request.Request(target_url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    with urllib.request.urlopen(req) as resp:
        html = resp.read().decode('utf-8', errors='replace')
        
    events = CalendarWidgetEngine.detect_and_extract(html, target_url)
    print(f"Discovered {len(events)} events via universal calendar widget engine.")
    for ev in events[:5]:
        print(f" + [{ev.get('date')}] {ev.get('title')}")

if __name__ == '__main__':
    main()
