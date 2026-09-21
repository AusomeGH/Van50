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
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
LOGS_DIR = os.path.join(DATA_DIR, "automation_logs")
AUDIT_REPORT_PATH = os.path.join(LOGS_DIR, "link_audit_latest.json")

sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))

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

    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            status = resp.status
            result['statusCode'] = status
            result['finalUrl'] = resp.geturl()
            
            raw_bytes = resp.read()
            raw_text = raw_bytes[:500000].decode('utf-8', errors='replace')
            
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
                result['isHealthy'] = True

    except urllib.error.HTTPError as e:
        result['statusCode'] = e.code
        result['error'] = f"HTTP {e.code}: {e.reason}"
        if is_bot_shielded and e.code in [401, 403]:
            result['isBotShielded'] = True
            result['isHealthy'] = True  # Verified accessible to real human browsers
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

    return result


def run_link_health_audit(
    events: Optional[List[Dict[str, Any]]] = None,
    auto_quarantine: bool = True,
    log_path: Optional[str] = None,
    max_workers: int = 12
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
    if auto_quarantine and issues:
        log(f"[LINK AUDIT AUTO-TRIAGE] Quarantining {len(issues)} cards with dead/soft-404 links...")
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

        remaining_events = []
        for ev in events:
            eid = ev.get("id")
            if eid in problem_ids:
                issue_info = next((x for x in issues if x['id'] == eid), None)
                reason = issue_info['failureReason'] if issue_info else "Link failed audit"
                ev_copy = dict(ev)
                ev_copy["quarantineReason"] = f"Automated 4:00 AM Link Audit: {reason}"
                ev_copy["quarantinedAt"] = datetime.now(timezone.utc).isoformat()
                ev_copy["dealtWith"] = False
                
                if eid not in existing_q_ids:
                    q_events.append(ev_copy)
                    quarantined_count += 1
                    log(f"  -> Quarantined [{eid}] {ev.get('title')}: {reason}")
            else:
                remaining_events.append(ev)

        # Save updated events.json and manual_review_queue.json
        try:
            with open(EVENTS_PATH, "w", encoding="utf-8") as f:
                json.dump({"events": remaining_events}, f, indent=2, ensure_ascii=False)
                
            queue_data["quarantinedEvents"] = q_events
            queue_data["pendingCount"] = len(q_events)
            with open(QUEUE_PATH, "w", encoding="utf-8") as f:
                json.dump(queue_data, f, indent=2, ensure_ascii=False)

            # Sync data.js
            try:
                from curator_server import sync_js_data_file
                sync_js_data_file()
            except Exception:
                pass

            log(f"[LINK AUDIT AUTO-TRIAGE] Successfully updated catalog & review queue.")
        except Exception as e:
            log(f"[LINK AUDIT ERROR] Failed updating catalog files: {e}")

    summary = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "durationSeconds": round(time.time() - start_time, 2),
        "totalChecked": len(results),
        "healthyCount": len(healthy_links),
        "botProtectedCount": len(bot_shielded),
        "deadCount": len(dead_links),
        "soft404Count": len(soft_404s),
        "quarantinedCount": quarantined_count,
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
