# Birdeye Submission Notes

## Project name

LaunchLens

## One-line description

LaunchLens is a real-time Solana launch radar powered by Birdeye that ranks fresh listings and emerging momentum by quality, participation, and breakout strength.

## Short submission description

LaunchLens helps traders discover new Solana tokens faster without manually checking multiple dashboards. It combines Birdeye new listings, trending activity, and token overview metrics into a single ranked terminal, then translates those inputs into a readable flight score, catalysts, risk notes, and a presentation-ready spotlight view.

## Medium submission description

LaunchLens is a launch discovery terminal built on Birdeye for Sprint 1. The product monitors fresh Solana listings, checks for trending overlap, enriches each candidate with token overview data, and ranks tokens by three weighted dimensions: quality, momentum, and structure. The result is a cleaner watchlist for traders and researchers who want to separate noisy launches from candidates that actually deserve attention.

## Birdeye endpoints used

- `/defi/v2/tokens/new_listing`
- `/defi/token_trending`
- `/defi/token_overview`

## Technical highlights

- secure server-side API proxy so the Birdeye key never reaches the browser
- live multi-endpoint composition into a single ranked response
- in-memory caching for responsive refreshes
- retry and backoff handling for rate-limited requests
- graceful degradation when optional data is temporarily unavailable
- custom scoring system based on liquidity, participation, market breadth, and momentum

## Product utility angle

- spot newly listed Solana tokens faster
- identify which launches are attracting actual participation
- rank opportunities instead of dumping raw endpoint output
- explain why a token is surfacing through catalysts and risk notes

## Presentation angle

- polished spotlight section for the top-ranked token
- leaderboard and detail panel designed for screenshots and short demos
- clear methodology section so the ranking feels credible instead of arbitrary

## Suggested paste-ready final answer

LaunchLens is a real-time Solana launch radar built with Birdeye. It uses `/defi/v2/tokens/new_listing`, `/defi/token_trending`, and `/defi/token_overview` to turn raw launch activity into a ranked watchlist. Each candidate is scored across quality, momentum, and structure, then surfaced with catalysts, risks, and a detail panel to help traders decide what deserves attention first.

