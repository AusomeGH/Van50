#!/usr/bin/env python3
"""
Van50 Quality Control AI Engine
================================
Executes complete automated quality control over active events catalog:
1. Creates pre-audit timestamped safety snapshot in data/backups/
2. Stage 1: Live Verification & Closure Audit
   - For ticketed/scheduled events: checks date, start time, price <= $50, direct ticket link
   - For Free Public Access spots: checks operating hours and live closures/restrictions
   - Moves concluded events to archive; flags unresolvable/overbudget items to Quarantine
3. Stage 2: Pass 2 Link Refinement & High-Intent Search Tag Enrichment
   - Direct box office/ticket links (strips tracking tags)
   - Generates clean, human-searchable kebab-case tags (genres, vibes, audiences, neighborhoods)
4. Synchronizes js/data.js for immediate live web app discovery
"""

from __future__ import annotations
import os
import sys
import json
import time
import shutil
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")

sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from gemini_event_scout import get_gemini_api_key, audit_and_verify_active_events
from refine_event_links_and_tags import run_event_refinement_pass
from curator_server import sync_js_data_file


def create_safety_backup() -> str:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    backup_file = os.path.join(BACKUP_DIR, f"events_{ts}.json")
    if os.path.exists(EVENTS_PATH):
        shutil.copy2(EVENTS_PATH, backup_file)
        print(f"[QC BACKUP] Created safety snapshot: events_{ts}.json", flush=True)
    return backup_file


def main():
    print("==================================================", flush=True)
    print("       VAN50 QUALITY CONTROL AI ENGINE            ", flush=True)
    print("==================================================", flush=True)
    
    api_key = get_gemini_api_key()
    if not api_key:
        print("[ERROR] GEMINI_API_KEY is not set. Cannot run Quality Control AI.", flush=True)
        sys.exit(1)

    try:
        from activity_logger import set_ai_status, log_info
    except ImportError:
        def set_ai_status(status, task=None, step=None, progress=None): pass
        def log_info(msg, step=None, progress=None): pass

    set_ai_status("running", "Quality Control AI Engine", "Creating pre-audit safety snapshot...", 5)

    # 1. Safety Backup
    backup_file = create_safety_backup()
    log_info(f"Created safety backup: {os.path.basename(backup_file)}", progress=10)

    # 2. Stage 1: Live Verification & Closure Audit
    print("\n--- STAGE 1: LIVE VERIFICATION & CLOSURE AUDIT ---", flush=True)
    set_ai_status("running", "Quality Control AI Engine", "Stage 1: Live Verification & Public Access Closure Audit", 15)
    audit_results = audit_and_verify_active_events(api_key, max_check=None)
    print(f"\n[STAGE 1 AUDIT COMPLETE]", flush=True)
    print(f" • Verified Active: {audit_results.get('verified', 0)}", flush=True)
    print(f" • Updated Details: {audit_results.get('updated', 0)}", flush=True)
    print(f" • Concluded & Archived: {audit_results.get('archived', 0)}", flush=True)
    print(f" • Quarantined for Review: {audit_results.get('quarantined', 0)}", flush=True)

    # 3. Stage 2: Pass 2 Link Refinement & High-Intent Search Tag Enrichment
    print("\n--- STAGE 2: PASS 2 LINK REFINEMENT & TAG ENRICHMENT ---", flush=True)
    set_ai_status("running", "Quality Control AI Engine", "Stage 2: Direct Ticket Links & Search Tag Enrichment", 70)
    refine_results = run_event_refinement_pass(api_key=api_key, batch_size=6, dry_run=False)
    print(f"\n[STAGE 2 REFINEMENT COMPLETE]", flush=True)
    print(f" • Events Polished: {refine_results.get('refined_count', 0)}", flush=True)
    print(f" • High-Intent Search Tags: {refine_results.get('tags_generated', 0)}", flush=True)

    # 4. Synchronize js/data.js
    set_ai_status("running", "Quality Control AI Engine", "Synchronizing catalog with js/data.js...", 95)
    sync_js_data_file()
    print("\n[OK] js/data.js synchronized with polished catalog.", flush=True)
    print("==================================================", flush=True)
    print("       QUALITY CONTROL PASS FULLY COMPLETED       ", flush=True)
    print("==================================================", flush=True)
    set_ai_status(
        "idle",
        "Quality Control AI Engine",
        f"Verification complete: {audit_results.get('verified', 0)} verified active, {audit_results.get('quarantined', 0)} quarantined.",
        100
    )


if __name__ == "__main__":
    main()
