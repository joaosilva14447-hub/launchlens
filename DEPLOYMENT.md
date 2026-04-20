# Deployment Guide

LaunchLens is ready to deploy as a lightweight Node.js web service.

## Recommended hosting options

### Render

Render is the simplest fit for the current architecture because LaunchLens is a plain Node HTTP server.

What to do:

1. Push this project to GitHub.
2. In Render, choose **New Web Service**.
3. Connect the GitHub repo.
4. Render should detect [`render.yaml`](C:\Users\ASUS\OneDrive\Documentos\Playground 4\birdeye-launchlens\render.yaml) automatically.
5. Add the environment variable:
   - `BIRDEYE_API_KEY=your_new_key`
6. Confirm `BIRDEYE_CHAIN=solana`.
7. Deploy.

Health check:

- `GET /api/health`

Primary app URL after deploy:

- `/`

### Railway

Railway also works well for this project.

What to do:

1. Push this project to GitHub.
2. Create a new Railway project from the repo.
3. Railway should use [`railway.json`](C:\Users\ASUS\OneDrive\Documentos\Playground 4\birdeye-launchlens\railway.json).
4. Add:
   - `BIRDEYE_API_KEY=your_new_key`
   - `BIRDEYE_CHAIN=solana`
5. Deploy.

## Required environment variables

- `BIRDEYE_API_KEY`
- `BIRDEYE_CHAIN=solana`

Do not set `PORT` manually on the host unless the platform explicitly requires it. LaunchLens already respects the host-provided port.

## Pre-deploy checklist

- Rotate the previously exposed API key.
- Confirm [`.env.local`](C:\Users\ASUS\OneDrive\Documentos\Playground 4\birdeye-launchlens\.env.local) contains the new key locally.
- Keep `.env.local` out of git.
- Test locally with:

```bash
node server.js
```

- Validate health:

```text
http://localhost:3000/api/health
```

## Post-deploy checklist

- Open the live home page.
- Click `Refresh Radar`.
- Confirm the board loads real Birdeye data.
- Open `/api/health` on the live URL.
- Capture final screenshots from the live deployment, not localhost.

## Suggested publish order

1. Rotate API key
2. Push to GitHub
3. Deploy to Render or Railway
4. Validate live app
5. Capture screenshots and demo clip
6. Publish X post
7. Submit competition entry
