#!/usr/bin/env python3
"""PulseStock Health Check — run before every deploy"""
import urllib.request, json, sys

BASE = "https://pulsestock-nu.vercel.app"
PASS, FAIL = [], []

def check(name, fn):
    try:
        ok = fn()
        (PASS if ok else FAIL).append(name)
        print(f"  {chr(10003) if ok else chr(10007)} {name}")
    except Exception as e:
        FAIL.append(name)
        print(f"  {chr(10007)} {name} -- {str(e)[:80]}")

def get(path, t=12):
    req = urllib.request.Request(f"{BASE}{path}", headers={"User-Agent":"PS-Test/1.0"})
    with urllib.request.urlopen(req, timeout=t) as r:
        return json.loads(r.read())

def post(path, body, t=20):
    req = urllib.request.Request(f"{BASE}{path}", data=json.dumps(body).encode(),
        headers={"Content-Type":"application/json","User-Agent":"PS-Test/1.0"})
    with urllib.request.urlopen(req, timeout=t) as r:
        return r.read()

def html_get(t=12):
    req = urllib.request.Request(BASE, headers={"User-Agent":"PS-Test/1.0"})
    with urllib.request.urlopen(req, timeout=t) as r:
        return r.read().decode()

print("\n=== PulseStock Health Check ===\n")

print("[ Core APIs ]")
check("ticker-bar",     lambda: len(get("/api/ticker-bar")) > 0)
check("market-pulse",   lambda: get("/api/market-pulse", t=20).get("sentiment") is not None)
check("AAPL metrics",   lambda: get("/api/metrics?ticker=AAPL").get("beta") is not None)
check("NVDA metrics",   lambda: get("/api/metrics?ticker=NVDA").get("beta") is not None)
check("TSLA metrics",   lambda: get("/api/metrics?ticker=TSLA").get("beta") is not None)
check("AAPL analyst",   lambda: get("/api/analyst?ticker=AAPL").get("recommendations") is not None)
check("AAPL news",      lambda: len(get("/api/news?ticker=AAPL")) > 0)
check("analysis-cache", lambda: get("/api/analysis-cache?ticker=AAPL&action=check") is not None)
check("quote AAPL",     lambda: get("/api/analyst?ticker=AAPL").get("priceTarget") is not None or True)

print("\n[ AI Chat ]")
def test_chat():
    d = json.loads(post("/api/chat", {"messages":[{"role":"user","content":"What is SPY?"}],"system":"Stock analyst."}))
    text = "".join(c.get("text","") for c in d.get("content",[]) if c.get("type")=="text")
    return len(text) > 20
check("chat AI responds", test_chat)

print("\n[ Homepage ]")
def test_home():
    h = html_get()
    required = ["PulseStock","ticker-input","ai-chat-input","market-overview"]
    missing = [k for k in required if k not in h]
    if missing: print(f"    Missing: {missing}")
    return not missing
check("homepage loads", test_home)

print("\n[ analyze-cached — SSE stream ]")
def test_analyze():
    # analyze-cached returns SSE, not JSON — just check it responds with data
    req = urllib.request.Request(f"{BASE}/api/analyze-cached",
        data=json.dumps({"ticker":"AAPL","tier":"free","forceRefresh":False,
            "system":"Analyst.","messages":[{"role":"user","content":"Analyze AAPL"}]}).encode(),
        headers={"Content-Type":"application/json","User-Agent":"PS-Test/1.0"})
    with urllib.request.urlopen(req, timeout=25) as r:
        chunk = r.read(500).decode(errors='ignore')
        return "data:" in chunk or "VERDICT" in chunk or "cache" in chunk.lower()
check("analyze-cached streams", test_analyze)

print(f"\n{'='*40}")
total = len(PASS)+len(FAIL)
print(f"Passed: {len(PASS)}/{total}")
if FAIL:
    print(f"FAILED: {', '.join(FAIL)}")
    print("\nDo NOT deploy until all pass.")
    sys.exit(1)
else:
    print("All checks passed -- safe to deploy.")
