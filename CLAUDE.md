# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo.

## What this project is

A small Flask shop backed by Neon Postgres, deployed on Vercel, with a Telegram
bot that alerts the admin about new orders and lets them change order status.

## Layout

| Path | What it does |
| --- | --- |
| `app.py` | `create_app()` registers the blueprints. Vercel imports the module-level `app`. |
| `config.py` | Loads `.env`. `DATABASE_URL` is required; the `TELEGRAM_*` settings are optional. |
| `core/db.py` | psycopg connection pool, the `Table` helper and `rpc()` for calling SQL functions. |
| `core/validation.py`, `core/responses.py` | Request validation and JSON error handlers. |
| `core/telegram.py` | Telegram Bot API client using only the standard library: `api`, `send`, `notify_admin`, `format_order`. |
| `routes/products.py`, `routes/orders.py` | REST API under `/api/products` and `/api/orders`. |
| `routes/telegram.py` | Bot command handlers and the `/api/telegram/webhook` endpoint. |
| `routes/pages.py`, `templates/`, `static/` | The storefront page. |
| `migrations/*.sql`, `migrate.py` | SQL migrations, applied in name order and tracked in `schema_migrations`. |
| `telegram_bot.py` | CLI: `poll`, `set-webhook <url>`, `delete-webhook`, `info`. |
| `vercel.json` | Sends every route to `app.py` through `@vercel/python`. |

## Telegram bot

- Placing an order calls `notify_admin()` in `routes/orders.py`. It never raises,
  so a Telegram outage can't break checkout.
- `TELEGRAM_ADMIN_CHAT_ID` is the **"Alertbot" group** (`-1004386248183`).
  `is_admin()` only compares chat IDs, so every member of that group can use the
  admin commands (`/orders`, `/order <id>`, the status buttons).
- Telegram delivers updates to the webhook **or** to polling, never both. Running
  `python telegram_bot.py poll` deletes the production webhook; afterwards, run
  `set-webhook` again (see `deploy.md`).

## Class reminder

Vercel Cron (`vercel.json` → `crons`, schedule in UTC) calls
`GET /api/telegram/class-reminder` daily at 11:30 UTC (6:30 PM Asia/Phnom_Penh).
The endpoint posts `CLASS_REMINDER` to `CLASS_REMINDER_CHAT_ID`, the
Python+AI-21-09-2026 group (`-1003785397029`). It rejects any request whose
header isn't `Authorization: Bearer <CRON_SECRET>`.

## Conventions

- Secrets go only in `.env` (gitignored) and in Vercel's environment variables.
  `.env.example` contains placeholders only.
- Schema changes go in a new `migrations/NNN_name.sql` file. Never edit a
  migration that has already been applied.
- `requirements.txt` stays minimal. The bot uses `urllib`, not `requests`.

## Deploying

Pushing to `main` on GitHub auto-deploys to Vercel. Before every push, follow
the checklist in [deploy.md](deploy.md).

## Known local issue

On this Windows machine, an Application Control policy blocks psycopg's binary
DLL, so `import psycopg` fails locally. Syntax-check with
`python -m py_compile ...` instead, or test on Vercel/Linux.

## Change log

- 2026-10: Added the Telegram bot (order alerts, status buttons, webhook and
  polling modes). Set the admin chat to the Alertbot group. Added `deploy.md`
  with the pre-push checklist and Vercel auto-deploy setup.
- 2026-10-22: Added a daily class reminder (Google Meet link) to the class group
  through Vercel Cron, sent 1 hour before the 7:30 PM class.
