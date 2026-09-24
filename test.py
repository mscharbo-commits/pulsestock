#!/usr/bin/env python3
"""
PulseStock Site Health Check
Run: python3 test.py
Catches regressions before users see them.
"""
import urllib.request, json, sys

BASE = "https://pulsestock-nu.vercel.app"
PASS, FAIL = [], []

def check(name, fn):
    try:
        ok = fn()
        (PASS if ok else FAIL).append(name)
        print(f"  {'✓' if ok else '✗'} {name}")
    except Exception as e:
        FAIL.append(name)
        print(f"  ✗ {name} — {str(e)[:80]}")

def get(path, t=10):
    req = urllib.request.Request(f"{BASE}{path}", headers={"User-Agent":"PS-Test/1.0"})
    with urllib.request.urlopen(req, timeout=t) as r:
        return json.loads(r.read())

def post(path, body, t=20):
    req = urllib.request.Request(f"{BASE}{path}", data=json.dumps(body).encode(),
        headers={"Content-Type":"application/json","User-Agent":"PS-Test/1.0"})
    with urllib.request.urlopen(req, timeout=t) as r:
        return json.loads(r.read())

def html_get(t=10):
    req = urllib.request.Request(BASE, headers={"User-Agent":"PS-Test/1.0"})
    with urllib.request.urlopen(req, timeout=t) as r:
        return r.read().decode()

print("\n=== PulseStock Health Check ===\n")

print("[ Core APIs ]")
check("ticker-bar",        lambda: len(get("/api/ticker-bar")) > 0)
check("market-pulse",      lambda: get("/api/market-pulse").get("sentiment") is not None)
check("AAPL quote",        lambda: get("/api/metrics?ticker=AAPL").get("price",0) > 0)
check("NVDA quote",        lambda: get("/api/metrics?ticker=NVDA").get("price",0) > 0)
check("TSLA quote",        lambda: get("/api/metrics?ticker=TSLA").get("price",0) > 0)
check("AAPL analyst",      lambda: get("/api/analyst?ticker=AAPL").get("recommendations") is not None)
check("AAPL news",         lambda: len(get("/api/news?ticker=AAPL")) > 0)
check("picks-cache",       lambda: get("/api/picks-cache") is not None)
check("analysis-cache",    lambda: get("/api/analysis-cache?ticker=AAPL&action=check") is not None)

print("\n[ AI Chat ]")
def test_chat():
    d = post("/api/chat", {"messages":[{"role":"user","content":"What is SPY?"}],"system":"Stock analyst."})
    text = "".join(c.get("text","") for c in d.get("content",[]) if c.get("type")=="text")
    return len(text) > 20
check("chat returns response", test_chat)

print("\n[ Homepage HTML ]")
def test_home():
    h = html_get()
    required = ["PulseStock","ticker-input","ai-chat-input","market-overview","FUNDAMENTAL"]
    missing = [k for k in required if k not in h]
    if missing: print(f"    Missing: {missing}")
    return not missing
check("homepage has key elements", test_home)

print("\n[ AI Analysis — AAPL ]")
def test_analysis():
    d = post("/api/analyze-cached", {
        "ticker":"AAPL","tier":"free","forceRefresh":False,
        "system":"You are an institutional analyst.",
        "messages":[{"role":"user","content":"Analyze AAPL. Current price $220. VERDICT: BUY | Target: $245 | Confidence: High\n\nFUNDAMENTAL ANALYSIS\nTest.\n\nTECHNICAL ANALYSIS\nTest."}]
    })
    # Should be streaming SSE — just check it responds 200
    return d is not None
check("analyze-cached responds", test_analysis)

print(f"\n{'='*35}")
total = len(PASS)+len(FAIL)
print(f"Passed: {len(PASS)}/{total}")
if FAIL:
    print(f"FAILED: {', '.join(FAIL)}")
    print("\n⛔ Do NOT deploy until all checks pass.")
    sys.exit(1)
else:
    print("✅ All checks passed — safe to deploy.")
