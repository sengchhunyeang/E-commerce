# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo.

## What this project is

A small Flask shop backed by Neon Postgres, deployed on Vercel, with a Telegram
bot that alerts the admin about new orders and lets them change order status.
Customers sign up to check out; admins manage the shop on `/admin`.

## Layout

| Path | What it does |
| --- | --- |
| `app.py` | `create_app()` registers the blueprints. Vercel imports the module-level `app`. |
| `config.py` | Loads `.env`. `DATABASE_URL` and `SECRET_KEY` are required; the `TELEGRAM_*` settings are optional. |
| `core/db.py` | psycopg connection pool, the `Table` helper and `rpc()` for calling SQL functions. Connections use autocommit (each `query()` is one statement) and are only health-checked after 30 s idle, so a query costs one round trip to Neon. |
| `core/validation.py`, `core/responses.py` | Request validation and JSON error handlers. |
| `core/telegram.py` | Telegram Bot API client using only the standard library: `api`, `send`, `notify` / `notify_admin` (never raise), `bot_username`, `format_order`. |
| `core/auth.py` | Password hashing (Werkzeug), `current_user()`, and the `@login_required` / `@admin_required` guards. |
| `routes/auth.py` | `/api/auth`: signup, signin, signout, `me` (read/update profile), password, `forgot`/`reset` (password reset link), `telegram` (connect/disconnect the customer's Telegram). |
| `routes/products.py` | `/api/products` (writes are admin-only): sale ("was") price, featured flag, gallery `images`, `variants` (options with their own stock/price), `/related`, and reviews (`/api/products/<id>/reviews`). |
| `routes/orders.py` | `/api/orders`: `quote` prices a cart; checkout and `/mine` need a signed-in customer; admin listing has filters + pagination. Customers cancel pending orders and upload bank transfer screenshots (`/payment`); admins change status and mark payments paid. |
| `routes/categories.py`, `routes/wishlist.py` | `/api/categories` (writes admin-only) and the customer's `/api/wishlist`. |
| `routes/coupons.py` | `/api/coupons` (admin): discount codes (% or $, min spend, usage limit, expiry). |
| `routes/settings.py` | `/api/settings`: one-row `shop_settings` (shop details for invoices, shipping fee, free-shipping threshold, tax %, low-stock threshold, bank/KHQR details). Read is public; write is admin. |
| `routes/admin.py` | `/api/admin`: dashboard stats, `reports` (revenue per day, top products, categories, payment methods), `orders.csv` export, customer list, role changes. |
| `core/mail.py` | Resend email client (urllib). Optional: `RESEND_API_KEY`, `MAIL_FROM`. |
| `make_admin.py` | CLI: `python make_admin.py you@example.com` makes an existing account admin (needed for the first admin). |
| `core/storage.py` | Neon Object Storage client (boto3, path-style). `upload(key, data, type)` and `download(key)`. Bucket: `S3_BUCKET` (`e-commerce`), which is **private**. |
| `routes/images.py` | Product image upload (`POST /api/images`, ≤ 4 MB, JPG/PNG/WebP/GIF) to the bucket under `products/<uuid>.<ext>`. Images are served through the app at `/api/images/products/<file>`. A product's `image_url` points there. Older uploads in the Postgres `images` table are still served at `/api/images/<id>`. |
| `routes/telegram.py` | Bot command handlers and the `/api/telegram/webhook` endpoint. |
| `routes/class_reminder.py` | Class reminder settings API and the scheduler's `/run` endpoint. |
| `routes/pages.py`, `templates/`, `static/` | The single-page storefront. `static/app.js` has a view per route: `/`, `/product/<id>`, `/cart`, `/wishlist`, `/orders`, `/orders/<id>`, `/orders/<id>/invoice`, `/signin`, `/signup`, `/forgot`, `/reset`, `/account`, `/admin[/orders|products|categories|coupons|customers|reports|settings|reminder]`. |
| `migrations/*.sql`, `migrate.py` | SQL migrations, applied in name order and tracked in `schema_migrations`. |
| `telegram_bot.py` | CLI: `poll`, `set-webhook <url>`, `delete-webhook`, `info`. |
| `vercel.json` | Sends every route to `app.py` through `@vercel/python`. |
| `.github/workflows/class-reminder.yml` | Calls the class reminder `/run` endpoint every 5 minutes. |

## Accounts

- `users` table (`migrations/004_accounts_and_shop.sql`): email is unique ignoring case
  and stored lowercased. Roles are `customer` and `admin`.
- Login is Flask's signed session cookie (`SECRET_KEY`, 30 days, `HttpOnly`, `SameSite=Lax`,
  `Secure` on Vercel). The cookie stores a fingerprint of the password hash, so changing the
  password signs out every other device.
- Every admin API is behind `@admin_required`, including image upload and the class reminder
  settings. This replaces the old password-free `/admin` (2026-10-26).
- Checkout requires an account; the order email is the account email. The delivery phone and
  address are saved to the profile to prefill the next checkout.
- Order status goes through the `set_order_status()` SQL function: cancelling puts the items
  (and option stock) back, returns the coupon use, and a cancelled order can't be reopened.
  Delivered cash-on-delivery orders become paid. Every change is added to `order_events`
  (the customer's tracking timeline). Use `set_status()` in `routes/orders.py` (the Telegram
  buttons do too), never a plain `orders.update()`; it also messages the customer on Telegram.
- Prices are computed in SQL (`migrations/005_shop_features.sql`): `order_charges()` applies the
  coupon, shipping and tax; `quote_order()` (checkout summary) and `place_order()` both use it,
  so the shown total always matches the order. A product with variants keeps
  `stock` = the sum of its variants (`save_variants()`); the cart key is `productId:variantId`.
- Payment is cash on delivery or bank transfer/KHQR (turn it on in Admin → Settings). Bank
  customers upload a screenshot, stored privately in the bucket under `payments/` and served
  only to the owner and admins; the admin confirms it on the site or with the Telegram button.
- Password reset: a one-hour link (only its sha256 is stored in `password_resets`), sent by email
  through Resend when configured and to the customer's Telegram if connected.

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
- **Admin UI:** the "Class reminder" tab, `/admin/reminder`
  (`drawReminder()` in `static/app.js`). Its API is in `routes/class_reminder.py`.
  The settings API needs an admin login (it was open until 2026-10-26).
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
- 2026-10-26: Customer accounts (sign up / sign in, profile, password change) and
  admin roles; every admin API now needs an admin login. Added categories, reviews
  and ratings, wishlist, shipping details at checkout, "My orders" with cancel
  (restocks), and an admin dashboard with tabs (stats, orders, products,
  categories, customers, reminder). New env var `SECRET_KEY`; migration 004;
  `make_admin.py`.
- 2026-10-27: Coupons, shipping fee / free-shipping threshold / tax, product galleries and
  options (variants), sale prices, featured and related products, printable invoices, order
  tracking timeline, bank transfer/KHQR payment with screenshot upload, Telegram updates for
  customers (connect from the account page), low-stock Telegram alerts, sales reports with
  CSV export, admin order filters and pagination, password reset (Resend email and/or
  Telegram). Migration 005; optional env vars `RESEND_API_KEY`, `MAIL_FROM`.
- 2026-10-27: Faster pages: one database round trip per query (autocommit, fewer connection
  checks), catalog reads cached in the browser for 60 s (cleared by any change; not on admin
  pages) and prefetched on link hover, lazy-loaded images, and skeleton loading screens.
  Sign out button in the navbar.
