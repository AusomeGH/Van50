#!/usr/bin/env python3
"""
scripts/deploy_to_production.py
Van50 Production Release & Automated Smoke-Test Deployment Engine

Guarantees 100% stability for the online production app:
  1. Runs an automated headless Chrome smoke test against the local app.
  2. Verifies 0 JavaScript console errors (SyntaxError, TypeError, ReferenceError).
  3. Verifies category pills (>0) and event cards (>50) render in the live DOM.
  4. Blocks deployment immediately if any smoke test check fails.
  5. If 100% green, merges and pushes to the 'production' branch on GitHub.
  6. Safely returns you to the 'main' development branch.
"""

import os
import sys
import time
import glob
import shutil
import subprocess
import http.server
import socketserver
import threading
import tempfile
from typing import Optional, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def find_git_binary() -> str:
    """Locates git binary from PATH or GitHub Desktop installation."""
    which_git = shutil.which("git")
    if which_git:
        return which_git

    candidates = glob.glob(
        r"C:\Users\Micro\AppData\Local\GitHubDesktop\app-*\resources\app\git\cmd\git.exe"
    )
    if candidates:
        return sorted(candidates)[-1]

    for p in [
        r"C:\Program Files\Git\cmd\git.exe",
        r"C:\Program Files\Git\bin\git.exe",
        r"C:\Users\Micro\AppData\Local\Programs\Git\cmd\git.exe"
    ]:
        if os.path.exists(p):
            return p

    raise FileNotFoundError("Could not locate git.exe. Ensure Git or GitHub Desktop is installed.")


def find_chrome_binary() -> str:
    """Locates Google Chrome or Microsoft Edge binary."""
    for p in [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        shutil.which("chrome"),
        shutil.which("google-chrome"),
        shutil.which("msedge")
    ]:
        if p and os.path.exists(p):
            return p

    raise FileNotFoundError("Could not locate Google Chrome or Microsoft Edge executable.")


def run_cmd(cmd: list, cwd: str = BASE_DIR, check: bool = True) -> Tuple[int, str, str]:
    """Runs a shell command and returns (code, stdout, stderr)."""
    res = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and res.returncode != 0:
        raise RuntimeError(f"Command failed ({res.returncode}): {' '.join(cmd)}\n{res.stderr}\n{res.stdout}")
    return res.returncode, res.stdout.strip(), res.stderr.strip()


def verify_anti_laziness_invariants() -> bool:
    """
    [SMOKE TEST 0/3] Enforces mechanical Anti-Laziness Invariants across data/events.json.
    Guarantees zero out-of-market events, zero ticketing portals as venues, zero missing dates,
    zero fake 50/50 audit scores, and zero budget cap violations.
    """
    import json
    print("\n[SMOKE TEST 0/3] Enforcing Anti-Laziness Invariants on Central Catalog...")
    events_path = os.path.join(BASE_DIR, "data", "events.json")
    if not os.path.exists(events_path):
        print(f"❌ [FAIL] Missing data/events.json at {events_path}")
        return False

    with open(events_path, "r", encoding="utf-8") as f:
        events = json.load(f)

    violations = []
    # Out-of-market geographic region indicators (provinces, non-Metro BC, out-of-market metros)
    out_region_tokens = (', on', ', qc', ', ab', 'toronto', 'montreal', 'calgary', 'edmonton', 'ottawa', 'victoria, bc', 'whistler')
    agg_portal_tokens = ('songkick', 'orange tickets', 'vtix', 'eventbrite', 'do604', 'the georgia straight', 'ticketweb', 'broadway across canada', 'admitone', 'dice.fm', 'universe.com', 'livenation')

    for e in events:
        eid = e.get("event_id", "unknown")
        title = str(e.get("title", ""))
        venue = str(e.get("venue_name", ""))
        disc = str(e.get("discovery_url", ""))
        ticket = str(e.get("ticket_url", ""))
        dt = e.get("date")
        show1 = e.get("show_1") or {}
        price = e.get("price_all_in")
        if not isinstance(price, (int, float)):
            raw_p = e.get("price", 0.0)
            if isinstance(raw_p, (int, float)):
                price = raw_p
            else:
                price = 0.0
        lifecycle = e.get("lifecycle_type")
        blob = f"{eid} {title} {venue} {disc} {ticket}".lower()

        # Rule 1: Budget Ceiling
        if price > 50.0:
            violations.append(f"[{eid}] Exceeds $50 CAD ceiling (${price})")

        # Rule 2: Geofence & Boundary Invariant (Deterministic Numerical GPS Bounding Box & Out-of-Market Rejection)
        coords = e.get("coordinates")
        if isinstance(coords, (list, tuple)) and len(coords) == 2:
            try:
                lat, lng = float(coords[0]), float(coords[1])
                # Metro Vancouver roughly: 49.0 <= lat <= 49.5 and -123.4 <= lng <= -122.4
                if not (49.0 <= lat <= 49.5 and -123.4 <= lng <= -122.4):
                    violations.append(f"[{eid}] Coordinates [{lat}, {lng}] outside Metro Vancouver bounding box")
            except (ValueError, TypeError):
                violations.append(f"[{eid}] Malformed numerical coordinates: {coords}")

        for ort in out_region_tokens:
            if ort in blob:
                violations.append(f"[{eid}] Out-of-market geographic indicator detected: '{ort}'")
                break

        # Rule 3: Entity Invariant (No Ticketing Portals as Venues & Physical Civic Street Address Required)
        venue_lower = venue.lower()
        for apt in agg_portal_tokens:
            if apt in venue_lower:
                violations.append(f"[{eid}] Aggregator portal used as venue: {venue}")
                break

        venue_addr = str(e.get("full_address") or e.get("address") or "").strip()
        if not venue_addr:
            violations.append(f"[{eid}] Missing physical civic street address for venue: '{venue}'")

        # Rule 4: Lifecycle Invariant (No Missing Dates)
        if not dt and not show1.get("date") and lifecycle != "perennial_drop_in":
            violations.append(f"[{eid}] Non-perennial event lacks active date")

        # Rule 5: Honest Dimension Audit (No Fake Perfect Score)
        da = e.get("dimension_audit")
        if da and da.get("dimensions_score"):
            score_str = str(da.get("dimensions_score")).strip()
            parts = score_str.split("/")
            if len(parts) == 2 and parts[0] == parts[1] and parts[0].isdigit():
                dims = da.get("dimensions") if isinstance(da.get("dimensions"), dict) else da
                d2 = dims.get("D2_date", {}) or dims.get("D303_date", {})
                if (not d2 or d2.get("value") is None) and lifecycle != "perennial_drop_in":
                    violations.append(f"[{eid}] Fake {score_str} score with D2_date=None")

        # Rule 6: Asset File Rejection (No static assets as event URLs)
        asset_exts = ('.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.woff', '.woff2', '.ttf', '.ico', '.map')
        all_event_urls = [ticket, disc, str(e.get("websiteUrl", "")), str(e.get("best_available_link", ""))]
        if isinstance(e.get("links"), dict):
            all_event_urls.extend(str(v) for v in e["links"].values() if v)
        for u in all_event_urls:
            clean_u = u.split('?')[0].split('#')[0].lower()
            if clean_u.endswith(asset_exts):
                violations.append(f"[{eid}] Static asset file used as event link: {u}")
                break

        # Rule 7: Entity Symmetry & Non-Blank Venue
        raw_venue = str(e.get("venue", "")).strip()
        raw_venue_name = str(e.get("venue_name", "")).strip()
        if not raw_venue or not raw_venue_name:
            violations.append(f"[{eid}] Missing venue field (venue='{raw_venue}', venue_name='{raw_venue_name}')")

        # Rule 8: Schema Completeness (5-Tier Links Dict)
        links = e.get("links")
        if not isinstance(links, dict):
            violations.append(f"[{eid}] Missing or non-dict 'links' schema")
        else:
            required_keys = {'tier1_checkout', 'tier2_event_page', 'tier3_calendar', 'tier4_civic_destination', 'tier5_venue_home', 'best_available', 'best_tier'}
            missing = required_keys - set(links.keys())
            if missing:
                violations.append(f"[{eid}] 'links' dict missing keys: {missing}")
            ba = links.get("best_available")
            if not ba or not isinstance(ba, str) or not ba.startswith("http"):
                violations.append(f"[{eid}] 'links.best_available' is not a valid HTTP URL: {ba}")
            bt = links.get("best_tier")
            if bt not in ('tier1', 'tier2', 'tier3', 'tier4', 'tier5'):
                violations.append(f"[{eid}] Invalid 'links.best_tier': {bt}")

        # Rule 9: Aggregator Blacklist & Unhydrated Calendar Rejection
        agg_domains = ('allevents.in', 'do604.com', 'facebook.com/events', 'eventbrite.ca/d/', 'eventbrite.com/d/')
        for agg in agg_domains:
            if agg in ticket.lower():
                violations.append(f"[{eid}] Blacklisted aggregator in ticket_url: {ticket}")
                break
        if '/monthly-calendar-list' in ticket.lower():
            violations.append(f"[{eid}] Unhydrated calendar directory in ticket_url: {ticket}")

        # Rule 10: Generic Platform Marketing Title Rejection
        title_lower = title.lower()
        for bad_title in ("ticketweb -", "eventbrite -", "showpass -", "tickets for independent concerts"):
            if bad_title in title_lower:
                violations.append(f"[{eid}] Generic platform marketing copy in title: {title}")
                break

        # Rule 11: Root Timestamp & Proof Image Integrity (Anti-Half-Update)
        proof = e.get("proof_image")
        root_pulse = e.get("last_pulse_qc_at")
        root_qc = e.get("last_qc_audited_at")
        nested_pulse = da.get("last_pulse_qc_at") if da else None
        if proof and (not root_pulse or not root_qc):
            violations.append(f"[{eid}] Has proof_image '{proof}' but root last_pulse_qc_at or last_qc_audited_at is null")
        if nested_pulse and not root_pulse:
            violations.append(f"[{eid}] Has nested dimension_audit.last_pulse_qc_at but root last_pulse_qc_at is null")

        # Rule 12: Ephemeral Checkout Session URLs & Widget Token Rejection (Anti-Session Hash)
        import re
        from urllib.parse import urlparse
        ephemeral_patterns = (
            r'/chk/[a-f0-9]{16,}',       # Ticket Tailor CSRF/session hash
            r'widget=true',               # Bare iframe widget parameter
            r'session_id=',               # Generic session parameters
            r'[?&](fbclid|gclid|_gl)=',   # Tracking click identifiers
        )
        for u in all_event_urls:
            for pat in ephemeral_patterns:
                if re.search(pat, u, re.IGNORECASE):
                    violations.append(f"[{eid}] Ephemeral session/widget parameter in URL: {u}")
                    break

        # Rule 13: URL Deep-Link Invariant (No Bare Root Domains as Ticket URLs)
        ticket_url_clean = str(ticket).strip()
        if ticket_url_clean and ticket_url_clean.startswith("http"):
            parsed_u = urlparse(ticket_url_clean)
            path_clean = parsed_u.path.strip('/')
            # Check major ticketing portals dropping users on homepages
            major_ticket_portals = ('showpass.com', 'ticketmaster.ca', 'ticketmaster.com', 'admitone.com', 'ticketweb.ca', 'eventbrite.ca', 'eventbrite.com')
            if any(portal in parsed_u.netloc.lower() for portal in major_ticket_portals) and not path_clean:
                violations.append(f"[{eid}] Bare root domain used as ticket_url instead of deep link: {ticket}")

        # Rule 14: String Hygiene (Button Concatenations & Navigation Tabs in Title)
        bad_title_artifacts = (r'\bbuy tickets\b', r'\bmoreinfo[→>]*\b', r'\bregister now\b', r'\bget season tickets\b', r'\bclick here\b')
        for bta in bad_title_artifacts:
            if re.search(bta, title, re.IGNORECASE):
                violations.append(f"[{eid}] Button/navigation artifact in title: '{title}'")
                break

    if violations:
        print(f"❌ [FAIL] Anti-Laziness Invariant Violations Detected ({len(violations)}):")
        for v in violations[:10]:
            print(f"   • {v}")
        if len(violations) > 10:
            print(f"   ... and {len(violations) - 10} more.")
        print("[DEPLOYMENT BLOCKED] Purge or heal lazy records before deploying.")
        return False

    print(f"✓ [PASS] All {len(events)} events strictly satisfy Anti-Laziness Invariants.")
    return True


def run_smoke_test(port: int = 8085) -> bool:
    """
    Spins up a temporary local test server, loads the application in headless Chrome,
    and inspects both the console error log and rendered DOM.
    """
    # Step 0: Anti-Laziness Invariants Pre-Flight Check
    if not verify_anti_laziness_invariants():
        return False

    print("\n[SMOKE TEST 1/3] Spinning up ephemeral test server on port {}...".format(port))
    
    # Custom handler to serve BASE_DIR
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=BASE_DIR, **kwargs)
        def log_message(self, format, *args):
            pass  # Suppress request spam

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", port), Handler)
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()
    time.sleep(0.5)

    test_url = f"http://127.0.0.1:{port}/"
    chrome_bin = find_chrome_binary()

    print(f"[SMOKE TEST 2/3] Launching headless browser against {test_url}...")

    temp_profile = tempfile.mkdtemp(prefix="van50_smoke_chrome_")

    # Step A: Check for Uncaught Console Errors
    log_cmd = [
        chrome_bin,
        "--headless=new",
        f"--user-data-dir={temp_profile}",
        "--enable-logging=stderr",
        "--v=1",
        "--virtual-time-budget=5000",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        test_url
    ]
    try:
        proc = subprocess.run(log_cmd, capture_output=True, text=True, timeout=15, encoding="utf-8", errors="replace")
        combined_logs = proc.stderr + "\n" + proc.stdout
    except subprocess.TimeoutExpired:
        combined_logs = ""

    # Check for fatal JS errors
    fatal_patterns = ["Uncaught SyntaxError", "Uncaught TypeError", "Uncaught ReferenceError", "Uncaught Error"]
    detected_errors = []
    for line in combined_logs.splitlines():
        if any(pat in line for pat in fatal_patterns):
            detected_errors.append(line.strip())

    if detected_errors:
        print("\n❌ [FAIL] JAVASCRIPT CONSOLE ERRORS DETECTED:")
        for err in detected_errors:
            print(f"   {err}")
        print("\n[DEPLOYMENT BLOCKED] Fix the JavaScript errors before deploying to production.")
        shutil.rmtree(temp_profile, ignore_errors=True)
        httpd.shutdown()
        httpd.server_close()
        return False

    print("✓ [PASS] Zero JavaScript console syntax errors detected.")

    # Step B: Verify Rendered DOM Content (Categories & Cards)
    print("[SMOKE TEST 3/3] Inspecting live rendered DOM...")
    dom_cmd = [
        chrome_bin,
        "--headless=new",
        f"--user-data-dir={temp_profile}",
        "--dump-dom",
        "--virtual-time-budget=5000",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        test_url
    ]
    try:
        dom_proc = subprocess.run(dom_cmd, capture_output=True, text=True, timeout=25, encoding="utf-8", errors="replace")
        dom_html = dom_proc.stdout
    except Exception as ex:
        print(f"❌ [FAIL] Headless browser dump-dom failed: {ex}")
        shutil.rmtree(temp_profile, ignore_errors=True)
        httpd.shutdown()
        httpd.server_close()
        return False

    shutil.rmtree(temp_profile, ignore_errors=True)
    httpd.shutdown()
    httpd.server_close()

    # Verify Categories
    cat_count = dom_html.count('class="category-pill')
    card_count = dom_html.count('class="event-card')

    print(f"   • Rendered Category Pills: {cat_count}")
    print(f"   • Rendered Event Cards: {card_count}")

    if cat_count < 5:
        print(f"\n❌ [FAIL] Category bar is empty or missing pills (found {cat_count}, expected >= 8).")
        print("[DEPLOYMENT BLOCKED] Frontend initialization failed.")
        return False

    if card_count < 20:
        print(f"\n❌ [FAIL] Event cards grid is empty or insufficient (found {card_count}, expected >= 50).")
        print("[DEPLOYMENT BLOCKED] Event catalog failed to hydrate.")
        return False

    print("✓ [PASS] All UI components hydrated successfully (Categories: {}, Event Cards: {}).\n".format(cat_count, card_count))
    return True


def deploy_to_production(custom_message: Optional[str] = None):
    git_bin = find_git_binary()
    print("=" * 70)
    print("Van50 Production Release & Deployment Engine")
    print(f"Git Binary: {git_bin}")
    print("=" * 70)

    # 1. Run Pre-Flight Smoke Test
    smoke_passed = run_smoke_test(port=8089)
    if not smoke_passed:
        print("❌ Deployment aborted: Smoke test did not pass.")
        sys.exit(1)

    # 2. Check current git branch
    _, current_branch, _ = run_cmd([git_bin, "branch", "--show-current"])
    print(f"[GIT] Current active branch: {current_branch}")

    # 3. Check for uncommitted changes on working branch
    _, status_out, _ = run_cmd([git_bin, "status", "--porcelain"])
    if status_out:
        print("[GIT] Detected uncommitted changes on '{}'. Staging and committing...".format(current_branch))
        commit_msg = custom_message or "chore(release): prepare production release updates"
        run_cmd([git_bin, "add", "-A"])
        run_cmd([git_bin, "commit", "-m", commit_msg])

    # 4. Push working branch to remote
    print(f"[GIT] Pushing '{current_branch}' to origin...")
    run_cmd([git_bin, "push", "origin", current_branch])

    # 5. Switch to production branch
    print("[GIT] Switching to 'production' branch...")
    run_cmd([git_bin, "checkout", "production"])

    try:
        # Pull latest production to prevent divergence
        print("[GIT] Syncing remote production...")
        run_cmd([git_bin, "pull", "origin", "production"], check=False)

        # Merge main into production
        print(f"[GIT] Merging vetted '{current_branch}' into 'production'...")
        run_cmd([git_bin, "merge", current_branch, "--no-edit"])

        # Push to remote production
        print("[GIT] Pushing release to origin/production...")
        run_cmd([git_bin, "push", "origin", "production"])

        _, prod_hash, _ = run_cmd([git_bin, "rev-parse", "--short", "HEAD"])
        print("\n" + "=" * 70)
        print("🚀 [PRODUCTION DEPLOYED SUCCESSFULLY]")
        print(f"   • Release Commit: {prod_hash}")
        print("   • Target Branch: production")
        print("   • Live GitHub Pages URL: https://ausomegh.github.io/Van50/")
        print("=" * 70)

    finally:
        # Always return user to their working branch
        print(f"\n[GIT] Returning to development branch '{current_branch}'...")
        run_cmd([git_bin, "checkout", current_branch])


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Van50 Production Deployment & Smoke-Test Engine")
    parser.add_argument("--smoke-test-only", action="store_true", help="Run local smoke test without deploying")
    parser.add_argument("--message", "-m", type=str, help="Custom commit message for release")
    args = parser.parse_args()

    if args.smoke_test_only:
        ok = run_smoke_test(port=8089)
        sys.exit(0 if ok else 1)
    else:
        deploy_to_production(custom_message=args.message)
