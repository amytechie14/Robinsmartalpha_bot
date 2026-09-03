# RobinsmartAlpha — Robinhood Chain Telegram Bot

A simple, honest MVP: real price/liquidity/volume/contract data for tokens on
Robinhood Chain (chain ID 4663), via Telegram. No fake scores, no invented
whale/insider/smart-money data — those require infrastructure this MVP
intentionally leaves out (see "What this bot does NOT do" below).

## Commands

- `/start` – welcome + what the bot can/can't do
- `/help` – command list
- `/analyze <address>` – price, 24h change, market cap, FDV, liquidity,
  volume, contract verification, holder count
- `/trending` – top trending pools on Robinhood Chain right now
- `/new` – newest pools on Robinhood Chain

## Data sources

- [GeckoTerminal API](https://www.geckoterminal.com/dex-api) — free, public,
  no key required — price, liquidity, volume, FDV, market cap
- [Blockscout API](https://robinhoodchain.blockscout.com) — Robinhood
  Chain's official block explorer — contract verification, holder count

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and paste in your bot token from
   [@BotFather](https://t.me/BotFather)
3. `npm start`

## Deploying so it stays online

See the full non-developer walkthrough provided alongside this file. In
short: push this folder to a free Railway.app (or Render.com) web service,
set `TELEGRAM_BOT_TOKEN` as an environment variable there, and it runs
24/7 without your computer needing to stay on.

## What this bot does NOT do

The original spec this is based on ("RobinsmartAlpha") describes a full
production intelligence platform: whale tracking, insider detection,
smart-money wallet scoring, social momentum, a 10X Potential score, a
backtesting engine, a Postgres/Redis/BullMQ backend, and a web dashboard.
That's a multi-month build requiring paid infrastructure (Alchemy/RPC
indexing, a database server, licensed social data) and, per the spec's own
rules, those scores can't be presented as meaningful until they've been
backtested against real historical outcomes. This MVP deliberately covers
only what can be shown with real, live data today. It's built to be
extended in phases, the way the original spec itself recommends.