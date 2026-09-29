#!/usr/bin/env python3
"""
Van50 AI Activity Logger & Live Stream Engine
=============================================
Manages real-time logging of AI scouting, verification, and QC activities.
Persists live status and log events to data/live_ai_activity.json for
real-time rendering in the Curator Studio and web interface.
"""

from __future__ import annotations
import os
import sys
import json
import time
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
ACTIVITY_FILE = os.path.join(DATA_DIR, "live_ai_activity.json")
MAX_RECENT_LOGS = 100

DEFAULT_STATE = {
    "status": "idle",  # "idle" | "running" | "complete" | "error"
    "current_task": "System Ready",
    "current_step": "Awaiting curator command or scheduled trigger",
    "progress_percent": 100,
    "last_updated": datetime.now().isoformat(),
    "stats": {
        "confirmed": 0,
        "new_events": 0,
        "new_venues": 0,
        "new_sources": 0,
        "quarantined": 0,
        "archived": 0
    },
    "recent_logs": []
}


def _load_activity_state() -> dict:
    if os.path.exists(ACTIVITY_FILE):
        try:
            with open(ACTIVITY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return dict(DEFAULT_STATE)


def _save_activity_state(state: dict):
    os.makedirs(DATA_DIR, exist_ok=True)
    state["last_updated"] = datetime.now().isoformat()
    # Atomic write via temp file
    temp_path = f"{ACTIVITY_FILE}.tmp.{os.getpid()}"
    try:
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
        os.replace(temp_path, ACTIVITY_FILE)
    except Exception as e:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


def set_ai_status(status: str, task: str = None, step: str = None, progress: int = None):
    """
    Updates the top-level AI engine status.
    status: 'idle', 'running', 'complete', or 'error'
    """
    state = _load_activity_state()
    state["status"] = status
    if task is not None:
        state["current_task"] = task
    if step is not None:
        state["current_step"] = step
    if progress is not None:
        state["progress_percent"] = max(0, min(100, int(progress)))
    _save_activity_state(state)
    
    # Also print directly to terminal with flush
    ts_str = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts_str}] [AI STATUS: {status.upper()}] {state['current_task']} - {state['current_step']} ({state.get('progress_percent', 0)}%)", flush=True)


def log_activity(log_type: str, message: str, stat_key: str = None, step: str = None, progress: int = None):
    """
    Logs a single discrete event line, updates stats, and appends to recent_logs.
    log_type: 'CONFIRMED' | 'NEW_EVENT' | 'NEW_VENUE' | 'NEW_SOURCE' | 'QUARANTINED' | 'ARCHIVED' | 'INFO' | 'ERROR'
    """
    state = _load_activity_state()
    now_ts = datetime.now().strftime("%H:%M:%S")
    
    entry = {
        "id": f"log_{int(time.time() * 1000)}",
        "timestamp": now_ts,
        "type": log_type.upper(),
        "message": message
    }
    
    if "recent_logs" not in state:
        state["recent_logs"] = []
    
    state["recent_logs"].append(entry)
    if len(state["recent_logs"]) > MAX_RECENT_LOGS:
        state["recent_logs"] = state["recent_logs"][-MAX_RECENT_LOGS:]
        
    if stat_key and stat_key in state.get("stats", {}):
        state["stats"][stat_key] = state["stats"].get(stat_key, 0) + 1
        
    if step is not None:
        state["current_step"] = step
    if progress is not None:
        state["progress_percent"] = max(0, min(100, int(progress)))
        
    _save_activity_state(state)
    
    # Console output for terminal watchers
    print(f"[{now_ts}] {message}", flush=True)


# Convenience Helpers
def log_confirmed(title: str, detail: str = "", step: str = None, progress: int = None):
    msg = f"[CONFIRMED] \"{title}\" • {detail}" if detail else f"[CONFIRMED] \"{title}\""
    log_activity("CONFIRMED", msg, stat_key="confirmed", step=step, progress=progress)


def log_new_event(title: str, venue: str, detail: str = "", step: str = None, progress: int = None):
    msg = f"[NEW EVENT ADDED] \"{title}\" at {venue} ({detail})" if detail else f"[NEW EVENT ADDED] \"{title}\" at {venue}"
    log_activity("NEW_EVENT", msg, stat_key="new_events", step=step, progress=progress)


def log_new_venue(venue_name: str, neighborhood: str = "", step: str = None, progress: int = None):
    msg = f"[NEW VENUE ADDED] \"{venue_name}\" ({neighborhood})" if neighborhood else f"[NEW VENUE ADDED] \"{venue_name}\""
    log_activity("NEW_VENUE", msg, stat_key="new_venues", step=step, progress=progress)


def log_new_source(source_name: str, domain: str = "", step: str = None, progress: int = None):
    msg = f"[NEW SOURCE ADDED] \"{source_name}\" ({domain})" if domain else f"[NEW SOURCE ADDED] \"{source_name}\""
    log_activity("NEW_SOURCE", msg, stat_key="new_sources", step=step, progress=progress)


def log_quarantined(title: str, reason: str, step: str = None, progress: int = None):
    msg = f"[QUARANTINED] \"{title}\" • Reason: {reason}"
    log_activity("QUARANTINED", msg, stat_key="quarantined", step=step, progress=progress)


def log_archived(title: str, reason: str, step: str = None, progress: int = None):
    msg = f"[ARCHIVED] \"{title}\" • Reason: {reason}"
    log_activity("ARCHIVED", msg, stat_key="archived", step=step, progress=progress)


def log_info(message: str, step: str = None, progress: int = None):
    log_activity("INFO", message, step=step, progress=progress)


def reset_live_stats():
    """Resets counters for a fresh run."""
    state = _load_activity_state()
    state["stats"] = {
        "confirmed": 0,
        "new_events": 0,
        "new_venues": 0,
        "new_sources": 0,
        "quarantined": 0,
        "archived": 0
    }
    _save_activity_state(state)
