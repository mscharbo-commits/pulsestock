# PulseStock — Deploy Instructions

## Option 1: Netlify (easiest, 30 seconds)
1. Go to https://netlify.com/drop
2. Drag the entire `pulsestock` folder onto the page
3. Done — you get a live URL instantly
4. Add env var: ANTHROPIC_API_KEY = your key (Site settings > Env vars)

## Option 2: Vercel CLI
```bash
npm i -g vercel
cd pulsestock
vercel
# Follow prompts, then add env var:
vercel env add ANTHROPIC_API_KEY
```

## Option 3: Vercel Dashboard
1. Push this folder to GitHub
2. Import at vercel.com/new
3. Add environment variable: ANTHROPIC_API_KEY

## Getting your Anthropic API Key
1. Go to https://console.anthropic.com
2. API Keys > Create Key
3. Copy and paste into your deployment env vars
