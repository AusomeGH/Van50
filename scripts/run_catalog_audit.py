#!/usr/bin/env python3
"""
Full Autonomous Active Events Audit (Gemini Search Grounding)
Iterates through 100% of unverified active events in data/events.json:
- Validates dates, times, and pricing <= $50 CAD
- Updates corrected details
- Archives concluded events
- Quarantines unresolvable/ambiguous events
"""
import os
import sys
import json
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))

from gemini_event_scout import get_gemini_api_key, audit_and_verify_active_events

def main():
    api_key = get_gemini_api_key()
    if not api_key:
        print("[ERROR] GEMINI_API_KEY is not set.", flush=True)
        sys.exit(1)

    print("=== STARTING FULL CATALOG AUDIT OF events.json ===", flush=True)
    res = audit_and_verify_active_events(api_key, max_check=None)
    print("\n=== FULL CATALOG AUDIT COMPLETE ===", flush=True)
    print(f"• Verified Active: {res.get('verified', 0)}", flush=True)
    print(f"• Auto-Corrected: {res.get('updated', 0)}", flush=True)
    print(f"• Archived Concluded: {res.get('archived', 0)}", flush=True)
    print(f"• Quarantined Unresolvable: {res.get('quarantined', 0)}", flush=True)

if __name__ == "__main__":
    main()
