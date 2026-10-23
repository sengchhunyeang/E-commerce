# Deploy

GitHub repo: `https://github.com/sengchhunyeang/E-commerce`, hosted on Vercel.

**Every push to `main` auto-deploys to production. Every push to any other
branch gets a preview URL.** These are Vercel's built-in Git integration
features. GitHub Actions is used only to trigger the class reminder (see below).

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
   | `CRON_SECRET` | The same random string as in `.env` |
   | `AWS_ENDPOINT_URL_S3` | Neon storage endpoint (Neon console → Connect → Storage) |
   | `AWS_ACCESS_KEY_ID` | Neon storage key ID (`nak_live_…`) |
   | `AWS_SECRET_ACCESS_KEY` | Neon storage secret (`nsk_live_…`) |
   | `AWS_REGION` | `ap-southeast-1` |
   | `S3_BUCKET` | `e-commerce` |

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

## Class reminder

Edit everything on the **/admin** page (no password, so anyone with the URL can change it): the
meeting link, alert time, class start and end times, class days, the message
text and the group chat ID. No push is needed. The settings live in the
`class_reminder` table, which local and production share because they use the
same Neon database.

**How it gets sent:** `.github/workflows/class-reminder.yml` calls
`GET /api/class-reminder/run` every 5 minutes. The endpoint sends the message
once per class day, at the first call after the alert time (within an hour of it).
GitHub's scheduler often runs late, so expect the message 0–15 minutes after the
alert time.

One-time setup in GitHub → repo **Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `CRON_SECRET` | Same as `.env` and Vercel |
| Variable | `SITE_URL` | Public production URL, e.g. `https://<project>.vercel.app` (no trailing `/`) |

Then go to **Actions → Class reminder → Run workflow** to test it. The run
prints `{"sent": false, ...}` until the alert time.

- `SITE_URL` must be the public production domain. The
  `*-sengchhunyeangs-projects.vercel.app` URLs sit behind Vercel's login and
  return a redirect.
- GitHub pauses scheduled workflows after 60 days with no commits. Push a
  commit or re-enable the workflow under Actions.
- If you need it on time to the minute, use cron-job.org instead: point it at
  the same URL every 5 minutes with the header
  `Authorization: Bearer <CRON_SECRET>`.

## Rollback

In Vercel → Deployments, open the last good deployment → **⋯ → Promote to
Production**. Or run `git revert <commit>` and push.
