import subprocess
import json
import time
import urllib.request
import websocket
import base64
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')

chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
port = 9235
cmd = [
    chrome_path, '--headless=new', f'--remote-debugging-port={port}',
    '--remote-allow-origins=*', '--window-size=1360,1050',
    'http://127.0.0.1:8080/'
]
proc = subprocess.Popen(cmd)
time.sleep(2.5)

def eval_js(ws, expr, msg_id):
    ws.send(json.dumps({'id': msg_id, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True}}))
    while True:
        raw = ws.recv()
        data = json.loads(raw)
        if data.get('id') == msg_id:
            res = data.get('result', {}).get('result', {})
            return res.get('value')

def capture_screen(ws, out_path, msg_id):
    ws.send(json.dumps({'id': msg_id, 'method': 'Page.captureScreenshot', 'params': {'format': 'png'}}))
    while True:
        raw = ws.recv()
        data = json.loads(raw)
        if data.get('id') == msg_id:
            img = base64.b64decode(data['result']['data'])
            with open(out_path, 'wb') as f:
                f.write(img)
            print(f"  [SCREENSHOT] Saved: {out_path}")
            break

try:
    req = urllib.request.urlopen(f'http://127.0.0.1:{port}/json')
    ws_url = [t['webSocketDebuggerUrl'] for t in json.loads(req.read()) if t['type']=='page'][0]
    ws = websocket.create_connection(ws_url)
    ws.send(json.dumps({'id': 1, 'method': 'Page.enable'}))
    ws.send(json.dumps({'id': 2, 'method': 'Runtime.enable'}))
    time.sleep(1.2)

    print("=" * 75)
    print("VAN50 BROWSER CDP VERIFICATION: GOOGLE SEARCH & ROVING VENUES QC")
    print("=" * 75)

    # 1. Check for page load & initial event card count
    init_res = eval_js(ws, '''
    (() => {
        const cards = document.querySelectorAll(".event-card");
        const headerTitle = document.querySelector(".hero-title")?.textContent || "";
        const searchInput = document.getElementById("search-input");
        const tipsBtn = document.getElementById("btn-search-tips-toggle");
        return {
            cardCount: cards.length,
            title: headerTitle.trim(),
            hasSearchInput: !!searchInput,
            hasTipsBtn: !!tipsBtn
        };
    })()
    ''', 10)
    print(f"[TEST 1] Initial Load Status: {init_res['cardCount']} cards loaded, Search Input: {init_res['hasSearchInput']}, Tips Toggle: {init_res['hasTipsBtn']}")
    assert init_res['cardCount'] >= 50, "Expected >= 50 active cards on load"

    # 2. Test Exact Phrase Search: "open mic"
    quote_res = eval_js(ws, '''
    (() => {
        const input = document.getElementById("search-input");
        input.value = '"open mic"';
        input.dispatchEvent(new Event("input"));
        const cards = Array.from(document.querySelectorAll(".event-card"));
        const titles = cards.map(c => c.querySelector(".card-title")?.textContent.trim());
        const clearBtnVisible = document.getElementById("btn-clear-search").style.display !== "none";
        return { count: cards.length, titles, clearBtnVisible };
    })()
    ''', 20)
    print(f"\n[TEST 2] Search Query: '\"open mic\"' -> {quote_res['count']} card(s), Clear button visible: {quote_res['clearBtnVisible']}")
    for t in quote_res['titles']:
        print(f"  • {t}")
    assert quote_res['count'] >= 2, "Expected at least 2 open mic cards"
    assert quote_res['clearBtnVisible'], "Clear button must be visible when query is present"

    # 3. Test Negative Exclusion: comedy -improv
    neg_res = eval_js(ws, '''
    (() => {
        const input = document.getElementById("search-input");
        input.value = 'comedy -improv';
        input.dispatchEvent(new Event("input"));
        const cards = Array.from(document.querySelectorAll(".event-card"));
        const titles = cards.map(c => c.querySelector(".card-title")?.textContent.trim());
        const anyImprov = titles.some(t => t.toLowerCase().includes("improv"));
        return { count: cards.length, titles, anyImprov };
    })()
    ''', 30)
    print(f"\n[TEST 3] Search Query: 'comedy -improv' -> {neg_res['count']} card(s), Leaked 'improv': {neg_res['anyImprov']}")
    assert not neg_res['anyImprov'], "Negative exclusion failed: 'improv' leaked into titles!"
    assert neg_res['count'] > 0, "Expected non-improv comedy shows"

    # 4. Test Boolean OR: pottery OR ceramics
    or_res = eval_js(ws, '''
    (() => {
        const input = document.getElementById("search-input");
        input.value = 'pottery OR ceramics';
        input.dispatchEvent(new Event("input"));
        const cards = Array.from(document.querySelectorAll(".event-card"));
        const titles = cards.map(c => c.querySelector(".card-title")?.textContent.trim());
        return { count: cards.length, titles };
    })()
    ''', 40)
    print(f"\n[TEST 4] Search Query: 'pottery OR ceramics' -> {or_res['count']} card(s)")
    for t in or_res['titles']:
        print(f"  • {t}")
    assert any("Café au Clay" in t or "Hand Eye" in t or "Clay Club" in t for t in or_res['titles'])

    # 5. Test Field Operator: venue:roxy
    venue_res = eval_js(ws, '''
    (() => {
        const input = document.getElementById("search-input");
        input.value = 'venue:roxy';
        input.dispatchEvent(new Event("input"));
        const cards = Array.from(document.querySelectorAll(".event-card"));
        const venues = cards.map(c => c.querySelector(".venue-name")?.textContent.trim());
        return { count: cards.length, venues };
    })()
    ''', 50)
    print(f"\n[TEST 5] Search Query: 'venue:roxy' -> {venue_res['count']} card(s)")
    for v in venue_res['venues']:
        print(f"  • {v}")
        assert "Roxy" in v, f"Expected Roxy venue, got {v}"
    assert venue_res['count'] >= 2, f"Expected active Roxy events, got {venue_res['count']}"

    # 6. Test Price Operator: price:<20
    price_res = eval_js(ws, '''
    (() => {
        const input = document.getElementById("search-input");
        input.value = 'price:<20';
        input.dispatchEvent(new Event("input"));
        const cards = Array.from(document.querySelectorAll(".event-card"));
        const prices = cards.map(c => c.querySelector(".price-main")?.textContent.trim());
        return { count: cards.length, pricesSample: prices.slice(0, 5) };
    })()
    ''', 60)
    print(f"\n[TEST 6] Search Query: 'price:<20' -> {price_res['count']} card(s)")
    print(f"  Sample prices: {price_res['pricesSample']}")
    assert price_res['count'] > 20, "Expected numerous events under $20 CAD"

    # 7. Test Roving Venue Quality Control & Public Disco Event Details
    roving_res = eval_js(ws, '''
    (() => {
        const input = document.getElementById("search-input");
        input.value = 'public disco';
        input.dispatchEvent(new Event("input"));
        const cards = Array.from(document.querySelectorAll(".event-card"));
        const details = cards.map(c => {
            const title = c.querySelector(".card-title")?.textContent.trim();
            const organizerBadge = c.querySelector(".card-organizer-badge")?.textContent.trim();
            const venueName = c.querySelector(".venue-name")?.textContent.trim();
            const mapsLink = c.querySelector(".card-maps-link")?.href || "";
            const agePolicy = c.querySelector(".policy-pill.age-policy")?.textContent.trim();
            const admissionPolicy = c.querySelector(".policy-pill.admission-policy")?.textContent.trim();
            const rovingNote = c.querySelector(".card-roving-note")?.textContent.trim();
            const price = c.querySelector(".price-main")?.textContent.trim();
            return { title, organizerBadge, venueName, mapsLink, agePolicy, admissionPolicy, rovingNote, price };
        });
        return { count: cards.length, details };
    })()
    ''', 70)
    print(f"\n[TEST 7] Roving Venue Search 'public disco' -> {roving_res['count']} event card(s):")
    for d in roving_res['details']:
        print(f"  • Title: {d['title']}")
        print(f"    - Organizer Badge: {d['organizerBadge']}")
        print(f"    - Host Venue Pin: {d['venueName']}")
        print(f"    - Google Maps URL: {d['mapsLink']}")
        print(f"    - Age Policy: {d['agePolicy']}")
        print(f"    - Admission: {d['admissionPolicy']}")
        print(f"    - Note: {d['rovingNote']}")
        print(f"    - Price: {d['price']}")
        assert "Public Disco Society" in (d['organizerBadge'] or ""), "Missing organizer badge!"
        assert "Bentall" in d['venueName'] or "Birdhouse" in d['venueName'], f"Unexpected host venue: {d['venueName']}"
        assert "maps?q=" in d['mapsLink'] and ("49.2847" in d['mapsLink'] or "49.2678" in d['mapsLink']), "Google Maps must target host GPS coords!"

    # Scroll to Public Disco card and take screenshot
    eval_js(ws, '''
    (() => {
        const card = document.getElementById("card-public-disco-block-party") || document.querySelector(".event-card");
        if (card) card.scrollIntoView({ block: "center" });
        return true;
    })()
    ''', 75)
    time.sleep(0.5)
    screenshot_path1 = r'C:\Users\Micro\.gemini\antigravity-ide\brain\d51f9a38-6bf1-4ce0-9a9e-c5446ddcca5f\roving_venues_qc_demo.png'
    capture_screen(ws, screenshot_path1, 80)

    # 8. Test Search Tips Popover & Clear Button
    tips_res = eval_js(ws, '''
    (() => {
        // Open tips popover
        const tipsBtn = document.getElementById("btn-search-tips-toggle");
        tipsBtn.click();
        const popover = document.getElementById("search-tips-popover");
        const isPopoverVisible = popover.style.display !== "none";
        const samplePillsCount = popover.querySelectorAll(".search-tip-item").length;

        // Scroll search box into view for demo screenshot
        document.querySelector(".search-wrapper").scrollIntoView({ block: "center" });
        return { isPopoverVisible, samplePillsCount };
    })()
    ''', 90)
    print(f"\n[TEST 8] Search Tips Popover: Visible={tips_res['isPopoverVisible']}, Operators count={tips_res['samplePillsCount']}")
    assert tips_res['isPopoverVisible'], "Search tips popover should be visible after clicking toggle"
    assert tips_res['samplePillsCount'] >= 6, "Expected at least 6 sample operator pills in popover"

    time.sleep(0.5)
    screenshot_path2 = r'C:\Users\Micro\.gemini\antigravity-ide\brain\d51f9a38-6bf1-4ce0-9a9e-c5446ddcca5f\google_search_tips_popover_demo.png'
    capture_screen(ws, screenshot_path2, 100)

    # 9. Click an Operator Pill in Popover to verify sample application
    click_sample_res = eval_js(ws, '''
    (() => {
        // Click the first tip item (which calls applySearchSample)
        const sampleItem = document.querySelector(".search-tip-item");
        if (sampleItem) sampleItem.click();
        const inputVal = document.getElementById("search-input").value;
        const popoverHidden = document.getElementById("search-tips-popover").style.display === "none";
        const cardCount = document.querySelectorAll(".event-card").length;
        return { inputVal, popoverHidden, cardCount };
    })()
    ''', 110)
    print(f"\n[TEST 9] Clicked Search Tip Pill:")
    print(f"  • Applied Query: {click_sample_res['inputVal']}")
    print(f"  • Popover auto-closed: {click_sample_res['popoverHidden']}")
    print(f"  • Filtered cards: {click_sample_res['cardCount']}")
    assert click_sample_res['popoverHidden'], "Popover should close after selecting a sample operator"
    assert click_sample_res['cardCount'] > 0, "Cards should be filtered by the applied sample"

    # 10. Test Clear Button (✕)
    clear_res = eval_js(ws, '''
    (() => {
        const clearBtn = document.getElementById("btn-clear-search");
        clearBtn.click();
        const inputVal = document.getElementById("search-input").value;
        const cardCount = document.querySelectorAll(".event-card").length;
        const clearBtnHidden = clearBtn.style.display === "none";
        return { inputVal, cardCount, clearBtnHidden };
    })()
    ''', 120)
    print(f"\n[TEST 10] Clicked Clear Button (✕):")
    print(f"  • Input value: '{clear_res['inputVal']}' (expected empty)")
    print(f"  • Restored cards: {clear_res['cardCount']}")
    print(f"  • Clear button hidden: {clear_res['clearBtnHidden']}")
    assert clear_res['inputVal'] == "", "Input should be empty after clearing"
    assert clear_res['cardCount'] >= 50, "Full card catalog should be restored after clearing search"
    assert clear_res['clearBtnHidden'], "Clear button should hide when input is empty"

    print("\n" + "=" * 75)
    print("ALL BROWSER TESTS PASSED CLEANLY (0 Errors, 0 Regressions)!")
    print("=" * 75)

finally:
    proc.terminate()
