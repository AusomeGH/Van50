"""
test_browser_search.py - Headless browser live UI search test
"""
import subprocess
import json
import time
import urllib.request
import websocket
import sys

sys.stdout.reconfigure(encoding='utf-8')

def test_browser():
    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    port = 9222
    temp_dir = r'C:\Users\Micro\.gemini\antigravity-ide\scratch\van50\scratch_chrome_live'
    cmd = [
        chrome_path, '--headless=new', f'--remote-debugging-port={port}',
        '--remote-allow-origins=*', '--disable-gpu', '--no-first-run',
        f'--user-data-dir={temp_dir}_{int(time.time())}', 'http://127.0.0.1:8080/'
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(2)

    try:
        req = urllib.request.urlopen(f'http://127.0.0.1:{port}/json')
        targets = json.loads(req.read().decode('utf-8'))
        page_target = next(t for t in targets if t.get('type') == 'page')
        ws = websocket.create_connection(page_target['webSocketDebuggerUrl'], timeout=5)
        ws.send(json.dumps({'id': 1, 'method': 'Runtime.enable'}))
        time.sleep(1)

        queries = [
            'frankies',
            'lanalous',
            'guilt and co',
            'water street cafe',
            'Local live bands'
        ]

        for q in queries:
            eval_script = f'''
            (() => {{
                const inp = document.getElementById("search-input");
                inp.value = "{q}";
                inp.dispatchEvent(new Event("input", {{ bubbles: true }}));
                const cards = document.querySelectorAll(".event-card");
                const count = cards.length;
                const titles = Array.from(cards).map(c => c.querySelector(".card-title").innerText.trim());
                return {{ q: "{q}", count: count, titles: titles }};
            }})()
            '''
            ws.send(json.dumps({'id': 10, 'method': 'Runtime.evaluate', 'params': {'expression': eval_script, 'returnByValue': True}}))
            time.sleep(0.4)
            while True:
                msg = json.loads(ws.recv())
                if msg.get('id') == 10:
                    val = msg.get('result', {}).get('result', {}).get('value')
                    print(f"  ✓ Live Search '{val['q']}': {val['count']} card(s) -> {val['titles']}")
                    break

        ws.close()
    finally:
        proc.terminate()

if __name__ == '__main__':
    test_browser()
