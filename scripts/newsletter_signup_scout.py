#!/usr/bin/env python3
"""
scripts/newsletter_signup_scout.py
Van50 Scout AI — Automated Newsletter Link & Signup Detector

Inspects venue homepages and calendars for newsletter subscription forms,
Mailchimp/Substack portals, and direct signup links.
If a venue is not yet subscribed in data/subscribed_venues.json, stages a direct
link card into Curator Mode for one-click manual subscription by the Curator.
"""

import os
import re
import sys
import json
import time
import ssl
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from bs4 import BeautifulSoup

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
SUBSCRIBED_PATH = os.path.join(DATA_DIR, "subscribed_venues.json")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
VENUES_PATH = os.path.join(DATA_DIR, "venues.json")

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

DEFAULT_EMAIL = "Van50.Submit@gmail.com"


def load_json(path, default=None):
    if default is None:
        default = {}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def get_subscribed_venue_keys() -> set:
    """Returns set of lowercased venue names and domain stems already subscribed."""
    sub_data = load_json(SUBSCRIBED_PATH, {"subscriptions": []})
    keys = set()
    for s in sub_data.get("subscriptions", []):
        vname = (s.get("venue_name") or "").lower().strip()
        if vname:
            keys.add(vname)
            # Remove common prefixes like 'the '
            keys.add(re.sub(r"^the\s+", "", vname))
        web = (s.get("website") or "").lower().strip()
        if web:
            parsed = urllib.parse.urlparse(web)
            domain = parsed.netloc.replace("www.", "")
            if domain:
                keys.add(domain)
    return keys


def is_already_subscribed(venue_name: str, url: str, subscribed_keys: set = None) -> bool:
    """Checks if venue or its domain is already in subscribed_venues.json."""
    if subscribed_keys is None:
        subscribed_keys = get_subscribed_venue_keys()

    v_clean = venue_name.lower().strip()
    if v_clean in subscribed_keys:
        return True
    if re.sub(r"^the\s+", "", v_clean) in subscribed_keys:
        return True

    if url:
        parsed = urllib.parse.urlparse(url)
        domain = parsed.netloc.replace("www.", "").lower()
        if domain and domain in subscribed_keys:
            return True

    return False


def detect_newsletter_signup_from_html(venue_name: str, base_url: str, html: str) -> dict | None:
    """
    Scans HTML content for newsletter subscription endpoints, forms, or direct links.
    Returns structured discovery dictionary or None.
    """
    if not html or not base_url:
        return None

    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception:
        return None

    # 1. Check for embedded HTML forms with email inputs and newsletter triggers
    for form in soup.find_all("form"):
        action = (form.get("action") or "").strip()
        has_email_field = bool(
            form.find("input", {"type": re.compile(r"email", re.I)}) or
            form.find("input", {"name": re.compile(r"email", re.I)})
        )
        form_text = form.get_text().lower()
        form_html = str(form).lower()
        
        is_nl_trigger = any(
            k in action.lower() or k in form_text or k in form_html
            for k in ["subscribe", "newsletter", "mailchimp", "list-manage", "klaviyo", "constantcontact", "substack", "mailing-list", "mailing list"]
        )

        if has_email_field and is_nl_trigger:
            method_desc = "Embedded Mailchimp / Newsletter Form"
            if "list-manage" in action.lower():
                method_desc = "Mailchimp Hosted Subscription Form"
            elif "substack" in action.lower():
                method_desc = "Substack Newsletter Signup"
            elif "klaviyo" in action.lower():
                method_desc = "Klaviyo Newsletter Signup"

            full_signup_url = urllib.parse.urljoin(base_url, action) if action else base_url
            return {
                "signup_url": full_signup_url,
                "method": method_desc,
                "confidence": 0.95
            }

    # 2. Check for explicit anchor links pointing to newsletters, Mailchimp, or Substack
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        text = (a.get_text() or "").strip().lower()
        href_lower = href.lower()

        # Skip social media, anchors, and unsubscribes
        if any(bad in href_lower for bad in ["unsubscribe", "instagram.com", "facebook.com", "twitter.com", "x.com", "linkedin.com", "tiktok.com", "mailto:"]):
            continue

        is_nl_url = any(
            pattern in href_lower for pattern in [
                "list-manage.com", "eepurl.com", "mailchi.mp", "substack.com",
                "/newsletter", "/subscribe", "/mailing-list", "/join-our-mailing-list",
                "/email-signup", "/sign-up", "/signup"
            ]
        )
        is_nl_anchor_text = any(
            phrase in text for phrase in [
                "newsletter", "subscribe to our newsletter", "join our newsletter",
                "join our mailing list", "mailing list", "sign up for updates", "email updates"
            ]
        )

        if is_nl_url or is_nl_anchor_text:
            full_signup_url = urllib.parse.urljoin(base_url, href)
            method_desc = "Newsletter Direct Signup Link"
            if "list-manage.com" in href_lower or "eepurl.com" in href_lower:
                method_desc = "Mailchimp Subscription Portal"
            elif "substack.com" in href_lower:
                method_desc = "Substack Newsletter Portal"

            return {
                "signup_url": full_signup_url,
                "method": method_desc,
                "confidence": 0.88
            }

    return None


def stage_detected_newsletter_signup(venue_name: str, website_url: str, signup_url: str, method: str) -> dict:
    """
    Saves a pending newsletter signup opportunity to data/manual_review_queue.json
    under 'pendingNewsletterSignups' for Curator Mode triage.
    """
    q_data = load_json(QUEUE_PATH, {"quarantinedEvents": [], "pendingNewsletterSignups": []})
    signups = q_data.setdefault("pendingNewsletterSignups", [])

    clean_name = venue_name.strip()
    clean_slug = re.sub(r"[^\w]+", "-", clean_name.lower()).strip("-")
    signup_id = f"nls_{clean_slug}"

    # Check if already present in pending signups
    for s in signups:
        if s.get("id") == signup_id or s.get("venue_name", "").lower() == clean_name.lower():
            s["signup_url"] = signup_url
            s["method"] = method
            s["updated_at"] = datetime.now(timezone.utc).isoformat()
            save_json(QUEUE_PATH, q_data)
            return s

    new_record = {
        "id": signup_id,
        "venue_name": clean_name,
        "website_url": website_url,
        "signup_url": signup_url,
        "method": method,
        "suggested_email": DEFAULT_EMAIL,
        "status": "pending_manual_subscription",
        "detected_at": datetime.now(timezone.utc).isoformat(),
        "notes": "Scout AI detected newsletter subscription form on official website."
    }

    signups.append(new_record)
    q_data["pendingNewsletterSignups"] = signups
    q_data["pendingNewsletterCount"] = len([x for x in signups if x.get("status") == "pending_manual_subscription"])
    save_json(QUEUE_PATH, q_data)
    print(f"[SCOUT NEWSLETTER] Staged new newsletter signup opportunity for '{clean_name}': {signup_url}")
    return new_record


def scan_venue_for_newsletter(venue_name: str, venue_meta: dict) -> dict | None:
    """Checks if a venue has a newsletter and stages it if not already subscribed."""
    sub_keys = get_subscribed_venue_keys()
    cal_url = venue_meta.get("calendarUrl") or venue_meta.get("calendar_url") or venue_meta.get("website_url") or venue_meta.get("url") or ""
    web_url = venue_meta.get("website_url") or venue_meta.get("url") or cal_url

    if not cal_url and not web_url:
        return None

    if is_already_subscribed(venue_name, web_url or cal_url, sub_keys):
        return None

    # Fetch and test primary URL
    req_headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    urls_to_try = [u for u in [web_url, cal_url] if u]
    
    for u in urls_to_try:
        try:
            req = urllib.request.Request(u, headers=req_headers)
            html = urllib.request.urlopen(req, context=ctx, timeout=8).read().decode("utf-8", errors="ignore")
            detection = detect_newsletter_signup_from_html(venue_name, u, html)
            if detection:
                return stage_detected_newsletter_signup(
                    venue_name=venue_name,
                    website_url=web_url or u,
                    signup_url=detection["signup_url"],
                    method=detection["method"]
                )
        except Exception:
            continue

    return None


def scan_all_registered_venues(limit: int = 50) -> list:
    """Scans registered venues in data/venues.json for un-subscribed newsletter signups."""
    venues_data = load_json(VENUES_PATH, [])
    if isinstance(venues_data, dict):
        venues_data = list(venues_data.values())

    sub_keys = get_subscribed_venue_keys()
    discovered = []

    print(f"[NEWSLETTER SCOUT] Scanning up to {limit} venues for newsletter signups...")
    for idx, v in enumerate(venues_data[:limit], 1):
        vname = v.get("venue_name") or v.get("name")
        if not vname:
            continue
        if is_already_subscribed(vname, v.get("website_url") or v.get("calendar_url", ""), sub_keys):
            continue

        res = scan_venue_for_newsletter(vname, v)
        if res:
            discovered.append(res)
            print(f"[{idx}/{limit}] ✓ Found newsletter for '{vname}': {res['signup_url']}")
        time.sleep(0.3)  # Gentle crawl rate

    return discovered


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Van50 Scout AI Newsletter Signup Detector")
    parser.add_argument("--scan-all", action="store_true", help="Scan registered venues for un-subscribed newsletters")
    parser.add_argument("--venue", type=str, help="Scan a single venue by name")
    parser.add_argument("--url", type=str, help="Target URL to inspect")
    parser.add_argument("--limit", type=int, default=35, help="Max venues to scan")

    args = parser.parse_args()

    if args.venue and args.url:
        meta = {"website_url": args.url, "calendar_url": args.url}
        res = scan_venue_for_newsletter(args.venue, meta)
        print(json.dumps(res, indent=2))
    elif args.scan_all:
        results = scan_all_registered_venues(limit=args.limit)
        print(f"\n[COMPLETE] Discovered {len(results)} new newsletter signups staged into Curator Mode.")
    else:
        print("Usage: python scripts/newsletter_signup_scout.py --scan-all [--limit 35]")
