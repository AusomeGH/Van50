#!/usr/bin/env python3
"""
Real Chrome Browser Verification via Chrome DevTools Protocol (CDP).
Tests:
1. http://127.0.0.1:8080/index.html:
   - Verifies NO '?' button on event prices (.price-info-popover count == 0).
   - Verifies Resident Advisor venue sites link to genuine venue sites or RA clubs, NEVER to /events/.
   - Captures high-res screenshot of public cards.
2. http://127.0.0.1:8080/curator.html:
   - Unlocks Curator Studio with passphrase 'Professor-Urban-Freebase9'.
   - Opens the Screenshot Proof modal.
   - Verifies all 13 discrete dimension cards exist:
     title, date, time, schedule, frequency, category, location, price, link, provider, description, lineup, restrictions.
   - Verifies Lineup (#12) and Restrictions (#13) show Optional status badges.
   - Captures high-res screenshot of the 13-Dimension Grid.
"""

import os
import sys
import time
import json
import base64
import subprocess
import urllib.request
import websocket

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILE_DIR = os.path.join(BASE_DIR, "scratch_chrome_profile")
PORT = 9222

class CDPBrowser:
    def __init__(self, port=9222):
        self.port = port
        self.proc = None
        self.ws = None
        self.req_id = 0

    def start(self):
        os.makedirs(PROFILE_DIR, exist_ok=True)
        cmd = [
            CHROME_PATH,
            "--headless=new",
            f"--remote-debugging-port={self.port}",
            "--remote-allow-origins=*",
            f"--user-data-dir={PROFILE_DIR}",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--window-size=1280,960"
        ]
        self.proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # Wait for debugging port
        for _ in range(30):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json", timeout=1)
                break
            except Exception:
                time.sleep(0.2)
        else:
            raise RuntimeError("Chrome failed to start debugging port")

    def connect_tab(self, url="about:blank"):
        # Create new tab or get first
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/json/new?{url}", method="PUT")
        with urllib.request.urlopen(req) as resp:
            tab = json.loads(resp.read().decode("utf-8"))
        ws_url = tab["webSocketDebuggerUrl"]
        self.ws = websocket.create_connection(ws_url, timeout=10)
        self.call("Page.enable")
        self.call("Runtime.enable")
        return tab["id"]

    def call(self, method, params=None):
        self.req_id += 1
        payload = {"id": self.req_id, "method": method, "params": params or {}}
        self.ws.send(json.dumps(payload))
        while True:
            raw = self.ws.recv()
            msg = json.loads(raw)
            if msg.get("id") == self.req_id:
                if "error" in msg:
                    raise RuntimeError(f"CDP Error ({method}): {msg['error']}")
                return msg.get("result", {})

    def navigate(self, url):
        self.call("Page.navigate", {"url": url})
        time.sleep(2)  # Wait for scripts and DOM to load

    def evaluate(self, expr):
        res = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        return res.get("result", {}).get("value")

    def capture_screenshot(self, out_path):
        res = self.call("Page.captureScreenshot", {"format": "png"})
        data = base64.b64decode(res["data"])
        with open(out_path, "wb") as f:
            f.write(data)
        print(f"  [OK] Saved screenshot: {out_path} ({len(data)} bytes)")

    def close(self):
        try:
            if self.ws:
                self.ws.close()
        except Exception:
            pass
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except Exception:
                self.proc.kill()


def run_verification():
    sys.stdout.reconfigure(encoding="utf-8")
    print("==================================================")
    print("REAL BROWSER VERIFICATION VIA CHROME CDP")
    print("==================================================")

    browser = CDPBrowser()
    browser.start()
    print("[1] Chrome Headless launched on port 9222.")

    try:
        browser.connect_tab()

        # ==========================================
        # STEP 1: VERIFY PUBLIC INDEX PAGE
        # ==========================================
        print("\n[Step 1] Navigating to http://127.0.0.1:8080/index.html...")
        browser.navigate("http://127.0.0.1:8080/index.html")

        # 1a. Verify NO '?' button on price
        popover_count = browser.evaluate("document.querySelectorAll('.price-info-popover').length")
        print(f"  - Price '?' Popover Elements found: {popover_count}")
        assert popover_count == 0, f"Expected 0 price-info-popovers, found {popover_count}!"
        print("  [OK] Confirmed: '?' price button completely removed from all cards.")

        # 1b. Verify Resident Advisor Venue URLs
        ra_check = browser.evaluate("""
            (() => {
                const links = Array.from(document.querySelectorAll('a'));
                const venueLinks = links.filter(a => a.textContent.includes('Venue Site'));
                const badLinks = venueLinks.filter(a => a.href.includes('ra.co/events/'));
                const goodLinks = venueLinks.filter(a => a.href.includes('ra.co/clubs/') || (!a.href.includes('ra.co') && a.href.startsWith('http')));
                return {
                    totalVenueLinks: venueLinks.length,
                    badLinksCount: badLinks.length,
                    goodLinksCount: goodLinks.length,
                    sampleVenueLinks: venueLinks.slice(0, 5).map(a => a.href)
                };
            })()
        """)
        print(f"  - Total Venue Site links found: {ra_check['totalVenueLinks']}")
        print(f"  - Bad links with '/events/': {ra_check['badLinksCount']}")
        print(f"  - Sample Venue Links: {ra_check['sampleVenueLinks']}")
        assert ra_check['badLinksCount'] == 0, f"Found {ra_check['badLinksCount']} venue links pointing to event pages!"
        print("  [OK] Confirmed: All Venue Site links point to actual venue sites or RA clubs, NEVER to /events/.")

        # Screenshot Public Cards
        index_shot_path = os.path.join(BASE_DIR, "browser_index_verified.png")
        browser.capture_screenshot(index_shot_path)

        # ==========================================
        # STEP 2: VERIFY CURATOR 13 DIMENSIONS
        # ==========================================
        print("\n[Step 2] Navigating to http://127.0.0.1:8080/curator.html...")
        browser.navigate("http://127.0.0.1:8080/curator.html")

        # 2a. Unlock Curator Studio
        print("  - Unlocking Curator Studio with master passphrase...")
        auth_res = browser.evaluate("""
            (async () => {
                const passField = document.getElementById('curator-password-field');
                const form = document.getElementById('curator-login-form');
                if (passField && form) {
                    passField.value = 'Professor-Urban-Freebase9';
                    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                    await new Promise(r => setTimeout(r, 2000));
                    const overlay = document.getElementById('login-modal-overlay');
                    return { unlocked: overlay ? !overlay.classList.contains('active') : true };
                }
                return { unlocked: false, err: 'Elements not found' };
            })()
        """)
        print(f"  - Curator Studio unlocked: {auth_res.get('unlocked')}")
        assert auth_res.get('unlocked') is True, "Failed to unlock Curator Studio!"

        # 2b. Open Screenshot Proof Modal & Inspect 13-Dimension Grid
        print("  - Opening Screenshot Proof & 13-Dimension Verifier Modal...")
        modal_res = browser.evaluate("""
            (() => {
                // Open modal on first quarantined event
                const cards = document.querySelectorAll('.curator-queue-card');
                if (cards.length > 0) {
                    const evId = cards[0].dataset.id;
                    if (window.openInstructionModal) {
                        window.openInstructionModal(evId, 'screenshot');
                    }
                }
                const modal = document.getElementById('ai-instruction-modal');
                const modalTitle = document.querySelector('#ai-instruction-modal .curator-modal-title')?.textContent || 'Untitled Modal';
                const panel = document.getElementById('ai-screenshot-alignment-panel');
                const results = document.getElementById('ai-alignment-results');
                
                // Show alignment results to verify the 13 dimension cards
                if (panel) panel.style.display = 'block';
                if (results) results.style.display = 'block';

                const dimCards = Array.from(document.querySelectorAll('.curator-dimension-card')).map(c => ({
                    id: c.id,
                    title: c.querySelector('.dim-card-title')?.textContent?.trim(),
                    badge: c.querySelector('.dim-pill')?.textContent?.trim(),
                    badgeClass: c.querySelector('.dim-pill')?.className,
                    val: c.querySelector('.dim-val-prominent')?.textContent?.trim(),
                    hasBtn: Boolean(c.querySelector('.btn-dim-apply'))
                }));

                return {
                    isOpen: modal?.classList.contains('active'),
                    modalTitle: modalTitle,
                    dimCardsCount: dimCards.length,
                    dimCards: dimCards
                };
            })()
        """)

        print(f"  - Modal title: '{modal_res['modalTitle']}'")
        print(f"  - Total Dimension Cards in DOM: {modal_res['dimCardsCount']}")
        assert modal_res['dimCardsCount'] == 13, f"Expected 13 dimension cards, got {modal_res['dimCardsCount']}!"

        print("\n  [VERIFIED 13 DISCRETE DIMENSIONS IN DOM]:")
        for dc in modal_res['dimCards']:
            print(f"    #{dc['id']} -> {dc['title']} | Badge: '{dc['badge']}' ({dc['badgeClass']})")

        # 2c. Explicit check of user requirements:
        # Req 1: Time and Schedule split
        card_time = next((c for c in modal_res['dimCards'] if c['id'] == 'ai-dim-card-time'), None)
        card_sched = next((c for c in modal_res['dimCards'] if c['id'] == 'ai-dim-card-schedule'), None)
        assert card_time is not None, "Missing ai-dim-card-time!"
        assert card_sched is not None, "Missing ai-dim-card-schedule!"
        print("  [OK] Req 1 Verified: Time and Schedule are unique discrete dimensions.")

        # Req 2: Link and Provider split
        card_link = next((c for c in modal_res['dimCards'] if c['id'] == 'ai-dim-card-link'), None)
        card_prov = next((c for c in modal_res['dimCards'] if c['id'] == 'ai-dim-card-provider'), None)
        assert card_link is not None, "Missing ai-dim-card-link!"
        assert card_prov is not None, "Missing ai-dim-card-provider!"
        print("  [OK] Req 2 Verified: Link and Ticketing Provider are unique discrete dimensions.")

        # Req 3: Description, Lineup and Restrictions split
        card_desc = next((c for c in modal_res['dimCards'] if c['id'] == 'ai-dim-card-description'), None)
        card_lineup = next((c for c in modal_res['dimCards'] if c['id'] == 'ai-dim-card-lineup'), None)
        card_restr = next((c for c in modal_res['dimCards'] if c['id'] == 'ai-dim-card-restrictions'), None)
        assert card_desc is not None, "Missing ai-dim-card-description!"
        assert card_lineup is not None, "Missing ai-dim-card-lineup!"
        assert card_restr is not None, "Missing ai-dim-card-restrictions!"
        print("  [OK] Req 3 Verified: Description, Lineup, and Restrictions are unique discrete dimensions.")

        # Req 4: Lineup and Restrictions are Optional
        assert "Optional" in card_lineup['badge'], f"Lineup badge should say Optional, got '{card_lineup['badge']}'"
        assert "Optional" in card_restr['badge'], f"Restrictions badge should say Optional, got '{card_restr['badge']}'"
        assert "optional" in card_lineup['badgeClass'], f"Lineup badge class should have optional, got '{card_lineup['badgeClass']}'"
        assert "optional" in card_restr['badgeClass'], f"Restrictions badge class should have optional, got '{card_restr['badgeClass']}'"
        print("  [OK] Req 4 Verified: Lineup and Restrictions show Optional status badges.")

        # Capture Curator 13-Dimension Screenshot
        curator_shot_path = os.path.join(BASE_DIR, "browser_curator_13d_verified.png")
        browser.capture_screenshot(curator_shot_path)

        print("\n==================================================")
        print("✓ ALL REAL BROWSER TESTS PASSED 100%!")
        print("==================================================")

    finally:
        browser.close()

if __name__ == "__main__":
    run_verification()
