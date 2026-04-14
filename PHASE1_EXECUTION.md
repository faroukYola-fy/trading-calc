# Trading Calc 2.0 - Phase 1 Execution (Vanilla JS + MongoDB)

Date: 2026-04-14

## Scope Alignment
- Frontend stack switched from React to Vanilla JavaScript SPA.
- Backend direction switched from Supabase to MongoDB (Mongoose).
- UI direction switched from dark terminal to light playful style.

## Phase 1 Checklist Status
- [x] Foundation backend bootstrapped with MongoDB connection (`server.js`).
- [x] Authentication API with role selection (`/api/auth/register`, `/api/auth/login`, `/api/auth/me`).
- [x] Profile management API (`/api/profile`).
- [x] Single-page calculator suite with tab + swipe navigation (all 5 calculators).
- [x] Light design system and responsive UI.
- [x] PWA baseline (`manifest.webmanifest`, `sw.js`, installable icons).

## Phase 1 Hardening Status
- [x] Added input/unit validation tests for all calculator formulas (`tests/calculators.test.js`).
- [x] Added API rate limiting and brute-force protection for auth endpoints.
- [x] Added session refresh + token rotation policy with revocable refresh sessions.
- [ ] Replace SVG icons with PNG icon set (192x192, 512x512) if required by target app stores.

## Cleanup Completed
- Removed legacy 2022 multi-page files and old JS/CSS/assets.
- Retained the new SPA-only structure under `public/` plus backend `models/` and `server.js`.
