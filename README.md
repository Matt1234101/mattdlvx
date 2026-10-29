# LuckyDemo — Play-Money Casino Demo

A mobile-first casino-style web app that uses **play credits only**. There is no real money, no payment provider, no withdrawals — credits have no cash value. The "Deposit" button simply grants free demo credits (capped at 5,000 per 24 h).

## Stack
- Node.js 18+ (tested on Node 24), Express 5
- SQLite via `better-sqlite3` (file `casino.db`, created automatically)
- `bcryptjs` password hashing, `express-session` with a SQLite-backed session store
- Vanilla JS/CSS single-page frontend in `public/` (no build step)

## Run locally
```bash
npm install          # if npm asks about install scripts: npm install-scripts approve better-sqlite3
npm start            # http://localhost:3000
```
Environment variables (optional): `PORT` (default 3000), `DB_PATH` (default `./casino.db`), `SESSION_SECRET` (set this in any persistent deployment; otherwise a random secret is generated each start, which logs everyone out on restart).

## Features
- Sign up / log in / log out (bcrypt-hashed passwords, httpOnly session cookie). New accounts start with **10,000 credits**.
- Dashboard modeled on a dark casino UI: balance in the top bar, green **Deposit** (free top-up, 5,000/24 h limit), notification bell, **VIP Loyalty Program** card (Bronze → Silver 5k → Gold 25k → Platinum 100k → Diamond 500k, based on total wagered, with progress bar and original SVG sports-car illustration), **Bonuses** card (original SVG gift; Welcome bonus 2,500 once, Daily bonus 500 every 24 h), **All games** carousel.
- Games — every outcome is decided on the server with `crypto.randomInt`; the client only animates the result:
  - **Plinko** — 12 rows, low/medium/high risk (~99% RTP)
  - **Slots** — 3 reels, weighted symbols, 3-of-a-kind pays 4×–200×, any pair returns the bet (~97.5% RTP)
  - **Dice** — roll over/under a target 2–98, payout = 99 / win-chance (99% RTP)
  - **Crash** — choose an auto cash-out multiplier; win if the rocket gets there before crashing (99% RTP)
- Server-side bet validation: min bet 1, max bet 5,000, must not exceed balance (checked inside a DB transaction), numeric input only.
- History page with **Bets** and **Transactions** (signup credit, bonuses, deposits, bets, payouts with running balance).
- Profile page with stats (bets, wagered, won, biggest win, net), VIP progress, logout.
- Responsive: phone layout with bottom nav; centered layout on desktop.

## API (JSON)
`POST /api/signup`, `POST /api/login`, `POST /api/logout`, `GET /api/me`, `POST /api/deposit {amount}`, `GET /api/bonuses`, `POST /api/bonuses/:id/claim`, `POST /api/games/:game/bet {amount, ...}` (dice: `target`, `direction`; plinko: `risk`; crash: `cashout`), `GET /api/bets`, `GET /api/transactions`, `GET /api/notifications`, `GET /api/games/config`.

## End-to-end test & screenshots
With the server running and Google Chrome installed:
```bash
BASE=http://localhost:3000 CHROME=/usr/bin/google-chrome npm run e2e
```
This signs up a new user, claims both bonuses, deposits, plays every game, checks history/profile, reloads and re-logs in to confirm the balance persisted, and writes PNGs to `screenshots/`.

## Important
This is a demo/prototype. Operating a real-money gambling product requires gaming licences, age/KYC checks, responsible-gambling tooling and a licensed payment provider in every jurisdiction you serve. None of that is included here.
