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
| `core/storage.py` | Neon Object Storage client (boto3, path-style). `upload(key, data, type)` and `download(key)`. Bucket: `S3_BUCKET` (`e-commerce`), which is **private**. |
| `routes/images.py` | Product image upload (`POST /api/images`, ≤ 4 MB, JPG/PNG/WebP/GIF) to the bucket under `products/<uuid>.<ext>`. Images are served through the app at `/api/images/products/<file>`. A product's `image_url` points there. Older uploads in the Postgres `images` table are still served at `/api/images/<id>`. |
| `routes/telegram.py` | Bot command handlers and the `/api/telegram/webhook` endpoint. |
| `routes/class_reminder.py` | Class reminder settings API and the scheduler's `/run` endpoint. |
| `routes/pages.py`, `templates/`, `static/` | The storefront page. |
| `migrations/*.sql`, `migrate.py` | SQL migrations, applied in name order and tracked in `schema_migrations`. |
| `telegram_bot.py` | CLI: `poll`, `set-webhook <url>`, `delete-webhook`, `info`. |
| `vercel.json` | Sends every route to `app.py` through `@vercel/python`. |
| `.github/workflows/class-reminder.yml` | Calls the class reminder `/run` endpoint every 5 minutes. |

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

- **Settings:** the one-row `class_reminder` table (`migrations/002_class_reminder.sql`):
  meeting link, alert/start/end times (Cambodia time, UTC+7), ISO class days,
  message with `{link}` `{start}` `{end}` placeholders, and group chat ID
  (default: the Python+AI-21-09-2026 group, `-1003785397029`).
- **Admin UI:** the "Telegram class reminder" form at the top of `/admin`
  (`drawReminder()` in `static/app.js`). Its API is in `routes/class_reminder.py`.
  By the user's choice, the settings API has no password, the same as the rest of `/admin`.
- **Sending:** `.github/workflows/class-reminder.yml` calls
  `GET /api/class-reminder/run` (with `Authorization: Bearer <CRON_SECRET>`)
  every 5 minutes. `is_due()` sends once per day, within 1 hour after
  `alert_time`, on class days only. `last_sent_on` is claimed before sending,
  so overlapping calls can't send twice.
- Vercel Cron isn't used because the Hobby plan only allows one fixed time a
  day, which can't follow an alert time set in the admin page.

## Conventions

- Secrets go only in `.env` (gitignored) and in Vercel's environment variables.
  `.env.example` contains placeholders only.
- Schema changes go in a new `migrations/NNN_name.sql` file. Never edit a
  migration that has already been applied.
- `requirements.txt` stays minimal. The bot uses `urllib`, not `requests`;
  `boto3` is there only for object storage.

## Deploying

Pushing to `main` on GitHub auto-deploys to Vercel. Before every push, follow
the checklist in [deploy.md](deploy.md).

## Known local issue

On this Windows machine, an Application Control policy has sometimes blocked
psycopg's binary DLL, so `import psycopg` failed (it worked on 2026-10-23). If
it fails, syntax-check with `python -m py_compile ...` instead.

## Change log

- 2026-10: Added the Telegram bot (order alerts, status buttons, webhook and
  polling modes). Set the admin chat to the Alertbot group. Added `deploy.md`
  with the pre-push checklist and Vercel auto-deploy setup.
- 2026-10-22: Added a daily class reminder (Google Meet link) to the class group
  through Vercel Cron, sent 1 hour before the 7:30 PM class.
- 2026-10-23: Made the class reminder editable on `/admin` (link, alert time,
  class times, days, message, chat ID). Replaced the Vercel Cron job with a
  GitHub Actions trigger every 5 minutes. Removed the admin password at the
  user's request.
- 2026-10-23: White page background. Product image upload in Admin; images
  are stored in Postgres (`migrations/003_product_images.sql`) because Vercel's
  disk is read-only.
- 2026-10-23: Moved new image uploads to Neon Object Storage (preview
  feature, bucket `e-commerce`). The bucket is private, so the app serves
  images through itself. Added `boto3` to the requirements.
