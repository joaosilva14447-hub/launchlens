# GitHub Publish Steps

Use these steps after rotating the Birdeye API key.

## 1. Confirm `.env.local` is still private

This repo already ignores:

- `.env`
- `.env.local`

Do not commit the live API key.

## 2. Review local changes

```bash
git status
```

## 3. Stage the repo

```bash
git add .
```

## 4. Create the first commit

```bash
git commit -m "Launch LaunchLens competition build"
```

## 5. Create a GitHub repository

Recommended name:

- `launchlens`

Suggested description:

- `Real-time Solana launch radar powered by Birdeye Data`

## 6. Connect the remote

Replace `YOUR_USERNAME` after creating the repo:

```bash
git remote add origin https://github.com/YOUR_USERNAME/launchlens.git
```

## 7. Push the main branch

```bash
git push -u origin main
```

## 8. Deploy

After GitHub is live:

- use [render.yaml](C:\Users\ASUS\OneDrive\Documentos\Playground 4\birdeye-launchlens\render.yaml) on Render
- or use [railway.json](C:\Users\ASUS\OneDrive\Documentos\Playground 4\birdeye-launchlens\railway.json) on Railway

## 9. Production environment variables

Add these in the host dashboard:

- `BIRDEYE_API_KEY`
- `BIRDEYE_CHAIN=solana`

## 10. Final competition assets

Before submitting:

- capture 3 clean screenshots from the live URL
- record a short demo clip
- publish the X post
- submit the live link, GitHub repo, and X link together
