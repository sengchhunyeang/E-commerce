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

# Password for the Telegram settings on /admin (sent as the X-Admin-Key header)
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '')
# The class reminder scheduler sends "Authorization: Bearer <CRON_SECRET>"
CRON_SECRET = os.environ.get('CRON_SECRET', '')
