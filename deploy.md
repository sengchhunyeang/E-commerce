# Deploy

GitHub repo: `https://github.com/sengchhunyeang/E-commerce`, hosted on Vercel.

**Every push to `main` auto-deploys to production. Every push to any other
branch gets a preview URL.** These are Vercel's built-in Git integration
features, so no GitHub Actions are needed.

## One-time setup

1. Go to <https://vercel.com/new>, choose **Import Git Repository**, and pick
   `sengchhunyeang/E-commerce`. Framework preset: **Other**. Vercel reads
   `vercel.json`, so leave the build settings empty.
2. Under **Settings → Environment Variables**, add the following for
   *Production* and *Preview*:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon **pooled** (`-pooler`) connection string |
   | `TELEGRAM_BOT_TOKEN` | Token from @BotFather |
   | `TELEGRAM_ADMIN_CHAT_ID` | `-1004386248183` (Alertbot group) |
   | `TELEGRAM_WEBHOOK_SECRET` | The same random string as in `.env` |

3. Deploy. Then point the bot at the live site once:

   ```
   python telegram_bot.py set-webhook https://<your-project>.vercel.app
   python telegram_bot.py info     # should print the webhook URL with no error
   ```

4. Make sure **Settings → Git → Production Branch** is `main`.

## Before every push (checklist)

1. **No secrets staged.** `git status` must not list `.env`, `shop.db` or `venv/`.
   ```
   git diff --cached --name-only
   ```
2. **Code compiles.**
   ```
   python -m py_compile app.py config.py telegram_bot.py migrate.py routes/*.py core/*.py
   ```
3. **Dependencies.** If you imported a new package, add it to `requirements.txt`.
4. **Database.** If you added `migrations/NNN_*.sql`, run `python migrate.py`
   **before** pushing. The new code may expect the new tables, and Vercel never
   runs migrations.
5. **New environment variables.** Add them in Vercel → Settings → Environment
   Variables, and add a placeholder to `.env.example`.
6. **Docs.** Update `CLAUDE.md` (change log) and this file if the deploy steps changed.
7. Push:
   ```
   git add -A
   git commit -m "..."
   git push origin main
   ```
8. Watch the deployment in the Vercel dashboard (Deployments tab). Then open the
   site and send `/products` to the bot.

## Telegram: webhook vs. polling

Telegram sends updates to **only one** place at a time.

- **Production:** a webhook pointing at `https://<site>/api/telegram/webhook`.
- **Local dev:** `python telegram_bot.py poll` **deletes the webhook.** When you
  finish testing locally, run `set-webhook` again or production stops responding.

A redeploy does not change the webhook. You only need to run `set-webhook` again
if the domain changes or you have been polling.

## Rollback

In Vercel → Deployments, open the last good deployment → **⋯ → Promote to
Production**. Or run `git revert <commit>` and push.
