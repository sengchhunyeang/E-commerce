"""Telegram bot: Telegram POSTs every message to /api/telegram/webhook.

Anyone can browse products. Customers connect their account from the
account page (a t.me/<bot>?start=<token> link) to get order updates.
The admin chat (TELEGRAM_ADMIN_CHAT_ID) can also list orders, change their
status and confirm bank payments with buttons.
"""
import hmac
import logging
from html import escape

from flask import Blueprint, request

from config import TELEGRAM_WEBHOOK_SECRET
from core.db import DatabaseError, query
from core.telegram import api, format_order, is_admin, keyboard, send
from routes.orders import STATUSES, orders, set_payment, set_status
from routes.products import products

bp = Blueprint('telegram', __name__, url_prefix='/api/telegram')
log = logging.getLogger(__name__)

HELP = """<b>WebShop bot</b>
/products — what's for sale
/myid — your chat ID

<b>Admin</b>
/orders — latest orders
/order &lt;id&gt; — order details and status buttons"""


def status_buttons(order):
    buttons = [[(s.title(), f"status:{order['id']}:{s}") for s in STATUSES if s != order['status']]]
    if order.get('payment_status') != 'paid' and order['status'] != 'cancelled':
        buttons.append([('Confirm payment', f"paid:{order['id']}")])
    return buttons


def cmd_start(chat_id, arg):
    """/start <token> from the "Connect Telegram" link on the account page."""
    if arg:
        rows = query('update users set telegram_chat_id = %s, telegram_link_token = null '
                     'where telegram_link_token = %s returning name', (chat_id, arg))
        if rows:
            return send(chat_id, f"✅ Connected, {escape(rows[0]['name'])}! "
                                 "You'll get a message here when your orders change.")
        send(chat_id, 'That link has expired. Open your account page and press "Connect Telegram" again.')
    send(chat_id, HELP)


def cmd_products(chat_id, arg):
    rows = [f"• <b>{escape(p['name'])}</b> — ${p['price']:.2f} "
            f"({p['stock']} in stock)" if p['stock'] else
            f"• <s>{escape(p['name'])}</s> — sold out" for p in products.all()]
    send(chat_id, '\n'.join(rows) or 'No products yet.')


def cmd_orders(chat_id, arg):
    rows = [f"#{o['id']} {escape(o['customer'])} — ${o['total']:.2f} — {o['status']}"
            for o in orders.all()[:10]]
    send(chat_id, '\n'.join(rows) + '\n\nSend /order &lt;id&gt; for details.' if rows else 'No orders yet.')


def cmd_order(chat_id, arg):
    order = orders.get(int(arg)) if arg.isdigit() else None
    if order:
        send(chat_id, format_order(order), status_buttons(order))
    else:
        send(chat_id, 'Usage: /order &lt;id&gt; (order not found)')


PUBLIC = {'/start': cmd_start, '/help': lambda c, a: send(c, HELP),
          '/products': cmd_products, '/myid': lambda c, a: send(c, f'Your chat ID: <code>{c}</code>')}
ADMIN = {'/orders': cmd_orders, '/order': cmd_order}


def on_message(message):
    chat_id = message['chat']['id']
    command, _, arg = message.get('text', '').strip().partition(' ')
    command = command.split('@')[0].lower()  # "/orders@cldec_bot" in groups
    if command in PUBLIC:
        PUBLIC[command](chat_id, arg.strip())
    elif command in ADMIN and is_admin(chat_id):
        ADMIN[command](chat_id, arg.strip())
    else:
        send(chat_id, HELP)


def on_button(query):
    """Admin pressed a status button under an order."""
    chat_id = query['message']['chat']['id']
    action, order_id, status = (query.get('data', '').split(':') + ['', ''])[:3]
    if not is_admin(chat_id) or not order_id.isdigit() or not (
            (action == 'status' and status in STATUSES) or action == 'paid'):
        return api('answerCallbackQuery', callback_query_id=query['id'], text='Not allowed')
    if action == 'paid':
        order, done = set_payment(int(order_id), 'paid'), 'payment confirmed'
    else:
        order, done = set_status(int(order_id), status), status
    api('answerCallbackQuery', callback_query_id=query['id'],
        text=f'Order #{order_id} → {done}' if order else 'Order not found')
    if order:
        api('editMessageText', chat_id=chat_id, message_id=query['message']['message_id'],
            text=format_order(order), parse_mode='HTML', reply_markup=keyboard(status_buttons(order)))


def handle_update(update):
    """Process one Telegram update (shared by the webhook and telegram_bot.py poll)."""
    try:
        if 'callback_query' in update:
            on_button(update['callback_query'])
        elif 'message' in update:
            on_message(update['message'])
    except DatabaseError as e:
        chat = (update.get('message') or update['callback_query']['message'])['chat']['id']
        send(chat, f'Error: {escape(e.message)}')


@bp.post('/webhook')
def webhook():
    token = request.headers.get('X-Telegram-Bot-Api-Secret-Token', '')
    if TELEGRAM_WEBHOOK_SECRET and not hmac.compare_digest(token, TELEGRAM_WEBHOOK_SECRET):
        return '', 403
    try:
        handle_update(request.get_json(silent=True) or {})
    except Exception:
        # Always answer 200, or Telegram keeps retrying the same update.
        log.exception('Telegram update failed')
    return '', 200
