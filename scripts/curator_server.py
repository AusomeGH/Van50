#!/usr/bin/env python3
"""
Van50 Curator Server & API Daemon
Extends standard static HTTP serving with authenticated REST endpoints for:
- Authentication & HMAC session token issuance
- Review queue triage (Approve & Ingest to Master, Dismiss/Archive)
- Automated safety backup creation
- Algorithmic rule persistence to curator_learned_rules.json
- Synchronization of js/data.js
"""

import http.server
import socketserver
import json
import os
import sys
import time
import shutil
import base64
import re
import threading
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
MANUAL_QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
RULES_PATH = os.path.join(DATA_DIR, "curator_learned_rules.json")
ARCHIVE_PATH = os.path.join(DATA_DIR, "archived_events.json")
INSTRUCTIONS_PATH = os.path.join(DATA_DIR, "curator_instructions.json")
SCREENSHOTS_DIR = os.path.join(DATA_DIR, "curator_screenshots")
JS_DATA_PATH = os.path.join(BASE_DIR, "js", "data.js")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")

sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from curator_auth import verify_curator_password, generate_session_token, verify_session_token, revoke_session_token
from daily_automation import get_automation_status, update_automation_status, run_full_daily_pipeline

PORT = 8080

# Security Configuration: Protected Directories & Files
BLOCKED_DATA_FILES = {
    "manual_review_queue.json",
    "curator_instructions.json",
    "curator_learned_rules.json",
    "archived_events.json",
    ".curator_secret.json"
}
BLOCKED_DIRS = {"scripts", "tests", "scratch", "backups", ".git", ".agents", ".vscode"}

# Sliding-window rate limiter for mutating API calls: { ip: [timestamp1, timestamp2, ...] }
MUTATING_RATE_LIMITS = {}
MAX_MUTATIONS_PER_MINUTE = 60


def check_mutating_rate_limit(ip: str) -> bool:
    """Sliding-window rate limiter allowing up to MAX_MUTATIONS_PER_MINUTE per IP."""
    now = time.time()
    timestamps = MUTATING_RATE_LIMITS.setdefault(ip, [])
    timestamps[:] = [t for t in timestamps if now - t < 60]
    if len(timestamps) >= MAX_MUTATIONS_PER_MINUTE:
        return False
    timestamps.append(now)
    return True


def sanitize_text(text: str) -> str:
    """Strips HTML and script tags from text inputs to prevent stored XSS injection."""
    if not isinstance(text, str):
        return text
    # Strip <script...>...</script>
    cleaned = re.sub(r'<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>', '', text, flags=re.IGNORECASE)
    # Strip any remaining tags
    cleaned = re.sub(r'<[^>]+>', '', cleaned)
    return cleaned.strip()


def create_backup_snapshot():
    """Creates a timestamped snapshot of data/events.json prior to mutation."""
    if not os.path.exists(EVENTS_PATH):
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    backup_file = os.path.join(BACKUP_DIR, f"events_{ts}.json")
    try:
        shutil.copy2(EVENTS_PATH, backup_file)
        # Keep only latest 20 backups
        backups = sorted([os.path.join(BACKUP_DIR, f) for f in os.listdir(BACKUP_DIR) if f.startswith("events_")])
        if len(backups) > 20:
            for b in backups[:-20]:
                try:
                    os.remove(b)
                except Exception:
                    pass
    except Exception as e:
        print(f"[WARN] Failed to create backup: {e}")


def sync_js_data_file():
    """Regenerates js/data.js from data/events.json and data/manual_review_queue.json."""
    try:
        events = []
        if os.path.exists(EVENTS_PATH):
            with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                events = data if isinstance(data, list) else data.get("events", [])

        quarantined = []
        if os.path.exists(MANUAL_QUEUE_PATH):
            with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                qdata = json.load(f)
                quarantined = qdata if isinstance(qdata, list) else qdata.get("quarantinedEvents", [])

        discovery_sources = []
        disc_path = os.path.join(DATA_DIR, "discovery_sources.json")
        if os.path.exists(disc_path):
            try:
                with open(disc_path, "r", encoding="utf-8") as f:
                    discovery_sources = json.load(f).get("sources", [])
            except Exception as e:
                print(f"[WARN] Failed to load discovery sources: {e}")

        from sync_events import VENUE_URLS

        timestamp = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00")
        js_content = f"""// Van50 — Vancouver Events & Outings (Strictly <= $50 CAD)
// AUTO-GENERATED from central data/events.json on {timestamp}
// Single Reference Source Architecture • 0 Client-Side Scraping

const VANCOUVER_EVENTS = {json.dumps(events, indent=2, ensure_ascii=False)};
const MANUAL_REVIEW_QUEUE = {json.dumps(quarantined, indent=2, ensure_ascii=False)};

// Neighborhood List (Multi-selection enabled)
const NEIGHBORHOODS = [
  "Gastown / Chinatown",
  "Mount Pleasant",
  "Commercial Drive",
  "Downtown / West End",
  "Kitsilano",
  "Granville Island",
  "North Shore / Burnaby"
];

// Days of the Week
const DAYS_OF_WEEK = [
  {{ id: "all", label: "All Days", icon: "🗓️" }},
  {{ id: "mon", label: "Mon", full: "Monday" }},
  {{ id: "tue", label: "Tue", full: "Tuesday" }},
  {{ id: "wed", label: "Wed", full: "Wednesday" }},
  {{ id: "thu", label: "Thu", full: "Thursday" }},
  {{ id: "fri", label: "Fri", full: "Friday" }},
  {{ id: "sat", label: "Sat", full: "Saturday" }},
  {{ id: "sun", label: "Sun", full: "Sunday" }},
  {{ id: "daily", label: "Daily Spots", icon: "☀️" }}
];

// Time of Day Starting Slots
const TIME_SLOTS = [
  {{ id: "all", label: "Any Time", icon: "⏰" }},
  {{ id: "early-morning", label: "Early Morning", desc: "Before 12pm", icon: "🌅" }},
  {{ id: "afternoon", label: "Afternoon", desc: "12pm – 5pm", icon: "☀️" }},
  {{ id: "early-evening", label: "Early Evening", desc: "5pm – 8:30pm", icon: "🌆" }},
  {{ id: "late-evening", label: "Late Evening", desc: "8:30pm+", icon: "🌙" }}
];

// Recurrence Frequency Metadata
const FREQUENCIES = [
  {{ id: "all", label: "All Frequencies", icon: "✨" }},
  {{ id: "weekly", label: "Weekly", icon: "🔄", color: "#a855f7" }},
  {{ id: "monthly", label: "Monthly", icon: "📅", color: "#06b6d4" }},
  {{ id: "daily", label: "Daily", icon: "☀️", color: "#f59e0b" }},
  {{ id: "one-off", label: "One-Off", icon: "🎟️", color: "#f43f5e" }},
  {{ id: "seasonal", label: "Seasonal", icon: "🌟", color: "#10b981" }},
  {{ id: "limited-run", label: "Limited Run", icon: "⏳", color: "#10b981" }}
];

// Refined Category Definitions (Split Live Music & Comedy/Shows)
const CATEGORIES = [
  {{ id: "all", label: "All", icon: "✨" }},
  {{ id: "music", label: "Live Music", icon: "🎵" }},
  {{ id: "shows", label: "Comedy & Shows", icon: "🎭" }},
  {{ id: "crafts", label: "Crafts & Studios", icon: "🎨" }},
  {{ id: "cinema", label: "Cinema", icon: "🎬" }},
  {{ id: "arts", label: "Museums & Arts", icon: "🏛️" }},
  {{ id: "outdoors", label: "Walks & Outdoors", icon: "🌲" }},
  {{ id: "activities", label: "Games & Activities", icon: "🎲" }},
  {{ id: "trivia", label: "Drinks & Trivia", icon: "🍻" }}
];

// Curated Venue Homepages Directory
const VENUE_URLS = {json.dumps(VENUE_URLS, indent=2, ensure_ascii=False)};

// Curated Discovery Sources Directory
const DISCOVERY_SOURCES = {json.dumps(discovery_sources, indent=2, ensure_ascii=False)};
"""
        with open(JS_DATA_PATH, "w", encoding="utf-8") as f:
            f.write(js_content)
        print("[OK] Synchronized js/data.js with active catalog.")
    except Exception as e:
        print(f"[ERROR] Failed to regenerate js/data.js: {e}")


class CuratorRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Custom HTTP Request Handler supporting standard file delivery and /api/curator endpoints."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        # Strict Cache-Control
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")

        # Defense-in-Depth Security Headers
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()")
        self.send_header("X-XSS-Protection", "1; mode=block")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: https:; "
            "connect-src 'self'; "
            "frame-ancestors 'none'; "
            "object-src 'none'; "
            "base-uri 'self';"
        )
        super().end_headers()

    def _get_client_ip(self) -> str:
        client_ip = self.headers.get("X-Forwarded-For")
        if client_ip:
            return client_ip.split(",")[0].strip()
        return self.client_address[0] if self.client_address else "127.0.0.1"

    def _apply_cors_headers(self):
        """Restricts CORS to local loopback and authorized host; prevents wildcard origin exposure."""
        origin = self.headers.get("Origin", "")
        if origin and (
            origin.startswith("http://127.0.0.1:") or
            origin.startswith("http://localhost:") or
            origin in {"http://127.0.0.1:8080", "http://localhost:8080"}
        ):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")

    def _send_forbidden(self, message: str = "Access Denied: Protected Resource"):
        """Returns 403 Forbidden with security headers and descriptive error message."""
        response_bytes = message.encode("utf-8")
        self.send_response(403)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

    def list_directory(self, path):
        """Disables directory browsing across the entire server."""
        self._send_forbidden("Access Denied: Directory browsing is disabled.")
        return None

    def _send_json(self, status: int, data: dict):
        response_bytes = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self._apply_cors_headers()
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Curator-Token, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        if getattr(self, "close_connection", False):
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(response_bytes)

    def _check_authenticated(self) -> bool:
        token = self.headers.get("Curator-Token")
        if not token:
            auth_header = self.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header.split(" ", 1)[1].strip()

        if not token:
            return False

        valid, _ = verify_session_token(token)
        return valid

    def do_OPTIONS(self):
        self.send_response(200)
        self._apply_cors_headers()
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Curator-Token, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # 1. API: Check authentication & counts
        if path == "/api/curator/status":
            is_auth = self._check_authenticated()
            q_count = 0
            m_count = 0
            r_count = 0
            if os.path.exists(MANUAL_QUEUE_PATH):
                try:
                    with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                        q_data = json.load(f)
                        raw_q = q_data.get("quarantinedEvents", [])
                        # Strict budget cap: curator only reviews items needing confirmation where price <= 50.0 or unverified
                        q_count = len([
                            x for x in raw_q
                            if float(x.get("attemptedPrice", x.get("price", 0.0))) <= 50.0
                            and not any(k in str(x.get("flagReason", "")).lower() for k in ["strictly exceeds", "exceeds $50", "over-budget"])
                        ])
                except Exception:
                    pass
            if os.path.exists(EVENTS_PATH):
                try:
                    with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                        m_data = json.load(f)
                        m_count = len(m_data.get("events", []))
                except Exception:
                    pass
            if os.path.exists(RULES_PATH):
                try:
                    with open(RULES_PATH, "r", encoding="utf-8") as f:
                        r_data = json.load(f)
                        r_count = (
                            len(r_data.get("vendor_fee_formulas", {})) +
                            len(r_data.get("venue_calendar_deep_links", {})) +
                            len(r_data.get("course_blacklist_patterns", [])) +
                            len(r_data.get("price_override_heuristics", []))
                        )
                except Exception:
                    pass

            a_count = 0
            if os.path.exists(ARCHIVE_PATH):
                try:
                    with open(ARCHIVE_PATH, "r", encoding="utf-8") as f:
                        a_data = json.load(f)
                        arch_events = a_data.get("archivedEvents", [])
                        # Non-budget archived items
                        a_count = len([x for x in arch_events if x.get("reviewStatus") != "denied_auto_budget" and float(x.get("attemptedPrice", x.get("price", 0.0))) <= 50.0])
                except Exception:
                    pass

            inst_count = 0
            if os.path.exists(INSTRUCTIONS_PATH):
                try:
                    with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
                        i_data = json.load(f)
                        inst_count = len([i for i in i_data.get("instructions", []) if i.get("status") == "pending"])
                except Exception:
                    pass

            return self._send_json(200, {
                "server": "Van50 Curator Daemon",
                "authenticated": is_auth,
                "pendingCount": q_count,
                "masterCount": m_count,
                "rulesCount": r_count,
                "archivedCount": a_count,
                "instructionsPendingCount": inst_count,
                "timestamp": datetime.now().isoformat()
            })

        # API: Automation status
        if path == "/api/automation/status":
            return self._send_json(200, get_automation_status())

        # 2. API: Get quarantined events (requires auth)
        if path == "/api/curator/queue":
            if not self._check_authenticated():
                return self._send_json(401, {"error": "Authentication required", "authenticated": False})
            queue_data = {"metadata": {}, "quarantinedEvents": []}
            if os.path.exists(MANUAL_QUEUE_PATH):
                with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                    queue_data = json.load(f)

            # Cross-reference with curator_instructions.json to annotate dealt-with items
            instructions_map = {}
            if os.path.exists(INSTRUCTIONS_PATH):
                try:
                    with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as inf:
                        inst_data = json.load(inf)
                        for inst in inst_data.get("instructions", []):
                            eid = inst.get("eventId")
                            if eid and inst.get("status") != "dismissed":
                                if eid not in instructions_map or inst.get("status") == "pending":
                                    instructions_map[eid] = inst
                except Exception:
                    pass

            # Strict budget cap: exclude any events > $50.00 from curator triage
            filtered_q = []
            for ev in queue_data.get("quarantinedEvents", []):
                try:
                    p = float(ev.get("attemptedPrice", ev.get("price", 0.0)))
                except (ValueError, TypeError):
                    p = 0.0
                r = str(ev.get("flagReason", "")).lower()
                if p > 50.0 or any(k in r for k in ["strictly exceeds", "exceeds $50", "over-budget"]):
                    continue
                filtered_q.append(ev)

            for ev in filtered_q:
                eid = ev.get("id")
                if eid in instructions_map:
                    ev["dealtWith"] = True
                    ev["queuedInstruction"] = instructions_map[eid]
                else:
                    ev["dealtWith"] = False
                    ev["queuedInstruction"] = None

            queue_data["quarantinedEvents"] = filtered_q
            queue_data.setdefault("metadata", {})["pendingCount"] = len(filtered_q)
            return self._send_json(200, queue_data)

        # 3. API: Get learned rules (requires auth)
        if path == "/api/curator/rules":
            if not self._check_authenticated():
                return self._send_json(401, {"error": "Authentication required", "authenticated": False})
            if os.path.exists(RULES_PATH):
                with open(RULES_PATH, "r", encoding="utf-8") as f:
                    return self._send_json(200, json.load(f))
            return self._send_json(200, {})

        # 4. API: Get archived events (requires auth)
        if path == "/api/curator/archived":
            if not self._check_authenticated():
                return self._send_json(401, {"error": "Authentication required", "authenticated": False})
            if os.path.exists(ARCHIVE_PATH):
                with open(ARCHIVE_PATH, "r", encoding="utf-8") as f:
                    arch_full = json.load(f)
                    # Filter out > $50 events so curator never sees them
                    arch_filtered = [
                        x for x in arch_full.get("archivedEvents", [])
                        if float(x.get("attemptedPrice", x.get("price", 0.0))) <= 50.0
                        and x.get("reviewStatus") != "denied_auto_budget"
                    ]
                    arch_full["archivedEvents"] = arch_filtered
                    return self._send_json(200, arch_full)
            return self._send_json(200, {"metadata": {}, "archivedEvents": []})

        # 5. API: Get queued AI instructions (requires auth)
        if path == "/api/curator/instructions":
            if not self._check_authenticated():
                return self._send_json(401, {"error": "Authentication required", "authenticated": False})
            if os.path.exists(INSTRUCTIONS_PATH):
                with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
                    return self._send_json(200, json.load(f))
            return self._send_json(200, {"metadata": {}, "instructions": []})

        # Standard file serving for web UI with path filtering & access control
        # 1. Traversal & boundary check
        rel_path = path.lstrip("/\\")
        full_path = os.path.normpath(os.path.join(BASE_DIR, rel_path))

        try:
            common = os.path.commonpath([BASE_DIR, full_path])
            if common != BASE_DIR:
                return self._send_forbidden("Access Denied: Path traversal is prohibited.")
        except Exception:
            return self._send_forbidden("Access Denied: Invalid path.")

        # 2. Block hidden files and dotfiles (e.g. .env, .git, .curator_secret.json)
        parts = rel_path.replace("\\", "/").split("/")
        for part in parts:
            if part.startswith(".") and part not in {".", ".."}:
                return self._send_forbidden("Access Denied: Protected system file.")

        # 3. Block protected internal directories
        if len(parts) > 0 and parts[0] in BLOCKED_DIRS:
            return self._send_forbidden(f"Access Denied: Directory '{parts[0]}' is protected.")

        # 4. Block direct access to administrative data files (must use authenticated API)
        file_name = os.path.basename(full_path)
        if file_name in BLOCKED_DATA_FILES:
            if not self._check_authenticated():
                return self._send_forbidden("Access Denied: Administrative data requires curator authentication.")

        # 5. Block directory browsing
        if os.path.isdir(full_path):
            index_file = os.path.join(full_path, "index.html")
            if not os.path.exists(index_file):
                return self._send_forbidden("Access Denied: Directory browsing is disabled.")

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        client_ip = self._get_client_ip()

        # Enforce Content-Length checks to prevent memory exhaustion DoS
        content_len_header = self.headers.get("Content-Length")
        if not content_len_header and path.startswith("/api/curator/"):
            return self._send_json(411, {"error": "Length Required"})

        try:
            content_len = int(content_len_header or 0)
        except ValueError:
            return self._send_json(400, {"error": "Invalid Content-Length header"})

        # Limits: 25MB for screenshot uploads (supporting multiple screenshots), 256KB for all other JSON endpoints
        max_bytes = 25 * 1024 * 1024 if path == "/api/curator/instruction" else 256 * 1024
        if content_len > max_bytes:
            self.close_connection = True
            return self._send_json(413, {"error": f"Payload Too Large. Max permitted size is {max_bytes // 1024} KB."})

        try:
            body_raw = self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}"
            payload = json.loads(body_raw)
        except Exception as e:
            return self._send_json(400, {"error": f"Invalid JSON payload: {e}"})

        # 1. API: Authenticate
        if path == "/api/curator/auth":
            password = payload.get("password", "")
            ok, msg, cooldown = verify_curator_password(password, client_ip)
            if ok:
                token = generate_session_token()
                return self._send_json(200, {
                    "success": True,
                    "message": "Authentication successful",
                    "token": token
                })
            else:
                status_code = 429 if cooldown > 0 and "locked" in msg.lower() else 401
                return self._send_json(status_code, {
                    "success": False,
                    "message": msg,
                    "cooldown": cooldown
                })

        # 2. API: Logout & Revoke Session Token
        if path == "/api/curator/logout":
            token = self.headers.get("Curator-Token")
            if not token:
                auth_header = self.headers.get("Authorization", "")
                if auth_header.startswith("Bearer "):
                    token = auth_header.split(" ", 1)[1].strip()
            if token:
                revoke_session_token(token)
            return self._send_json(200, {"success": True, "message": "Session revoked and logged out."})

        # All mutating endpoints strictly require authentication
        if not self._check_authenticated():
            return self._send_json(403, {"error": "Forbidden: Valid Curator-Token required for database mutations"})

        # Sliding window rate limit on mutating endpoints
        if path in {"/api/curator/approve", "/api/curator/reject", "/api/curator/rules", "/api/curator/instruction", "/api/curator/dismiss_instruction"}:
            if not check_mutating_rate_limit(client_ip):
                return self._send_json(429, {"error": "Rate limit exceeded: Too many mutating actions. Please wait a minute."})

        # 2. API: Approve event & promote to master list
        if path == "/api/curator/approve":
            event_data = payload.get("event")
            if not event_data or not event_data.get("id"):
                return self._send_json(400, {"error": "Missing event data or event id"})

            ev_id = event_data["id"]
            price = float(event_data.get("price", 0.0))
            if price > 50.0:
                return self._send_json(400, {"error": f"Price ${price:.2f} strictly exceeds <= $50.00 CAD budget limit."})

            # Create backup snapshot before writing
            create_backup_snapshot()

            # Sanitize all string fields against stored XSS
            event_data["title"] = sanitize_text(str(event_data.get("title", "")))
            event_data["venue"] = sanitize_text(str(event_data.get("venue", "")))
            event_data["description"] = sanitize_text(str(event_data.get("description", "")))
            event_data["neighborhood"] = sanitize_text(str(event_data.get("neighborhood", "")))
            category = sanitize_text(str(event_data.get("category") or "shows"))
            source_url = sanitize_text(str(event_data.get("websiteUrl") or event_data.get("url") or ""))

            curator_note = sanitize_text(payload.get("curatorNote") or event_data.get("curatorNote") or "Approved by curator in Van50 Curator Studio.")
            raw_price_label = sanitize_text(event_data.get("priceLabel") or "")
            if not raw_price_label or raw_price_label == "$0.00 door" or (price == 0 and "$0.00" in raw_price_label):
                price_label = "Free ($0)" if price == 0 else f"${price:.2f} CAD"
            else:
                price_label = raw_price_label

            # Ensure checkout verification metadata is set
            event_data["checkoutVerification"] = {
                "status": "verified_live",
                "method": "manual_curator_review",
                "verifiedTotal": price,
                "feeBreakdown": event_data.get("feeBreakdown") or f"${price:.2f} CAD verified via Curator Studio review",
                "verifiedAt": datetime.now(timezone.utc).isoformat(),
                "details": f"Approved by curator in Van50 Curator Studio. Note: {curator_note}",
                "curatorSnapshot": {
                    "approvedPrice": price,
                    "approvedPriceLabel": price_label,
                    "approvedCategory": category,
                    "curatorNote": curator_note,
                    "approvedAt": datetime.now(timezone.utc).isoformat(),
                    "sourceUrl": source_url
                }
            }
            event_data["curatorNote"] = curator_note
            event_data["category"] = category
            event_data["isSoldOut"] = bool(event_data.get("isSoldOut", False))

            # 1. Add/update in data/events.json
            with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                db = json.load(f)
            events_list = db.get("events", [])
            # Deduplicate by ID
            events_list = [e for e in events_list if e["id"] != ev_id]
            events_list.append(event_data)
            db["events"] = events_list
            db["metadata"]["totalEvents"] = len(events_list)
            db["metadata"]["updatedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00")
            with open(EVENTS_PATH, "w", encoding="utf-8") as f:
                json.dump(db, f, indent=2, ensure_ascii=False)

            # 2. Remove from data/manual_review_queue.json
            with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                q_data = json.load(f)
            q_list = q_data.get("quarantinedEvents", [])
            q_list = [q for q in q_list if q["id"] != ev_id]
            q_data["quarantinedEvents"] = q_list
            q_data["metadata"]["pendingCount"] = len(q_list)
            q_data["metadata"]["updatedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00")
            with open(MANUAL_QUEUE_PATH, "w", encoding="utf-8") as f:
                json.dump(q_data, f, indent=2, ensure_ascii=False)

            # 3. Record positive reinforcement learning signal in data/curator_instructions.json
            try:
                if os.path.exists(INSTRUCTIONS_PATH):
                    with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as inf:
                        inst_db = json.load(inf)
                else:
                    inst_db = {"metadata": {}, "instructions": []}
                instructions_list = inst_db.setdefault("instructions", [])
                
                # Check if this exact event already has a pending reinforcement entry
                existing_learn = next((i for i in instructions_list if i.get("eventId") == ev_id and i.get("status") == "pending" and i.get("type") == "reinforcement_learning"), None)
                if not existing_learn:
                    learning_entry = {
                        "id": f"learn_{int(time.time() * 1000)}",
                        "createdAt": datetime.now(timezone.utc).isoformat(),
                        "status": "pending",
                        "type": "reinforcement_learning",
                        "actionTaken": "approved_as_is",
                        "eventId": ev_id,
                        "eventTitle": event_data.get("title", ""),
                        "venueName": event_data.get("venue", ""),
                        "sourceUrl": event_data.get("websiteUrl") or event_data.get("url") or "",
                        "approvedPrice": price,
                        "instructionText": f"Approved As-Is by curator. Verified price (${price:.2f} CAD) and category '{category}'. Reinforce crawler accuracy for {event_data.get('venue', 'this venue')}.",
                        "screenshotPath": None,
                        "curatorNote": curator_note,
                        "targetScraperOrEngine": event_data.get("venue", "UniversalCrawler")
                    }
                    instructions_list.append(learning_entry)
                    inst_db.setdefault("metadata", {})["pendingCount"] = len([i for i in instructions_list if i.get("status") == "pending"])
                    inst_db["metadata"]["updatedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00")
                    with open(INSTRUCTIONS_PATH, "w", encoding="utf-8") as inf:
                        json.dump(inst_db, inf, indent=2, ensure_ascii=False)
            except Exception as e:
                print(f"[WARN] Failed to record learning signal on approve: {e}")

            # 4. Synchronize js/data.js
            sync_js_data_file()

            return self._send_json(200, {
                "success": True,
                "message": f"Successfully approved '{event_data.get('title')}' and queued for AI learning.",
                "remainingQuarantine": len(q_list),
                "totalMasterEvents": len(events_list)
            })

        # 3. API: Reject event & archive
        if path == "/api/curator/reject":
            ev_id = payload.get("id")
            reason = payload.get("reason", "Dismissed by curator")
            if not ev_id:
                return self._send_json(400, {"error": "Missing event id"})

            # Remove from manual review queue
            with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                q_data = json.load(f)
            q_list = q_data.get("quarantinedEvents", [])
            rejected_item = next((q for q in q_list if q["id"] == ev_id), None)
            q_list = [q for q in q_list if q["id"] != ev_id]
            q_data["quarantinedEvents"] = q_list
            q_data["metadata"]["pendingCount"] = len(q_list)
            with open(MANUAL_QUEUE_PATH, "w", encoding="utf-8") as f:
                json.dump(q_data, f, indent=2, ensure_ascii=False)

            # Save to archived_events.json
            os.makedirs(os.path.dirname(ARCHIVE_PATH), exist_ok=True)
            arch_data = {"metadata": {"updatedAt": datetime.now().isoformat()}, "archivedEvents": []}
            if os.path.exists(ARCHIVE_PATH):
                try:
                    with open(ARCHIVE_PATH, "r", encoding="utf-8") as f:
                        arch_data = json.load(f)
                except Exception:
                    pass
            if rejected_item:
                rejected_item["archivedReason"] = reason
                rejected_item["archivedAt"] = datetime.now().isoformat()
                arch_data["archivedEvents"].append(rejected_item)
                with open(ARCHIVE_PATH, "w", encoding="utf-8") as f:
                    json.dump(arch_data, f, indent=2, ensure_ascii=False)

            # Record in learned rules archived IDs
            try:
                with open(RULES_PATH, "r", encoding="utf-8") as f:
                    r_data = json.load(f)
                if ev_id not in r_data.setdefault("archived_event_ids", []):
                    r_data["archived_event_ids"].append(ev_id)
                    with open(RULES_PATH, "w", encoding="utf-8") as f:
                        json.dump(r_data, f, indent=2, ensure_ascii=False)
            except Exception:
                pass

            sync_js_data_file()

            return self._send_json(200, {
                "success": True,
                "message": f"Quarantined event '{ev_id}' dismissed and moved to archive.",
                "remainingQuarantine": len(q_list)
            })

        # 4. API: Learn rule
        if path == "/api/curator/learn-rule":
            rule_type = payload.get("ruleType")
            rule_key = payload.get("key")
            rule_value = payload.get("value")

            if not rule_type or not rule_value:
                return self._send_json(400, {"error": "Missing ruleType or ruleValue"})

            with open(RULES_PATH, "r", encoding="utf-8") as f:
                rules = json.load(f)

            if rule_type in ["vendor_fee_formulas", "venue_calendar_deep_links"]:
                if not rule_key:
                    return self._send_json(400, {"error": f"ruleKey required for {rule_type}"})
                rules.setdefault(rule_type, {})[rule_key] = rule_value
            elif rule_type in ["course_blacklist_patterns", "archived_event_ids"]:
                val = str(rule_value).lower().strip()
                if val not in rules.setdefault(rule_type, []):
                    rules[rule_type].append(val)
            elif rule_type == "price_override_heuristics":
                rules.setdefault("price_override_heuristics", []).append(rule_value)

            rules["metadata"]["updatedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00")
            with open(RULES_PATH, "w", encoding="utf-8") as f:
                json.dump(rules, f, indent=2, ensure_ascii=False)

            return self._send_json(200, {
                "success": True,
                "message": f"Successfully registered learned rule in '{rule_type}'.",
                "rules": rules
            })

        # 5. API: Instruct AI Assistant (Plain English & Screenshot Queue)
        if path == "/api/curator/instruction":
            instruction_text = (payload.get("instructionText") or "").strip()
            if not instruction_text:
                return self._send_json(400, {"error": "Missing instructionText. Please provide plain-English instructions."})

            event_id = payload.get("eventId", "")
            action = payload.get("action", "queue_only")

            # Handle multiple screenshots or single screenshot (Base64 data URI or raw Base64)
            os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
            screenshot_rel_paths = []

            raw_shots = list(payload.get("screenshotsBase64") or [])
            single_shot = payload.get("screenshotBase64")
            if single_shot and single_shot not in raw_shots:
                raw_shots.insert(0, single_shot)

            ts_base = int(time.time() * 1000)
            for idx, shot_b64 in enumerate(raw_shots):
                if not shot_b64 or not isinstance(shot_b64, str):
                    continue
                if "," in shot_b64:
                    shot_b64 = shot_b64.split(",", 1)[1]
                try:
                    img_data = base64.b64decode(shot_b64)
                    file_name = f"screenshot_{ts_base}_{idx}.png"
                    full_img_path = os.path.join(SCREENSHOTS_DIR, file_name)
                    with open(full_img_path, "wb") as f_img:
                        f_img.write(img_data)
                    screenshot_rel_paths.append(f"data/curator_screenshots/{file_name}")
                except Exception as e:
                    print(f"[WARN] Failed to decode/save screenshot #{idx}: {e}")

            primary_shot = screenshot_rel_paths[0] if screenshot_rel_paths else None

            inst_id = f"inst_{ts_base}"
            instruction_record = {
                "id": inst_id,
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "status": "pending",
                "eventId": event_id,
                "eventTitle": payload.get("eventTitle", ""),
                "venueName": payload.get("venueName", ""),
                "sourceUrl": payload.get("sourceUrl", ""),
                "instructionText": instruction_text,
                "screenshotPath": primary_shot,
                "screenshotPaths": screenshot_rel_paths,
                "hasScreenshot": len(screenshot_rel_paths) > 0,
                "screenshotCount": len(screenshot_rel_paths),
                "actionTaken": action,
                "curatorNote": payload.get("curatorNote", ""),
                "targetScraperOrEngine": payload.get("venueName") or "UniversalVenueCrawler"
            }

            # Save to curator_instructions.json
            os.makedirs(DATA_DIR, exist_ok=True)
            instructions_db = {
                "metadata": {
                    "version": "1.0.0",
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                    "pendingCount": 0,
                    "description": "Queued plain-English instructions and screenshots for AI scraper enhancements."
                },
                "instructions": []
            }
            if os.path.exists(INSTRUCTIONS_PATH):
                try:
                    with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
                        instructions_db = json.load(f)
                except Exception:
                    pass

            instructions_db.setdefault("instructions", []).append(instruction_record)
            pending_count = len([i for i in instructions_db["instructions"] if i.get("status") == "pending"])
            instructions_db["metadata"]["pendingCount"] = pending_count
            instructions_db["metadata"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
            with open(INSTRUCTIONS_PATH, "w", encoding="utf-8") as f:
                json.dump(instructions_db, f, indent=2, ensure_ascii=False)

            approval_msg = ""
            if action == "queue_and_approve":
                event_to_approve = None
                if os.path.exists(MANUAL_QUEUE_PATH):
                    with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                        q_data = json.load(f)
                    q_list = q_data.get("quarantinedEvents", [])
                    event_to_approve = next((q for q in q_list if q.get("id") == event_id), None)
                if not event_to_approve and payload.get("event"):
                    event_to_approve = payload.get("event")

                if event_to_approve:
                    price = float(payload.get("approvedPrice", event_to_approve.get("price", 0.0)))
                    if price > 50.0:
                        return self._send_json(400, {"error": f"Approved price ${price:.2f} CAD exceeds $50.00 CAD budget limit."})

                    category = payload.get("approvedCategory") or event_to_approve.get("category", "shows")
                    raw_price_label = payload.get("priceLabel") or ""
                    if not raw_price_label or raw_price_label == "$0.00 door" or (price == 0 and "$0.00" in raw_price_label):
                        price_label = "Free ($0)" if price == 0 else f"${price:.2f} CAD"
                    else:
                        price_label = raw_price_label

                    create_backup_snapshot()

                    note = payload.get("curatorNote", "") or event_to_approve.get("curatorNote", "")
                    source_url = payload.get("sourceUrl", "") or event_to_approve.get("sourceUrl", "") or event_to_approve.get("ticketUrl", "")

                    event_to_approve["price"] = price
                    event_to_approve["category"] = category
                    event_to_approve["curatorNote"] = note
                    event_to_approve["checkoutVerification"] = {
                        "status": "verified_live",
                        "method": "manual_curator_review",
                        "verifiedTotal": price,
                        "feeBreakdown": f"${price:.2f} CAD verified via Curator Studio review with AI instruction",
                        "verifiedAt": datetime.now(timezone.utc).isoformat(),
                        "details": f"Approved by curator with AI instruction. Note: {note}",
                        "curatorSnapshot": {
                            "approvedPrice": price,
                            "approvedPriceLabel": price_label,
                            "approvedCategory": category,
                            "curatorNote": note,
                            "approvedAt": datetime.now(timezone.utc).isoformat(),
                            "sourceUrl": source_url
                        }
                    }
                    event_to_approve["isSoldOut"] = bool(event_to_approve.get("isSoldOut", False))

                    # 1. Add/update in events.json
                    with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                        db = json.load(f)
                    events_list = [e for e in db.get("events", []) if e.get("id") != event_id]
                    events_list.append(event_to_approve)
                    db["events"] = events_list
                    db["metadata"]["totalEvents"] = len(events_list)
                    db["metadata"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
                    with open(EVENTS_PATH, "w", encoding="utf-8") as f:
                        json.dump(db, f, indent=2, ensure_ascii=False)

                    # 2. Remove from manual_review_queue.json
                    if os.path.exists(MANUAL_QUEUE_PATH):
                        with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                            q_data = json.load(f)
                        q_list = [q for q in q_data.get("quarantinedEvents", []) if q.get("id") != event_id]
                        q_data["quarantinedEvents"] = q_list
                        q_data["metadata"]["pendingCount"] = len(q_list)
                        with open(MANUAL_QUEUE_PATH, "w", encoding="utf-8") as f:
                            json.dump(q_data, f, indent=2, ensure_ascii=False)

                    sync_js_data_file()
                    approval_msg = f" Event '{event_to_approve.get('title')}' approved and promoted to catalog."

            elif action in ("queue_and_dismiss", "queue_and_reject"):
                event_to_dismiss = None
                if os.path.exists(MANUAL_QUEUE_PATH):
                    with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                        q_data = json.load(f)
                    q_list = q_data.get("quarantinedEvents", [])
                    event_to_dismiss = next((q for q in q_list if q.get("id") == event_id), None)
                    new_q = [q for q in q_list if q.get("id") != event_id]
                    q_data["quarantinedEvents"] = new_q
                    q_data["metadata"]["pendingCount"] = len(new_q)
                    with open(MANUAL_QUEUE_PATH, "w", encoding="utf-8") as f:
                        json.dump(q_data, f, indent=2, ensure_ascii=False)

                if event_to_dismiss:
                    create_backup_snapshot()
                    archive_db = {"metadata": {}, "archivedEvents": []}
                    if os.path.exists(ARCHIVE_PATH):
                        try:
                            with open(ARCHIVE_PATH, "r", encoding="utf-8") as f:
                                archive_db = json.load(f)
                        except Exception:
                            pass
                    archived_item = {
                        **event_to_dismiss,
                        "archivedAt": datetime.now(timezone.utc).isoformat(),
                        "reviewStatus": "dismissed_by_curator",
                        "archivedReason": f"Dismissed with AI instruction: {instruction_text[:120]}",
                        "curatorInstructionId": inst_id
                    }
                    archive_db.setdefault("archivedEvents", []).append(archived_item)
                    archive_db["metadata"]["totalArchived"] = len(archive_db["archivedEvents"])
                    archive_db["metadata"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
                    with open(ARCHIVE_PATH, "w", encoding="utf-8") as f:
                        json.dump(archive_db, f, indent=2, ensure_ascii=False)

                    if os.path.exists(EVENTS_PATH):
                        with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                            db = json.load(f)
                        db_events = [e for e in db.get("events", []) if e.get("id") != event_id]
                        if len(db_events) != len(db.get("events", [])):
                            db["events"] = db_events
                            db["metadata"]["totalEvents"] = len(db_events)
                            with open(EVENTS_PATH, "w", encoding="utf-8") as f:
                                json.dump(db, f, indent=2, ensure_ascii=False)

                    sync_js_data_file()
                    approval_msg = f" Event '{event_to_dismiss.get('title')}' dismissed and moved to archive."

            return self._send_json(200, {
                "success": True,
                "message": f"Instruction queued successfully for AI Assistant.{approval_msg}",
                "instructionId": inst_id,
                "action": action,
                "screenshotPath": primary_shot,
                "screenshotPaths": screenshot_rel_paths,
                "pendingInstructions": pending_count
            })

        # 6. API: Safe rollback
        if path == "/api/curator/rollback":
            backups = sorted([os.path.join(BACKUP_DIR, f) for f in os.listdir(BACKUP_DIR) if f.startswith("events_")])
            if not backups:
                return self._send_json(404, {"error": "No backup snapshots available for rollback."})
            latest = backups[-1]
            shutil.copy2(latest, EVENTS_PATH)
            sync_js_data_file()
            return self._send_json(200, {
                "success": True,
                "message": f"Successfully rolled back catalog to snapshot: {os.path.basename(latest)}"
            })

        # 7. API: Trigger full automation pipeline
        if path == "/api/automation/trigger":
            if not self._check_authenticated():
                return self._send_json(403, {"error": "Forbidden: Valid Curator-Token required to trigger daily automation"})

            cur_status = get_automation_status()
            if cur_status.get("status") == "running":
                return self._send_json(409, {
                    "error": "Daily discovery pipeline is already actively running.",
                    "status": cur_status
                })

            def _async_pipeline_worker():
                try:
                    run_full_daily_pipeline()
                    sync_js_data_file()
                except Exception as ex:
                    print(f"[AUTOMATION TRIGGER ERROR] {ex}")

            t = threading.Thread(target=_async_pipeline_worker, daemon=True)
            t.start()

            return self._send_json(200, {
                "success": True,
                "message": "Autonomous daily discovery pipeline triggered in background.",
                "timestamp": datetime.now().isoformat()
            })

        # 8. API: Toggle automation active state
        if path == "/api/automation/toggle":
            if not self._check_authenticated():
                return self._send_json(403, {"error": "Forbidden: Valid Curator-Token required to toggle automation"})

            cur_status = get_automation_status()
            new_state = not cur_status.get("automationEnabled", True)
            update_automation_status({"automationEnabled": new_state})
            return self._send_json(200, {
                "success": True,
                "automationEnabled": new_state,
                "message": f"Daily automation scheduler {'enabled' if new_state else 'paused'}."
            })

        return self._send_json(404, {"error": "Endpoint not found"})


def _curator_daemon_scheduler_loop(target_time_str: str = "04:00"):
    """Background scheduler thread running inside curator_server."""
    while True:
        try:
            status = get_automation_status()
            if status.get("automationEnabled", True):
                now = datetime.now()
                current_time_hm = now.strftime("%H:%M")
                last_run_iso = status.get("lastRunAt")
                already_ran_today = False
                if last_run_iso:
                    try:
                        last_dt = datetime.fromisoformat(last_run_iso)
                        if last_dt.date() == now.date() and (now - last_dt).total_seconds() < 3600:
                            already_ran_today = True
                    except Exception:
                        pass

                if current_time_hm == target_time_str and not already_ran_today and status.get("status") != "running":
                    print(f"[CURATOR SCHEDULER] Triggering scheduled daily discovery at {current_time_hm}...")
                    run_full_daily_pipeline(run_at_time=target_time_str)
                    sync_js_data_file()
        except Exception as e:
            print(f"[CURATOR SCHEDULER ERROR] {e}")
        time.sleep(30)


def run_server(port=PORT):
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    scheduler_thread = threading.Thread(target=_curator_daemon_scheduler_loop, daemon=True)
    scheduler_thread.start()
    with socketserver.ThreadingTCPServer(("0.0.0.0", port), CuratorRequestHandler) as httpd:
        print(f"[CURATOR SERVER] Listening on http://127.0.0.1:{port}/")
        print(f"[CURATOR SERVER] Curator Studio: http://127.0.0.1:{port}/curator.html")
        print(f"[CURATOR SERVER] Daily Automation Scheduler active (Target: 04:00 AM)")
        httpd.serve_forever()


if __name__ == "__main__":
    p = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    run_server(p)
