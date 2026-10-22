"""Manage the Telegram bot.

Usage:
    python telegram_bot.py poll                      run the bot locally (no public URL needed)
    python telegram_bot.py set-webhook https://...   point Telegram at your deployed site
    python telegram_bot.py delete-webhook            stop sending updates to the site
    python telegram_bot.py info                      show the bot and webhook status

Reads TELEGRAM_* settings from .env.
"""
import sys

from config import TELEGRAM_WEBHOOK_SECRET
from core.telegram import TelegramError, api
from routes.telegram import handle_update

COMMANDS = [
    {'command': 'products', 'description': "What's for sale"},
    {'command': 'orders', 'description': 'Latest orders (admin)'},
    {'command': 'order', 'description': 'Order details: /order <id> (admin)'},
    {'command': 'myid', 'description': 'Show your chat ID'},
    {'command': 'help', 'description': 'Show help'},
]


def poll():
    # Telegram only allows one delivery method, so polling needs the webhook off.
    api('deleteWebhook')
    api('setMyCommands', commands=COMMANDS)
    print('Bot is running. Press Ctrl+C to stop.')
    offset = 0
    while True:
        for update in api('getUpdates', offset=offset, timeout=30):
            offset = update['update_id'] + 1
            try:
                handle_update(update)
            except TelegramError as e:
                print(e)


def set_webhook(site_url):
    url = site_url.rstrip('/') + '/api/telegram/webhook'
    api('setWebhook', url=url, secret_token=TELEGRAM_WEBHOOK_SECRET,
        allowed_updates=['message', 'callback_query'])
    api('setMyCommands', commands=COMMANDS)
    print(f'Webhook set to {url}')


def info():
    me = api('getMe')
    hook = api('getWebhookInfo')
    print(f"Bot: @{me['username']}")
    print(f"Webhook: {hook.get('url') or '(none)'}")
    if hook.get('last_error_message'):
        print(f"Last error: {hook['last_error_message']}")


def main():
    args = sys.argv[1:]
    try:
        if args == ['poll']:
            poll()
        elif len(args) == 2 and args[0] == 'set-webhook':
            set_webhook(args[1])
        elif args == ['delete-webhook']:
            api('deleteWebhook')
            print('Webhook deleted.')
        elif args == ['info']:
            info()
        else:
            sys.exit(__doc__)
    except TelegramError as e:
        sys.exit(str(e))
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
