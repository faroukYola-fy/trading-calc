# Trading Calc 2.0

Trading Calc 2.0 is now a Vanilla JavaScript SPA with a MongoDB backend foundation.

## Current Phase (Phase 1 + Hardening)
- Single-page calculator suite with 5 calculators (TP, SL, PnL, Percentage, Liquidation).
- Light, playful responsive UI.
- MongoDB-backed auth + profile management.
- Access/refresh token session flow with rotation.
- API rate limiting and login brute-force protection.
- PWA baseline (manifest + service worker).

## Run Locally
1. Copy `.env.example` to `.env` and set values.
2. Install dependencies: `npm install`
3. Start app: `npm start`

## Test
- Calculator unit tests: `npm test`
