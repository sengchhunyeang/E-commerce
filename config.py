"""Settings loaded from the .env file."""
import os

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get('DATABASE_URL', '')

if not DATABASE_URL:
    raise RuntimeError('Set DATABASE_URL (your Neon connection string) in the .env file')

# Telegram bot (optional — leave the token empty to turn the bot off)
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_ADMIN_CHAT_ID = os.environ.get('TELEGRAM_ADMIN_CHAT_ID', '')
TELEGRAM_WEBHOOK_SECRET = os.environ.get('TELEGRAM_WEBHOOK_SECRET', '')

# Daily class reminder (sent by Vercel Cron, see vercel.json)
CLASS_REMINDER_CHAT_ID = os.environ.get('CLASS_REMINDER_CHAT_ID', '')
# Vercel sends "Authorization: Bearer <CRON_SECRET>" on every cron call
CRON_SECRET = os.environ.get('CRON_SECRET', '')
