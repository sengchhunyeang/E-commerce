# E-commerce

Flask + Neon Postgres shop with customer accounts, categories, reviews, wishlist,
cash-on-delivery checkout, order tracking and an admin dashboard.

## Run locally

```
pip install -r requirements.txt
cp .env.example .env   # then put your Neon DATABASE_URL and a SECRET_KEY in it
python migrate.py
python app.py
```

Sign up at http://127.0.0.1:5000/signup, then make yourself admin:

```
python make_admin.py you@example.com
```

## Deploy to Vercel

Pushing to `main` auto-deploys. See [deploy.md](deploy.md) for the pre-push checklist.

1. Push this repo to GitHub.
2. In Vercel, **Add New → Project** and import the repo.
3. Under **Environment Variables**, add `DATABASE_URL` (the Neon pooled connection string) and `SECRET_KEY`.
4. Deploy. Run `python migrate.py` locally against the same database to create the tables.

## Telegram bot

The bot sends the admin a message for every new order, with buttons to mark it
shipped / delivered / cancelled. Anyone can send `/products`; the admin can also
use `/orders` and `/order <id>`.

1. Put `TELEGRAM_BOT_TOKEN` (from @BotFather) and a random `TELEGRAM_WEBHOOK_SECRET` in `.env`.
2. Run `python telegram_bot.py poll`, send `/myid` to the bot, and copy the number
   into `TELEGRAM_ADMIN_CHAT_ID`. Restart the poller (and `app.py`) afterwards.

Locally, keep `python telegram_bot.py poll` running next to `python app.py`.

On Vercel, add the three `TELEGRAM_*` variables to the project, redeploy, then run
`python telegram_bot.py set-webhook https://your-site.vercel.app` once.
