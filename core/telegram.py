"""Small Telegram Bot API client (no extra dependencies).

    send('123456', 'Hello')          -> send a message to a chat
    notify_admin('New order #5')     -> message TELEGRAM_ADMIN_CHAT_ID, never raises
"""
import json
import logging
from html import escape
from urllib.error import URLError
from urllib.request import Request, urlopen

from config import TELEGRAM_ADMIN_CHAT_ID, TELEGRAM_BOT_TOKEN

log = logging.getLogger(__name__)


class TelegramError(Exception):
    pass


def api(method, **params):
    """Call a Bot API method, e.g. api('sendMessage', chat_id=1, text='Hi')."""
    if not TELEGRAM_BOT_TOKEN:
        raise TelegramError('TELEGRAM_BOT_TOKEN is not set')
    request = Request(f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/{method}',
                      data=json.dumps(params).encode(),
                      headers={'Content-Type': 'application/json'})
    try:
        with urlopen(request, timeout=params.get('timeout', 0) + 10) as response:
            body = json.load(response)
    except (URLError, OSError, ValueError) as e:
        raise TelegramError(f'{method} failed: {e}')
    if not body.get('ok'):
        raise TelegramError(f"{method} failed: {body.get('description')}")
    return body['result']


def keyboard(buttons):
    """buttons is a list of rows of (label, callback_data)."""
    return {'inline_keyboard': [[{'text': label, 'callback_data': data} for label, data in row]
                                for row in buttons]}


def send(chat_id, text, buttons=None):
    """Send an HTML-formatted message, optionally with inline buttons."""
    params = {'chat_id': chat_id, 'text': text, 'parse_mode': 'HTML'}
    if buttons:
        params['reply_markup'] = keyboard(buttons)
    return api('sendMessage', **params)


def is_admin(chat_id):
    return bool(TELEGRAM_ADMIN_CHAT_ID) and str(chat_id) == TELEGRAM_ADMIN_CHAT_ID


def notify_admin(text, buttons=None):
    """Best effort: a Telegram outage must never break checkout."""
    if not (TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID):
        return
    try:
        send(TELEGRAM_ADMIN_CHAT_ID, text, buttons)
    except TelegramError as e:
        log.warning('Telegram notification failed: %s', e)


def format_order(order):
    lines = [f"<b>Order #{order['id']}</b> — {order['status']}",
             f"{escape(order['customer'])} &lt;{escape(order['email'])}&gt;"]
    if order.get('phone'):
        lines.append(f"📞 {escape(order['phone'])}")
    if order.get('address'):
        lines.append(f"📍 {escape(order['address'])}")
    if order.get('note'):
        lines.append(f"📝 {escape(order['note'])}")
    lines.append('')
    lines += [f"{item['qty']} × {escape(item['name'])} @ ${item['price']:.2f}"
              for item in order.get('items', [])]
    lines += ['', f"<b>Total: ${order['total']:.2f}</b>"]
    return '\n'.join(lines)
