#!/usr/bin/env python3
"""
Curator Studio AI Queue Summary Helper
Inspects data/curator_instructions.json and data/manual_review_queue.json
to report pending instructions, screenshots, reinforcement signals, and quarantined events.
"""

import os
import json
import sys

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
INSTRUCTIONS_PATH = os.path.join(DATA_DIR, "curator_instructions.json")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
SCREENSHOTS_DIR = os.path.join(DATA_DIR, "curator_screenshots")


def get_queue_summary():
    # 1. Instructions & Learning Signals
    pending_instructions = []
    resolved_instructions = []
    screenshot_count = 0
    reinforce_count = 0
    correction_count = 0

    if os.path.exists(INSTRUCTIONS_PATH):
        try:
            with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                all_inst = data.get("instructions", [])
                for inst in all_inst:
                    status = inst.get("status", "pending")
                    if status == "pending":
                        pending_instructions.append(inst)
                        if inst.get("screenshotPath"):
                            screenshot_count += 1
                        if inst.get("type") == "reinforcement_learning" or inst.get("actionTaken") == "approved_as_is":
                            reinforce_count += 1
                        else:
                            correction_count += 1
                    elif status == "resolved":
                        resolved_instructions.append(inst)
        except Exception as e:
            print(f"[WARN] Error reading {INSTRUCTIONS_PATH}: {e}", file=sys.stderr)

    # 2. Quarantined Events
    quarantined_events = []
    if os.path.exists(QUEUE_PATH):
        try:
            with open(QUEUE_PATH, "r", encoding="utf-8") as f:
                qdata = json.load(f)
                quarantined_events = qdata.get("quarantinedEvents", [])
        except Exception as e:
            print(f"[WARN] Error reading {QUEUE_PATH}: {e}", file=sys.stderr)

    return {
        "pendingTotal": len(pending_instructions),
        "screenshotCount": screenshot_count,
        "reinforcementCount": reinforce_count,
        "correctionCount": correction_count,
        "resolvedTotal": len(resolved_instructions),
        "quarantineTotal": len(quarantined_events),
        "pendingItems": pending_instructions,
        "quarantinedEvents": quarantined_events
    }


def format_summary_text(summary):
    lines = []
    lines.append("📋 **Curator Studio Status Report**:")
    lines.append(f"- **Pending AI Queue Items**: {summary['pendingTotal']}")
    if summary['screenshotCount'] > 0:
        lines.append(f"  • 🖼️ Screenshot Corrections: {summary['screenshotCount']}")
    if summary['reinforcementCount'] > 0:
        lines.append(f"  • 🎯 Approved As-Is Reinforcements: {summary['reinforcementCount']}")
    if summary['correctionCount'] > 0 and summary['screenshotCount'] == 0:
        lines.append(f"  • ✍️ Plain-English Note Corrections: {summary['correctionCount']}")
    lines.append(f"- **Quarantined Events Awaiting Review**: {summary['quarantineTotal']}")
    lines.append(f"- **Historical Resolved Items**: {summary['resolvedTotal']}")
    return "\n".join(lines)


if __name__ == "__main__":
    summary = get_queue_summary()
    if "--json" in sys.argv:
        print(json.dumps(summary, indent=2))
    else:
        print(format_summary_text(summary))
