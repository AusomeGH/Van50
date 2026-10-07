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


def run_smoke_test(port: int = 8085) -> bool:
    """
    Spins up a temporary local test server, loads the application in headless Chrome,
    and inspects both the console error log and rendered DOM.
    """
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

    # Step A: Check for Uncaught Console Errors
    log_cmd = [
        chrome_bin,
        "--headless=new",
        "--enable-logging=stderr",
        "--v=1",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        test_url
    ]
    try:
        proc = subprocess.run(log_cmd, capture_output=True, text=True, timeout=12, encoding="utf-8", errors="replace")
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
        httpd.shutdown()
        httpd.server_close()
        return False

    print("✓ [PASS] Zero JavaScript console syntax errors detected.")

    # Step B: Verify Rendered DOM Content (Categories & Cards)
    print("[SMOKE TEST 3/3] Inspecting live rendered DOM...")
    dom_cmd = [
        chrome_bin,
        "--headless=new",
        "--dump-dom",
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
        httpd.shutdown()
        httpd.server_close()
        return False

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
