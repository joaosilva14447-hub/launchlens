# LaunchLens

LaunchLens is a professional-grade Solana token discovery terminal built for the Birdeye Data Sprint 1 competition.

It turns raw launch activity into a ranked decision layer by combining:

- fresh token listings
- trending momentum signals
- overview-level liquidity and participation data
- a scoring model for quality, momentum, and structure
- plain-English catalysts and risk notes

Instead of forcing traders to manually inspect multiple endpoints one by one, LaunchLens surfaces the strongest live candidates in a single screenshot-friendly interface.

## Product thesis

New-token discovery is noisy.

Most feeds tell you what is new, but not what is worth attention. LaunchLens narrows that gap by taking Birdeye launch data and converting it into a readable board that helps traders quickly answer:

- Is this token early enough to matter?
- Is there enough liquidity to care?
- Is participation actually building?
- Is momentum expanding or fading?
- Is this worth placing on a watchlist right now?

## Why this project is competitive

LaunchLens is built to score well across all four Birdeye judging pillars.

### Community Support

- strong visual identity
- easy-to-share leaderboard and spotlight layouts
- clear product story for screenshots, videos, and X posts

### Product Utility

- real-time discovery of fresh Solana launches
- ranked watchlist instead of raw API output
- detail panel with catalysts, risks, and context for rapid triage

### Technical Depth

- secure server-side API proxy
- live multi-endpoint data composition
- caching and backoff handling
- graceful degradation when optional data is rate-limited
- custom scoring engine tuned for launch discovery

### Presentation

- polished interface
- clear methodology section
- submission-ready repo structure and docs
- concise explanation of endpoints and product value

## Birdeye endpoints used

- `/defi/v2/tokens/new_listing`
- `/defi/token_trending`
- `/defi/token_overview`

## Core features

- **Radar Spotlight**
  Highlights the top-ranked candidate immediately above the fold.
- **Ranked Watchlist**
  Surfaces tokens by flight score with useful metrics at a glance.
- **Decision Detail Panel**
  Explains why a token is surfacing, what supports it, and what weakens it.
- **Signal Controls**
  Filter by verdict, search by token, sort by momentum, structure, liquidity, or score.
- **Presentation-first layout**
  Designed to look strong in screenshots, demos, and social clips.

## Scoring model

LaunchLens ranks tokens across three weighted dimensions:

- **Quality**
  Liquidity support, holder breadth, wallet activity, and market coverage.
- **Momentum**
  Price acceleration, participation, and short-term expansion signals.
- **Structure**
  Freshness, liquidity support, cap profile, and ability to absorb attention.

These roll into a single `flight score` that powers the leaderboard.

## Architecture

### Backend

- zero-dependency Node.js HTTP server
- secure API proxy to keep the Birdeye key out of the browser
- in-memory response caching
- retry/backoff behavior for rate-limited requests
- graceful fallback when optional feeds are temporarily unavailable

### Frontend

- static HTML/CSS/JS
- fast local startup
- no dependency install required
- optimized for demo clarity and screenshot quality

## Local setup

1. Create a local env file from the example:

```bash
copy .env.example .env.local
```

2. Add your Birdeye API key to `.env.local`

3. Start the app:

```bash
node server.js
```

4. Open:

```text
http://localhost:3000
```

## Windows quick start

You can also use:

```text
start-launchlens.bat
```

## Deployment

LaunchLens is ready for public deployment as a lightweight Node.js web service.

Recommended hosts:

- `Render`
- `Railway`

Deployment files included:

- [render.yaml](C:\Users\ASUS\OneDrive\Documentos\Playground 4\birdeye-launchlens\render.yaml)
- [railway.json](C:\Users\ASUS\OneDrive\Documentos\Playground 4\birdeye-launchlens\railway.json)
- [DEPLOYMENT.md](C:\Users\ASUS\OneDrive\Documentos\Playground 4\birdeye-launchlens\DEPLOYMENT.md)
- [GITHUB_PUBLISH.md](C:\Users\ASUS\OneDrive\Documentos\Playground 4\birdeye-launchlens\GITHUB_PUBLISH.md)

Required production environment variables:

- `BIRDEYE_API_KEY`
- `BIRDEYE_CHAIN=solana`

Health check endpoint:

- `/api/health`

## Smoke test

To validate the key and live endpoint access:

```powershell
.\scripts\api-smoke.ps1
```

## Project structure

```text
birdeye-launchlens/
  public/
    index.html
    styles.css
    app.js
  scripts/
    api-smoke.ps1
    smoke.mjs
  server.js
  .nvmrc
  render.yaml
  railway.json
  DEPLOYMENT.md
  GITHUB_PUBLISH.md
  README.md
  SUBMISSION_NOTES.md
  X_POST_DRAFT.md
  DEMO_SCRIPT.md
  start-launchlens.bat
```

## Notes

- the Birdeye API key is never exposed to the browser
- the implementation is intentionally built around endpoints confirmed to work with the current API plan
- the app remains usable even when trending is briefly rate-limited
- repeated refreshes comfortably exceed the 50 API-call threshold for Sprint 1 qualification

## Suggested positioning for submission

> LaunchLens is a real-time Solana launch radar powered by Birdeye that ranks new and trending tokens by quality, momentum, and structure so traders can spot cleaner breakout candidates faster.

## Submission checklist

- app runs locally
- `.env.local` stays out of git
- screenshots capture the spotlight + leaderboard + detail panel
- repo includes README and clear endpoint references
- X post explains utility, not just visuals
- submission text names the exact Birdeye endpoints used

## Security note

The current API key was exposed earlier in chat context. Rotate it before publishing or sharing the repo beyond your local machine.
