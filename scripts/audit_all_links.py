#!/usr/bin/env python3
"""
Van50 Autonomous Link & Content Health Auditor
Audits all event card links for:
- Dead URLs (HTTP 404, 500, DNS/connection failures)
- Soft 404s (HTTP 200 responses where page content says 'This event has ended', 'Page not found', etc.)
- Expired single-concert ticket deep links
- Domain redirects losing event context
- Known bot-protected endpoints (Resident Advisor, Ticketmaster, Vancouver.ca, VPL)

Integrated directly into the 4:00 AM Daily Automation Pipeline.
"""

from __future__ import annotations
import os
import sys
import re
import json
import time
import shutil
import urllib.request
import urllib.error
from urllib.parse import urlparse
import concurrent.futures
import threading
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional, Tuple

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
ARCHIVE_PATH = os.path.join(DATA_DIR, "archived_events.json")
RULES_PATH = os.path.join(DATA_DIR, "curator_learned_rules.json")
LOGS_DIR = os.path.join(DATA_DIR, "automation_logs")
AUDIT_REPORT_PATH = os.path.join(LOGS_DIR, "link_audit_latest.json")

sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from universal_link_hunter import verify_event_on_page, AutonomousDeepLinkHunter

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}

KNOWN_BOT_SHIELDED_DOMAINS = {
    'ra.co', 'residentadvisor.net', 'www.ra.co',
    'ticketmaster.ca', 'www.ticketmaster.ca', 'ticketmaster.com', 'www.ticketmaster.com',
    'livenation.com', 'www.livenation.com',
    'vancouver.ca', 'www.vancouver.ca',
    'vpl.ca', 'www.vpl.ca'
}

SOFT_404_PATTERNS = [
    r'404\s*[-–—|:]*\s*not\s*found',
    r'page\s*not\s*found',
    r'we\s*can[\'’]t\s*(?:seem\s*to\s*)?find\s*(?:the|that|what)',
    r'couldn[\'’]t\s*find\s*(?:the|that|what|this\s*page)',
    r'this\s*event\s*(?:is\s*no\s*longer\s*available|has\s*ended|cannot\s*be\s*found|is\s*not\s*available)',
    r'event\s*not\s*found',
    r'oops[!,.]*\s*that\s*page\s*can[\'’]t\s*be\s*found',
    r'the\s*page\s*you\s*(?:are\s*looking\s*for|requested)\s*(?:does\s*not\s*exist|could\s*not\s*be\s*found|cannot\s*be\s*found)',
    r'error\s*404',
    r'nothing\s*found',
    r'whoops[!,.]*\s*(?:this|we|there)',
    r'sorry[!,.]*\s*we\s*can[\'’]t\s*find',
    r'tickets\s*are\s*no\s*longer\s*on\s*sale',
    r'this\s*listing\s*has\s*expired',
    r'this\s*page\s*doesn[\'’]t\s*exist',
    r'page\s*doesn[\'’]t\s*exist'
]


class DomainRateLimiter:
    """
    Enforces per-domain concurrency serialization (max 1 concurrent request per domain)
    and polite spacing delay to protect against Cloudflare IP blocks.
    """
    def __init__(self, default_delay: float = 0.5, civic_delay: float = 1.5):
        self.default_delay = default_delay
        self.civic_delay = civic_delay
        self._locks = {}
        self._last_req = {}
        self._global_lock = threading.Lock()

    def get_lock_and_delay(self, domain: str):
        with self._global_lock:
            if domain not in self._locks:
                self._locks[domain] = threading.Lock()
                self._last_req[domain] = 0.0
            lock = self._locks[domain]
            delay = self.civic_delay if any(c in domain for c in ['vancouver.ca', 'vpl.ca', 'cnv.org', 'ra.co', 'ticketmaster']) else self.default_delay
        return lock, delay

    def acquire(self, domain: str):
        lock, delay = self.get_lock_and_delay(domain)
        lock.acquire()
        now = time.time()
        with self._global_lock:
            last = self._last_req.get(domain, 0.0)
            elapsed = now - last
            if elapsed < delay:
                time.sleep(delay - elapsed)
            self._last_req[domain] = time.time()

    def release(self, domain: str):
        with self._global_lock:
            lock = self._locks.get(domain)
        if lock and lock.locked():
            lock.release()

DOMAIN_LIMITER = DomainRateLimiter()


def check_event_link(event: Dict[str, Any]) -> Dict[str, Any]:
    """Inspects a single event card URL for accessibility and soft-404 content."""
    event_id = event.get('id', '')
    title = event.get('title', '')
    venue = event.get('venue', '')
    url = event.get('websiteUrl') or event.get('url') or ''
    
    result = {
        'id': event_id,
        'title': title,
        'venue': venue,
        'url': url,
        'statusCode': None,
        'finalUrl': None,
        'pageTitle': '',
        'isHealthy': False,
        'isBotShielded': False,
        'isDead': False,
        'isSoft404': False,
        'isRedirectedToHome': False,
        'failureReason': None,
        'error': None
    }
    
    if not url:
        result['isDead'] = True
        result['failureReason'] = 'Missing websiteUrl in event card'
        return result

    domain = urlparse(url).netloc.lower()
    is_bot_shielded = domain in KNOWN_BOT_SHIELDED_DOMAINS

    DOMAIN_LIMITER.acquire(domain)
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=12) as resp:
            status = resp.status
            result['statusCode'] = status
            result['finalUrl'] = resp.geturl()
            
            raw_bytes = resp.read()
            raw_text = raw_bytes.decode('utf-8', errors='replace')
            
            # Extract page title
            title_m = re.search(r'<title[^>]*>(.*?)</title>', raw_text, re.IGNORECASE | re.DOTALL)
            if title_m:
                result['pageTitle'] = re.sub(r'\s+', ' ', title_m.group(1)).strip()
            
            # Check redirect to bare homepage
            orig_p = urlparse(url)
            final_p = urlparse(result['finalUrl'])
            if orig_p.path and orig_p.path not in ('', '/') and final_p.path in ('', '/'):
                result['isRedirectedToHome'] = True

            # Soft 404 check: <title>
            pt_lower = result['pageTitle'].lower()
            if any(term in pt_lower for term in ['404', 'not found', 'page not found', 'error 404', 'does not exist']):
                result['isSoft404'] = True
                result['failureReason'] = f"Page title indicates missing page: '{result['pageTitle']}'"

            # Soft 404 check: Headings
            if not result['isSoft404']:
                headings = re.findall(r'<h[12][^>]*>(.*?)</h[12]>', raw_text, re.IGNORECASE | re.DOTALL)
                for h in headings:
                    clean_h = re.sub(r'<[^>]+>', '', h).strip().lower()
                    for pat in SOFT_404_PATTERNS:
                        if re.search(pat, clean_h):
                            result['isSoft404'] = True
                            result['failureReason'] = f"Page heading indicates soft 404: '{clean_h}'"
                            break
                    if result['isSoft404']:
                        break

            # Soft 404 check: Body text
            if not result['isSoft404']:
                clean_b = re.sub(r'<script[^>]*>.*?</script>', ' ', raw_text, flags=re.DOTALL | re.IGNORECASE)
                clean_b = re.sub(r'<style[^>]*>.*?</style>', ' ', clean_b, flags=re.DOTALL | re.IGNORECASE)
                clean_b = re.sub(r'<[^>]+>', ' ', clean_b)
                clean_b = re.sub(r'\s+', ' ', clean_b).strip()
                
                for pat in SOFT_404_PATTERNS[:8]:
                    m = re.search(pat, clean_b, re.IGNORECASE)
                    if m:
                        snippet = clean_b[max(0, m.start()-25):min(len(clean_b), m.end()+45)]
                        result['isSoft404'] = True
                        result['failureReason'] = f"Page content indicates event ended or 404: '...{snippet}...'"
                        break

            if not result['isSoft404']:
                # Affirmative Live Semantic Grounding Verification
                sem_res = verify_event_on_page(event, result['finalUrl'] or url, raw_text)
                if sem_res.get('is_verified'):
                    result['isHealthy'] = True
                    result['semanticVerification'] = sem_res
                else:
                    # Semantic grounding failed! Attempt Autonomous Hunt to auto-heal
                    hunt_res = AutonomousDeepLinkHunter.hunt(event, result['finalUrl'] or url)
                    if hunt_res.get("resolved"):
                        upgraded_url = hunt_res["deepUrl"]
                        hunt_sem = verify_event_on_page(event, upgraded_url)
                        if hunt_sem.get('is_verified'):
                            result['isHealthy'] = True
                            result['upgradedUrl'] = upgraded_url
                            result['semanticVerification'] = hunt_sem
                        else:
                            result['isDead'] = True
                            result['isSemanticFailure'] = True
                            result['failureReason'] = f"Semantic Grounding Failed: {sem_res['reason']}"
                    else:
                        result['isDead'] = True
                        result['isSemanticFailure'] = True
                        result['failureReason'] = f"Semantic Grounding Failed: {sem_res['reason']}"

    except urllib.error.HTTPError as e:
        result['statusCode'] = e.code
        result['error'] = f"HTTP {e.code}: {e.reason}"
        if is_bot_shielded and e.code in [401, 403]:
            sem_res = verify_event_on_page(event, url)
            if sem_res.get('is_verified'):
                result['isBotShielded'] = True
                result['isHealthy'] = True
                result['semanticVerification'] = sem_res
            else:
                result['isDead'] = True
                result['isSemanticFailure'] = True
                result['failureReason'] = f"Bot-protected link lacks event slug verification: {sem_res['reason']}"
        else:
            result['isDead'] = True
            result['failureReason'] = f"HTTP error {e.code} ({e.reason})"

    except urllib.error.URLError as e:
        result['isDead'] = True
        result['error'] = f"URLError: {e.reason}"
        result['failureReason'] = f"Failed to connect: {e.reason}"
    except Exception as e:
        result['isDead'] = True
        result['error'] = f"Exception: {type(e).__name__}: {str(e)}"
        result['failureReason'] = f"Request exception: {str(e)}"
    finally:
        DOMAIN_LIMITER.release(domain)

    return result


def is_event_concluded(event: Dict[str, Any], ref_dt: Optional[datetime] = None) -> Tuple[bool, str]:
    """
    Determines whether an event has already concluded based on dates, schedule, or ended signals.
    Returns (is_concluded, reason).
    """
    if ref_dt is None:
        ref_dt = datetime.now(timezone.utc)

    # 1. Explicit endIso timestamp check
    end_iso = event.get('endIso')
    if end_iso and isinstance(end_iso, str):
        try:
            end_dt = datetime.fromisoformat(end_iso)
            if end_dt.tzinfo is None:
                end_dt = end_dt.replace(tzinfo=timezone.utc)
            if end_dt < ref_dt:
                return True, f"Scheduled run ended on {end_iso[:10]}"
        except Exception:
            pass

    # 2. Confirmed dates list check (e.g. ['2026-09-10', ..., '2026-09-20'])
    confirmed_dates = event.get('confirmedDates')
    if isinstance(confirmed_dates, list) and len(confirmed_dates) > 0:
        valid_dates = [d for d in confirmed_dates if isinstance(d, str) and re.match(r'^\d{4}-\d{2}-\d{2}', d)]
        if valid_dates:
            latest_date_str = max(valid_dates)[:10]
            try:
                latest_dt = datetime.fromisoformat(latest_date_str).replace(tzinfo=timezone.utc, hour=23, minute=59, second=59)
                if latest_dt < ref_dt:
                    return True, f"All confirmed show dates concluded (latest: {latest_date_str})"
            except Exception:
                pass

    # 3. Non-recurring / one-off events with startIso
    freq = str(event.get('frequency', '')).lower()
    is_daily = event.get('isDaily', False) or freq in ('daily', 'weekly', 'monthly')
    start_iso = event.get('startIso')
    if not is_daily and start_iso and isinstance(start_iso, str):
        try:
            start_dt = datetime.fromisoformat(start_iso)
            if start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=timezone.utc)
            if (start_dt + timedelta(hours=24)) < ref_dt:
                return True, f"One-off performance concluded ({start_iso[:10]})"
        except Exception:
            pass

    return False, ""


def run_link_health_audit(
    events: Optional[List[Dict[str, Any]]] = None,
    auto_quarantine: bool = True,
    log_path: Optional[str] = None,
    max_workers: int = 6
) -> Dict[str, Any]:
    """
    Executes a comprehensive health audit across all catalog event links.
    Detects 404s, soft 404s, and expired events.
    Optionally quarantines broken links to protect public catalog quality.
    """
    start_time = time.time()
    os.makedirs(LOGS_DIR, exist_ok=True)

    def log(msg: str):
        print(msg)
        if log_path:
            try:
                with open(log_path, "a", encoding="utf-8") as f:
                    f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
            except Exception:
                pass

    if events is None:
        if not os.path.exists(EVENTS_PATH):
            log(f"[LINK AUDIT ERROR] {EVENTS_PATH} not found.")
            return {"totalChecked": 0, "healthyCount": 0, "botProtectedCount": 0, "deadCount": 0, "soft404Count": 0, "issues": []}
        try:
            with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                d = json.load(f)
                events = d.get("events", []) if isinstance(d, dict) else d
        except Exception as e:
            log(f"[LINK AUDIT ERROR] Failed reading events: {e}")
            return {"totalChecked": 0, "healthyCount": 0, "botProtectedCount": 0, "deadCount": 0, "soft404Count": 0, "issues": []}

    log(f"[LINK AUDIT] Commencing autonomous health audit across {len(events)} cards with {max_workers} workers...")

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_ev = {executor.submit(check_event_link, ev): ev for ev in events}
        for future in concurrent.futures.as_completed(future_to_ev):
            res = future.result()
            results.append(res)

    dead_links = [r for r in results if r['isDead']]
    soft_404s = [r for r in results if r['isSoft404']]
    bot_shielded = [r for r in results if r['isBotShielded']]
    healthy_links = [r for r in results if r['isHealthy'] and not r['isBotShielded']]
    issues = dead_links + soft_404s

    log(f"[LINK AUDIT SUMMARY] Total: {len(results)} | Healthy: {len(healthy_links)} | Bot-Shielded Verified: {len(bot_shielded)} | Dead: {len(dead_links)} | Soft 404s: {len(soft_404s)}")

    quarantined_count = 0
    auto_archived_count = 0
    swept_from_queue_count = 0

    if auto_quarantine:
        now_dt = datetime.now(timezone.utc)
        now_iso = now_dt.isoformat()
        problem_ids = {i['id'] for i in issues if i.get('id')}
        
        # Load existing review queue
        queue_data = {"metadata": {"version": "1.0.0"}, "quarantinedEvents": [], "pendingCount": 0}
        if os.path.exists(QUEUE_PATH):
            try:
                with open(QUEUE_PATH, "r", encoding="utf-8") as f:
                    queue_data = json.load(f)
            except Exception:
                pass
                
        q_events = queue_data.get("quarantinedEvents", [])
        existing_q_ids = {q.get("id") for q in q_events}

        # Load existing archive
        archive_data = {"metadata": {"version": "1.0.0"}, "archivedEvents": [], "totalArchived": 0}
        if os.path.exists(ARCHIVE_PATH):
            try:
                with open(ARCHIVE_PATH, "r", encoding="utf-8") as f:
                    archive_data = json.load(f)
            except Exception:
                pass
        arch_events = archive_data.setdefault("archivedEvents", [])
        existing_arch_ids = {a.get("id") for a in arch_events}

        # Load learned rules to keep archived_event_ids in sync
        rules_data = {}
        if os.path.exists(RULES_PATH):
            try:
                with open(RULES_PATH, "r", encoding="utf-8") as f:
                    rules_data = json.load(f)
            except Exception:
                pass
        arch_ids_set = set(rules_data.setdefault("archived_event_ids", []))

        # 1. Sweep any concluded/expired items lingering in the quarantine queue
        cleaned_q_events = []
        for q in q_events:
            qid = q.get("id")
            concluded, conc_reason = is_event_concluded(q, now_dt)
            q_reason = str(q.get("quarantineReason", "") or q.get("flagReason", "")).lower()
            if not concluded and ("event ended" in q_reason or "has ended" in q_reason or "event has ended" in q_reason):
                concluded = True
                conc_reason = "Flagged as ended"

            if concluded:
                arch_copy = dict(q)
                arch_copy["archivedAt"] = now_iso
                arch_copy["archivedReason"] = f"Auto-Archived from Quarantine: {conc_reason}"
                arch_copy["reviewStatus"] = "concluded"
                arch_copy["isConcluded"] = True
                if qid not in existing_arch_ids:
                    arch_events.append(arch_copy)
                    existing_arch_ids.add(qid)
                arch_ids_set.add(qid)
                swept_from_queue_count += 1
                log(f"  -> Auto-Archived concluded event from quarantine: [{qid}] {q.get('title')}: {conc_reason}")
            else:
                cleaned_q_events.append(q)
        q_events = cleaned_q_events

        # 2. Process active catalog events
        remaining_events = []
        for ev in events:
            eid = ev.get("id")
            has_issue = eid in problem_ids
            issue_info = next((x for x in issues if x['id'] == eid), None) if has_issue else None
            reason = issue_info['failureReason'] if issue_info else "Link failed audit"

            # Check if event has concluded
            concluded, conc_reason = is_event_concluded(ev, now_dt)
            if not concluded and issue_info and issue_info.get('isSoft404'):
                r_lower = reason.lower()
                if "event ended" in r_lower or "has ended" in r_lower or "expired" in r_lower:
                    concluded = True
                    conc_reason = "Ticketing platform confirmed event has ended"

            if concluded:
                # AUTO-ARCHIVE CONCLUDED EVENT
                arch_copy = dict(ev)
                arch_copy["archivedAt"] = now_iso
                arch_copy["archivedReason"] = f"Auto-Archived: {conc_reason}" + (f" (Link: {reason})" if has_issue else "")
                arch_copy["reviewStatus"] = "concluded"
                arch_copy["isConcluded"] = True
                if eid not in existing_arch_ids:
                    arch_events.append(arch_copy)
                    existing_arch_ids.add(eid)
                arch_ids_set.add(eid)
                auto_archived_count += 1
                log(f"  -> Auto-Archived concluded catalog event: [{eid}] {ev.get('title')}: {conc_reason}")
            elif has_issue:
                # ACTIVE/UPCOMING EVENT WITH BROKEN LINK -> QUARANTINE FOR CURATOR TRIAGE
                ev_copy = dict(ev)
                ev_copy["quarantineReason"] = f"Automated 4:00 AM Link Audit: {reason}"
                ev_copy["quarantinedAt"] = now_iso
                ev_copy["dealtWith"] = False
                if eid not in existing_q_ids:
                    q_events.append(ev_copy)
                    existing_q_ids.add(eid)
                    quarantined_count += 1
            else:
                r_match = next((r for r in results if r['id'] == eid), None)
                if r_match:
                    if r_match.get('upgradedUrl'):
                        ev['websiteUrl'] = r_match['upgradedUrl']
                    if r_match.get('semanticVerification'):
                        ev['semanticVerification'] = r_match['semanticVerification']
                remaining_events.append(ev)

        # 3. Save all updated databases
        try:
            with open(EVENTS_PATH, "w", encoding="utf-8") as f:
                json.dump({"events": remaining_events}, f, indent=2, ensure_ascii=False)
                
            queue_data["quarantinedEvents"] = q_events
            queue_data["pendingCount"] = len(q_events)
            with open(QUEUE_PATH, "w", encoding="utf-8") as f:
                json.dump(queue_data, f, indent=2, ensure_ascii=False)

            archive_data["archivedEvents"] = arch_events
            archive_data.setdefault("metadata", {})["totalArchived"] = len(arch_events)
            archive_data["metadata"]["updatedAt"] = now_iso
            with open(ARCHIVE_PATH, "w", encoding="utf-8") as f:
                json.dump(archive_data, f, indent=2, ensure_ascii=False)

            rules_data["archived_event_ids"] = sorted(list(arch_ids_set))
            rules_data.setdefault("metadata", {})["updatedAt"] = now_iso
            with open(RULES_PATH, "w", encoding="utf-8") as f:
                json.dump(rules_data, f, indent=2, ensure_ascii=False)

            # Sync data.js
            try:
                from curator_server import sync_js_data_file
                sync_js_data_file()
            except Exception as e:
                log(f"[WARN] sync_js_data_file: {e}")

            log(f"[LINK AUDIT AUTO-TRIAGE] Successfully updated catalog, review queue, archive, and learned rules.")
        except Exception as e:
            log(f"[LINK AUDIT ERROR] Failed updating databases: {e}")

    summary = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "durationSeconds": round(time.time() - start_time, 2),
        "totalChecked": len(results),
        "healthyCount": len(healthy_links),
        "botProtectedCount": len(bot_shielded),
        "deadCount": len(dead_links),
        "soft404Count": len(soft_404s),
        "quarantinedCount": quarantined_count,
        "autoArchivedCount": auto_archived_count,
        "sweptFromQueueCount": swept_from_queue_count,
        "issues": issues
    }

    try:
        with open(AUDIT_REPORT_PATH, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)
    except Exception:
        pass

    return summary


if __name__ == "__main__":
    auto_q = "--no-quarantine" not in sys.argv
    res = run_link_health_audit(auto_quarantine=auto_q)
    print("\n--- LINK AUDIT COMPLETE ---")
    print(f"Total: {res['totalChecked']} | Healthy: {res['healthyCount']} | Bot-Protected: {res['botProtectedCount']} | Dead: {res['deadCount']} | Soft 404s: {res['soft404Count']}")
    if res['issues']:
        print(f"\nISSUES FOUND ({len(res['issues'])}):")
        for i in res['issues']:
            print(f"[{i.get('statusCode') or 'ERR'}] {i.get('title')} ({i.get('venue')}): {i.get('failureReason')}")
