#!/usr/bin/env python3
"""PulseStock Health Check — run before every deploy
Usage: python3 ~/Desktop/test-pulsestock.py
"""
import urllib.request, json, sys

BASE = "https://pulsestock-nu.vercel.app"
PASS, FAIL = [], []

def check(name, fn):
    try:
        ok = fn()
        (PASS if ok else FAIL).append(name)
        print(f"  {'OK' if ok else 'FAIL'} {name}")
    except Exception as e:
        FAIL.append(name)
        print(f"  FAIL {name} -- {str(e)[:80]}")

def get(path, t=15):
    req = urllib.request.Request(f"{BASE}{path}", headers={"User-Agent":"PS-Test/1.0"})
    with urllib.request.urlopen(req, timeout=t) as r:
        return json.loads(r.read())

def post_json(path, body, t=20):
    req = urllib.request.Request(f"{BASE}{path}", data=json.dumps(body).encode(),
        headers={"Content-Type":"application/json","User-Agent":"PS-Test/1.0"})
    with urllib.request.urlopen(req, timeout=t) as r:
        return json.loads(r.read())

def post_raw(path, body, t=25):
    req = urllib.request.Request(f"{BASE}{path}", data=json.dumps(body).encode(),
        headers={"Content-Type":"application/json","User-Agent":"PS-Test/1.0"})
    with urllib.request.urlopen(req, timeout=t) as r:
        return r.read(1000).decode(errors='ignore')

print("\n=== PulseStock Health Check ===\n")

print("[ Core APIs ]")
check("ticker-bar loads",       lambda: len(get("/api/ticker-bar")) > 0)
check("market-pulse loads",     lambda: get("/api/market-pulse", t=25) is not None)
check("AAPL metrics loads",     lambda: get("/api/metrics?ticker=AAPL") is not None)
check("NVDA metrics loads",     lambda: get("/api/metrics?ticker=NVDA") is not None)
check("TSLA metrics loads",     lambda: get("/api/metrics?ticker=TSLA") is not None)
check("AAPL analyst loads",     lambda: get("/api/analyst?ticker=AAPL") is not None)
check("AAPL news loads",        lambda: len(get("/api/news?ticker=AAPL")) > 0)
check("analysis-cache loads",   lambda: get("/api/analysis-cache?ticker=AAPL&action=check") is not None)

print("\n[ AI Chat ]")
def test_chat():
    d = post_json("/api/chat", {
        "messages":[{"role":"user","content":"What is SPY?"}],
        "system":"You are a stock analyst."
    })
    text = "".join(c.get("text","") for c in d.get("content",[]) if c.get("type")=="text")
    return len(text) > 20
check("chat AI responds", test_chat)

print("\n[ Homepage ]")
def test_home():
    req = urllib.request.Request(BASE, headers={"User-Agent":"PS-Test/1.0"})
    with urllib.request.urlopen(req, timeout=12) as r:
        h = r.read().decode()
    required = ["PulseStock","ticker-input","ai-chat-input","market-overview"]
    missing = [k for k in required if k not in h]
    if missing: print(f"    Missing: {missing}")
    return not missing
check("homepage has key elements", test_home)

print("\n[ AI Analysis ]")
def test_analyze():
    raw = post_raw("/api/analyze-cached", {
        "ticker":"AAPL","tier":"free","forceRefresh":False,
        "system":"Analyst.","messages":[{"role":"user","content":"Analyze AAPL"}]
    })
    return "data:" in raw or "cache" in raw.lower() or "VERDICT" in raw
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
