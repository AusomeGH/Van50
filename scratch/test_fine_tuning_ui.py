import subprocess
import json
import time
import urllib.request
import websocket
import sys
import os
import shutil
import base64

sys.stdout.reconfigure(encoding='utf-8')

def send_eval(ws, req_id, expression):
    ws.send(json.dumps({'id': req_id, 'method': 'Runtime.evaluate', 'params': {'expression': expression, 'returnByValue': True}}))
    while True:
        raw = ws.recv()
        data = json.loads(raw)
        if data.get('id') == req_id:
            return data.get('result', {}).get('result', {}).get('value')

def capture_screenshot(ws, req_id, output_path):
    ws.send(json.dumps({'id': req_id, 'method': 'Page.captureScreenshot', 'params': {'format': 'png'}}))
    while True:
        raw = ws.recv()
        data = json.loads(raw)
        if data.get('id') == req_id:
            img_bytes = base64.b64decode(data['result']['data'])
            with open(output_path, 'wb') as f:
                f.write(img_bytes)
            print(f"  ✓ Screenshot saved: {output_path}")
            return

def test_fine_tuning():
    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    port = 9224
    temp_dir = r'C:\Users\Micro\.gemini\antigravity-ide\scratch\van50\scratch_chrome_ft'
    cmd = [
        chrome_path, '--headless=new', f'--remote-debugging-port={port}',
        '--remote-allow-origins=*', '--disable-gpu', '--no-first-run',
        '--window-size=1280,960',
        f'--user-data-dir={temp_dir}_{int(time.time())}', 'http://127.0.0.1:8080/'
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(2.5)

    try:
        req = urllib.request.urlopen(f'http://127.0.0.1:{port}/json')
        targets = json.loads(req.read().decode('utf-8'))
        page_target = next(t for t in targets if t.get('type') == 'page')
        ws = websocket.create_connection(page_target['webSocketDebuggerUrl'], timeout=10)
        ws.send(json.dumps({'id': 1, 'method': 'Runtime.enable'}))
        ws.send(json.dumps({'id': 2, 'method': 'Page.enable'}))
        time.sleep(1)

        # -------------------------------------------------------------
        # Issue 1: Google Maps Pinpointing
        # -------------------------------------------------------------
        script_maps = '''
        (() => {
            const cards = Array.from(document.querySelectorAll(".event-card"));
            let validPinpoints = 0;
            const samples = [];
            for (const c of cards) {
                const btn = c.querySelector(".venue-location-btn");
                if (btn) {
                    const href = btn.getAttribute("href");
                    if (href.startsWith("https://www.google.com/maps?q=") && href.includes("+(")) {
                        validPinpoints++;
                        if (samples.length < 3) samples.push({ id: c.id, href: href });
                    }
                }
            }
            return { totalCards: cards.length, validPinpoints: validPinpoints, samples: samples };
        })()
        '''
        res_maps = send_eval(ws, 10, script_maps)
        print(f"[TEST 1] Google Maps Direct Pinpointing:")
        print(f"  • Valid Pinpoint Links: {res_maps['validPinpoints']} / {res_maps['totalCards']}")
        for s in res_maps['samples']:
            print(f"    Sample [{s['id']}]: {s['href']}")
        assert res_maps['validPinpoints'] == res_maps['totalCards'], "All cards must have exact coordinate pinpoint links!"

        # -------------------------------------------------------------
        # Issue 2: Public Disco Roving Dance Parties
        # -------------------------------------------------------------
        script_disco = '''
        (() => {
            const evs = (window.VANCOUVER_EVENTS || []).filter(e => e.id.includes("public-disco"));
            return evs.map(e => ({
                id: e.id,
                title: e.title,
                venue: e.venue,
                price: e.price,
                websiteUrl: e.websiteUrl,
                category: e.category
            }));
        })()
        '''
        res_disco = send_eval(ws, 20, script_disco)
        print(f"\n[TEST 2] Public Disco Roving Events in Runtime ({len(res_disco)}):")
        for d in res_disco:
            print(f"  • [{d['id']}] {d['title']} | ${d['price']} CAD | {d['venue']} | URL: {d['websiteUrl']}")
        assert len(res_disco) == 2, f"Expected 2 Public Disco events, got {len(res_disco)}"
        assert any(d['price'] == 0 for d in res_disco), "Missing free daytime Public Disco event"
        assert any(d['price'] == 20 for d in res_disco), "Missing ticketed warehouse dance night"

        # -------------------------------------------------------------
        # Issue 3: Direct Deep Links
        # -------------------------------------------------------------
        script_deep_links = '''
        (() => {
            const evs = window.VANCOUVER_EVENTS || [];
            const cafe = evs.find(e => e.id === "cafe-au-clay-pottery-painting");
            const basic = evs.find(e => e.id === "basic-inquiry-life-drawing");
            const handeye = evs.find(e => e.id === "hand-eye-ceramics-open-studio");
            const slice = evs.find(e => e.id === "slice-of-life-craft-night");

            return {
                cafe: cafe ? { url: cafe.websiteUrl, title: cafe.title } : null,
                basic: basic ? { url: basic.websiteUrl, title: basic.title } : null,
                handeye: handeye ? { url: handeye.websiteUrl, title: handeye.title } : null,
                slice: slice ? { url: slice.websiteUrl, title: slice.title } : null
            };
        })()
        '''
        res_dl = send_eval(ws, 30, script_deep_links)
        print(f"\n[TEST 3] Direct Ticketing / Booking Deep Links:")
        print(f"  • Café au Clay: {res_dl['cafe']['url']}")
        print(f"  • Basic Inquiry: {res_dl['basic']['url']}")
        print(f"  • Hand Eye Ceramics: {res_dl['handeye']['url']}")
        print(f"  • Slice of Life: {res_dl['slice']['url']}")
        assert res_dl['cafe']['url'] == "https://cafeauclay.com/products/drop-in-pottery-painting", "Café au Clay must deep link to /products/drop-in-pottery-painting"
        assert res_dl['basic']['url'] == "https://lifedrawing.org/sessions", "Basic Inquiry must deep link to /sessions"
        assert res_dl['handeye']['url'] == "https://handeyeceramics.com/open-studio", "Hand Eye Ceramics must deep link to /open-studio"
        assert res_dl['slice']['url'] == "https://www.slicevancouver.ca/events", "Slice of Life must deep link to /events"

        # -------------------------------------------------------------
        # Issue 4: Pricing Accuracy & Pottery Drop-In Classifier
        # -------------------------------------------------------------
        script_pricing = '''
        (() => {
            const evs = window.VANCOUVER_EVENTS || [];
            const handeye = evs.find(e => e.id === "hand-eye-ceramics-open-studio");
            const cafe = evs.find(e => e.id === "cafe-au-clay-pottery-painting");
            const claymatesInActive = evs.some(e => e.id.includes("claymates"));

            return {
                handeyePrice: handeye ? handeye.price : null,
                cafePrice: cafe ? cafe.price : null,
                claymatesInActive: claymatesInActive
            };
        })()
        '''
        res_pr = send_eval(ws, 40, script_pricing)
        print(f"\n[TEST 4] Pricing Accuracy & Course/Drop-In Classifier:")
        print(f"  • Hand Eye Ceramics Drop-In: ${res_pr['handeyePrice']} CAD")
        print(f"  • Café au Clay: ${res_pr['cafePrice']} CAD")
        print(f"  • Claymates in active catalog: {res_pr['claymatesInActive']}")
        assert res_pr['handeyePrice'] == 26.25, f"Hand Eye Ceramics drop-in price should be $26.25 all-in ($25 + GST), got {res_pr['handeyePrice']}"
        assert res_pr['claymatesInActive'] is False, "Claymates must NOT be in the active catalog (quarantined due to $175 multi-week course)"

        # -------------------------------------------------------------
        # Issue 5: Slice of Life Gallery Multi-Program Expansion
        # -------------------------------------------------------------
        script_slice = '''
        (() => {
            const evs = (window.VANCOUVER_EVENTS || []).filter(e => e.venue && e.venue.includes("Slice of Life"));
            return evs.map(e => ({
                id: e.id,
                title: e.title,
                price: e.price,
                days: e.daysOfWeek
            }));
        })()
        '''
        res_sl = send_eval(ws, 50, script_slice)
        print(f"\n[TEST 5] Slice of Life Gallery Multi-Programs ({len(res_sl)}):")
        for s in res_sl:
            print(f"  • [{s['id']}] {s['title']} | ${s['price']} CAD | Days: {s['days']}")
        assert len(res_sl) == 4, f"Expected 4 distinct Slice of Life programs, got {len(res_sl)}"
        assert any("Craft & Printmaking" in s['title'] for s in res_sl), "Missing Craft & Printmaking Night"
        assert any("Life Drawing Club" in s['title'] for s in res_sl), "Missing Life Drawing Club"
        assert any("Clay Club" in s['title'] for s in res_sl), "Missing Clay Club"
        assert any("LEGO Night" in s['title'] for s in res_sl), "Missing LEGO Night"

        # -------------------------------------------------------------
        # Issue 6: Smart Search Overhaul (Typo tolerance, Stemming, Cross-category)
        # -------------------------------------------------------------
        script_search_typo = '''
        (() => {
            const input = document.getElementById("search-input");
            // Typo search: "publi disco" (missing c)
            input.value = "publi disco";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            const cards = Array.from(document.querySelectorAll(".event-card")).map(c => c.id);
            return cards;
        })()
        '''
        cards_typo = send_eval(ws, 60, script_search_typo)
        print(f"\n[TEST 6a] Fuzzy Search with Typo ('publi disco'):")
        print(f"  • Matched cards ({len(cards_typo)}): {cards_typo}")
        assert len(cards_typo) >= 2, f"Expected at least 2 cards for typo 'publi disco', got {len(cards_typo)}"
        assert any("public-disco" in cid for cid in cards_typo), "Public disco must match 'publi disco'"

        script_search_stemming = '''
        (() => {
            const input = document.getElementById("search-input");
            // Stemming test: "ceramic"
            input.value = "ceramic";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            const cards = Array.from(document.querySelectorAll(".event-card")).map(c => c.id);
            return cards;
        })()
        '''
        cards_stem = send_eval(ws, 61, script_search_stemming)
        print(f"\n[TEST 6b] Stemming Search ('ceramic'):")
        print(f"  • Matched cards ({len(cards_stem)}): {cards_stem}")
        assert any("hand-eye-ceramics" in cid for cid in cards_stem), "Hand Eye Ceramics must match 'ceramic'"

        # Test Cross-Category Discovery Prompt
        script_cross_category = '''
        (() => {
            // Select 'Crafts & Studios' category
            const craftPill = Array.from(document.querySelectorAll(".category-pill")).find(p => p.innerText.includes("Crafts & Studios"));
            if (craftPill) craftPill.click();

            // Type "disco" (which is in social / music, 0 in crafts)
            const input = document.getElementById("search-input");
            input.value = "disco";
            input.dispatchEvent(new Event("input", { bubbles: true }));

            const countBar = document.getElementById("results-count");
            const btnCross = countBar ? countBar.querySelector(".btn-cross-category") : null;

            return {
                btnFound: !!btnCross,
                btnText: btnCross ? btnCross.innerText.trim() : null
            };
        })()
        '''
        res_cross = send_eval(ws, 62, script_cross_category)
        print(f"\n[TEST 6c] Cross-Category Discovery Prompt:")
        print(f"  • Cross category button found: {res_cross['btnFound']}")
        print(f"  • Cross category button text: {res_cross['btnText']}")
        assert res_cross['btnFound'] is True, "Cross-category search button must appear when 0 results in active category"
        assert "across all categories" in res_cross['btnText'], "Button must indicate matches across all categories"

        # Click the reset category button in prompt
        script_click_reset_cat = '''
        (() => {
            const btn = document.querySelector(".btn-cross-category");
            if (btn) btn.click();
            const cards = Array.from(document.querySelectorAll(".event-card")).map(c => c.id);
            return cards;
        })()
        '''
        cards_after_reset = send_eval(ws, 63, script_click_reset_cat)
        print(f"  • After clicking cross-category button: {len(cards_after_reset)} cards rendered ({cards_after_reset})")
        assert len(cards_after_reset) >= 2, "Expected Public Disco events rendered after 1-click reset"

        # -------------------------------------------------------------
        # Issue 7: "See All Events at This Venue" Filter Button & Top Banner
        # -------------------------------------------------------------
        # Reset search input first
        send_eval(ws, 70, '''
        (() => {
            const input = document.getElementById("search-input");
            input.value = "";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            const allBtn = Array.from(document.querySelectorAll(".category-pill")).find(p => p.innerText.includes("All"));
            if (allBtn) allBtn.click();
        })()
        ''')
        time.sleep(0.5)

        script_venue_filter = '''
        (() => {
            // Find a Slice of Life card and its venue filter button
            const sliceCard = document.querySelector("#card-slice-of-life-craft-night");
            const filterBtn = sliceCard ? sliceCard.querySelector(".btn-venue-filter") : null;
            const btnText = filterBtn ? filterBtn.innerText.trim() : "";
            
            // Click it
            if (filterBtn) filterBtn.click();

            const banner = document.querySelector(".active-venue-banner");
            const bannerText = banner ? banner.innerText.trim() : "";
            const renderedCards = Array.from(document.querySelectorAll(".event-card")).map(c => ({
                id: c.id,
                title: c.querySelector(".card-title").innerText.trim(),
                venue: c.querySelector(".venue-name-text") ? c.querySelector(".venue-name-text").innerText.trim() : ""
            }));

            return {
                btnText: btnText,
                bannerFound: !!banner,
                bannerText: bannerText,
                cardsCount: renderedCards.length,
                cards: renderedCards
            };
        })()
        '''
        res_vf = send_eval(ws, 71, script_venue_filter)
        print(f"\n[TEST 7] 'See All Events at This Venue' Filter & Banner:")
        print(f"  • Button text: '{res_vf['btnText']}'")
        print(f"  • Active Venue Banner Found: {res_vf['bannerFound']}")
        print(f"  • Banner Text: '{res_vf['bannerText']}'")
        print(f"  • Filtered Cards Count: {res_vf['cardsCount']}")
        for c in res_vf['cards']:
            print(f"    - [{c['id']}] {c['title']} @ {c['venue']}")
        
        assert "events here" in res_vf['btnText'], f"Button text expected 'events here', got '{res_vf['btnText']}'"
        assert res_vf['bannerFound'] is True, "Active venue banner must be present at top of list"
        assert "Slice of Life Gallery & Studios" in res_vf['bannerText'], "Banner must show venue name"
        assert res_vf['cardsCount'] == 4, f"Expected exactly 4 Slice of Life events, got {res_vf['cardsCount']}"

        # Capture a screenshot of the isolated venue view
        artifact_screenshot = r'C:\Users\Micro\.gemini\antigravity-ide\brain\d51f9a38-6bf1-4ce0-9a9e-c5446ddcca5f\venue_filter_and_search_view.png'
        capture_screenshot(ws, 72, artifact_screenshot)

        # Test Clearing the Venue Filter
        script_clear_venue = '''
        (() => {
            const clearBtn = document.querySelector(".btn-clear-venue");
            if (clearBtn) clearBtn.click();
            const cards = document.querySelectorAll(".event-card");
            const banner = document.querySelector(".active-venue-banner");
            return { cardsCount: cards.length, bannerFound: !!banner };
        })()
        '''
        res_clear = send_eval(ws, 73, script_clear_venue)
        print(f"  • After clicking 'Clear Venue Filter': {res_clear['cardsCount']} cards, banner present: {res_clear['bannerFound']}")
        assert res_clear['bannerFound'] is False, "Banner must disappear when venue filter is cleared"
        assert res_clear['cardsCount'] == res_maps['totalCards'], f"All {res_maps['totalCards']} active events should be restored, got {res_clear['cardsCount']}"

        ws.close()
        print("\n======================================================================")
        print("ALL 7 FINE-TUNING LIVE BROWSER TESTS PASSED FLAWLESSLY!")
        print("======================================================================")

    finally:
        proc.terminate()
        for d in os.listdir(r'C:\Users\Micro\.gemini\antigravity-ide\scratch\van50'):
            if d.startswith('scratch_chrome_ft'):
                try:
                    shutil.rmtree(os.path.join(r'C:\Users\Micro\.gemini\antigravity-ide\scratch\van50', d), ignore_errors=True)
                except Exception:
                    pass

if __name__ == '__main__':
    test_fine_tuning()
