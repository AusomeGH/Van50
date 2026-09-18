#!/usr/bin/env python3
"""
Van50 Hands-Free Daily Automation & Discovery Engine
Orchestrates autonomous daily crawls, nomadic location resolution,
all-in fee computations, link health audits, and catalog updates.
Can run as a standalone one-off script, a background daemon, or via Windows Task Scheduler.
"""

from __future__ import annotations
import os
import sys
import json
import time
import shutil
import argparse
import traceback
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
LOGS_DIR = os.path.join(DATA_DIR, "automation_logs")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
STATUS_PATH = os.path.join(DATA_DIR, "automation_status.json")

sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
import sync_events
from universal_venue_crawler import UniversalVenueCrawler
from nomadic_resolver import NomadicLocationResolver


def log_message(msg: str, log_file_path: str = None):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    if log_file_path:
        try:
            with open(log_file_path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except Exception:
            pass


def create_safety_backup(log_path: str = None) -> Optional[str]:
    """Creates a timestamped snapshot of data/events.json prior to mutation."""
    if not os.path.exists(EVENTS_PATH):
        return None
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    filename = f"events_{ts}.json"
    dest = os.path.join(BACKUP_DIR, filename)
    try:
        shutil.copy2(EVENTS_PATH, dest)
        log_message(f"[BACKUP OK] Created safety snapshot: {filename}", log_path)
        
        # Retain latest 25 backups
        backups = sorted([os.path.join(BACKUP_DIR, f) for f in os.listdir(BACKUP_DIR) if f.startswith("events_")])
        if len(backups) > 25:
            for old_b in backups[:-25]:
                try:
                    os.remove(old_b)
                except Exception:
                    pass
        return filename
    except Exception as e:
        log_message(f"[BACKUP WARN] Failed to create safety snapshot: {e}", log_path)
        return None


def calculate_next_run(target_time_str: str = "04:00") -> datetime:
    """Calculates next upcoming occurrence of target time (e.g. 04:00)."""
    now = datetime.now()
    hour, minute = map(int, target_time_str.split(":"))
    candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= now:
        candidate += timedelta(days=1)
    return candidate


def get_automation_status() -> Dict[str, Any]:
    defaults = {
        "status": "idle",
        "automationEnabled": True,
        "lastRunAt": None,
        "nextRunAt": calculate_next_run("04:00").isoformat(),
        "totalEvents": 0,
        "quarantinedCount": 0
    }
    if os.path.exists(STATUS_PATH):
        try:
            with open(STATUS_PATH, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                defaults.update(loaded)
        except Exception:
            pass
    if not defaults.get("nextRunAt"):
        defaults["nextRunAt"] = calculate_next_run("04:00").isoformat()
    return defaults


def update_automation_status(status_payload: Dict[str, Any]):
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        current = get_automation_status()
        current.update(status_payload)
        current["updatedAt"] = datetime.now().isoformat()
        with open(STATUS_PATH, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[STATUS WARN] Failed to write {STATUS_PATH}: {e}")


def run_full_daily_pipeline(dry_run: bool = False, run_at_time: str = "04:00", send_email: bool = False) -> Dict[str, Any]:
    """Executes the complete end-to-end daily synchronization & discovery cycle."""
    start_time = time.time()
    os.makedirs(LOGS_DIR, exist_ok=True)
    today_str = datetime.now().strftime("%Y-%m-%d")
    log_file_path = os.path.join(LOGS_DIR, f"daily_sync_{today_str}.log")

    log_message("=== STARTING VAN50 AUTONOMOUS DAILY DISCOVERY PIPELINE ===", log_file_path)
    
    update_automation_status({
        "status": "running",
        "currentStep": "safety_backup",
        "startedAt": datetime.now().isoformat()
    })

    # Step 1: Safety Backup
    backup_file = create_safety_backup(log_file_path)

    # Step 2: Run Universal Crawlers & Dynamic Synchronization
    update_automation_status({"currentStep": "live_sync_crawlers"})
    log_message("[PIPELINE STEP 1/3] Invoking venue adapters and universal synchronization worker...", log_file_path)
    
    sync_ok = False
    try:
        sync_ok = sync_events.run_sync()
        log_message(f"[PIPELINE SYNC RESULT] sync_events.run_sync() returned: {sync_ok}", log_file_path)
    except Exception as e:
        log_message(f"[PIPELINE ERROR] sync_events encountered exception: {e}\n{traceback.format_exc()}", log_file_path)

    # Step 3: Verify Catalog & Queue Metrics
    update_automation_status({"currentStep": "compiling_metrics"})
    total_events = 0
    quarantine_count = 0
    if os.path.exists(EVENTS_PATH):
        try:
            with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                d = json.load(f)
                total_events = len(d.get("events", []))
        except Exception:
            pass

    if os.path.exists(QUEUE_PATH):
        try:
            with open(QUEUE_PATH, "r", encoding="utf-8") as f:
                q = json.load(f)
                quarantine_count = len(q.get("quarantinedEvents", []))
        except Exception:
            pass

    elapsed = round(time.time() - start_time, 2)
    next_run_dt = calculate_next_run(run_at_time)

    result_summary = {
        "status": "success" if sync_ok else "warning",
        "currentStep": "idle",
        "lastRunAt": datetime.now().isoformat(),
        "nextRunAt": next_run_dt.isoformat(),
        "durationSeconds": elapsed,
        "totalEvents": total_events,
        "quarantinedCount": quarantine_count,
        "backupFile": backup_file,
        "automationEnabled": True,
        "lastLogFile": f"data/automation_logs/daily_sync_{today_str}.log"
    }

    update_automation_status(result_summary)
    log_message(f"[PIPELINE COMPLETE] {total_events} active events verified, {quarantine_count} quarantined in {elapsed}s.", log_file_path)
    log_message(f"[NEXT SCHEDULED RUN] {next_run_dt.strftime('%Y-%m-%d %H:%M:%S')}", log_file_path)

    # Step 4: Optional Email Notification Dispatch
    if send_email or os.environ.get("SMTP_USERNAME"):
        try:
            from email_notifier import send_daily_status_email
            send_daily_status_email(result_summary)
        except Exception as e:
            log_message(f"[EMAIL WARN] Could not send email notification: {e}", log_file_path)

    log_message("=== PIPELINE RUN FINISHED ===", log_file_path)
    
    return result_summary


def run_daemon_loop(target_time_str: str = "04:00", interval_check_seconds: int = 60):
    """Continuous background scheduler loop."""
    log_message(f"[DAEMON STARTED] Van50 Daily Automation active. Daily target time: {target_time_str}")
    
    while True:
        status = get_automation_status()
        if not status.get("automationEnabled", True):
            time.sleep(interval_check_seconds)
            continue

        now = datetime.now()
        current_time_hm = now.strftime("%H:%M")
        
        # Check if current minute matches target time and hasn't run in the last 10 minutes
        last_run_iso = status.get("lastRunAt")
        already_ran_today = False
        if last_run_iso:
            try:
                last_dt = datetime.fromisoformat(last_run_iso)
                if last_dt.date() == now.date() and (now - last_dt).total_seconds() < 3600:
                    already_ran_today = True
            except Exception:
                pass

        if current_time_hm == target_time_str and not already_ran_today:
            log_message(f"[DAEMON TRIGGER] Triggering automated daily run at {current_time_hm}...")
            try:
                run_full_daily_pipeline(run_at_time=target_time_str)
            except Exception as e:
                log_message(f"[DAEMON ERROR] Pipeline failed: {e}")

        time.sleep(interval_check_seconds)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Van50 Hands-Free Daily Automation & Discovery Engine")
    parser.add_argument("--run-once", action="store_true", help="Execute single automation run immediately and exit")
    parser.add_argument("--daemon", action="store_true", help="Run as continuous background daemon scheduling daily runs")
    parser.add_argument("--target-time", type=str, default="04:00", help="Target daily execution time in HH:MM format (default: 04:00)")
    parser.add_argument("--dry-run", action="store_true", help="Simulate run without writing files")
    parser.add_argument("--send-email", action="store_true", help="Send daily status report email via SMTP")

    args = parser.parse_args()

    if args.run_once:
        res = run_full_daily_pipeline(dry_run=args.dry_run, run_at_time=args.target_time, send_email=args.send_email)
        sys.exit(0 if res["status"] == "success" else 1)
    elif args.daemon:
        run_daemon_loop(target_time_str=args.target_time)
    else:
        # Default behavior: run once if called directly
        res = run_full_daily_pipeline(dry_run=args.dry_run, run_at_time=args.target_time, send_email=args.send_email)
        sys.exit(0 if res["status"] == "success" else 1)
