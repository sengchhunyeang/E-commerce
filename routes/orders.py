"""Checkout, order history, status changes and payments.

    POST /api/orders/quote              {items, coupon_code} -> subtotal, discount, shipping, tax, total
    POST /api/orders                    checkout (signed in)
    GET  /api/orders                    admin: ?status=&q=&from=&to=&page= -> {orders, total, page, pages}
    GET  /api/orders/mine               the customer's orders
    GET  /api/orders/<id>               one order with its items and timeline
    POST /api/orders/<id>/cancel        customer cancels a pending order
    POST /api/orders/<id>/payment       customer uploads a bank transfer screenshot (multipart "file")
    GET  /api/orders/<id>/payment-proof that screenshot (owner or admin)
    PUT  /api/orders/<id>/payment       admin: {"payment_status": "paid" | "unpaid"}
    PUT  /api/orders/<id>               admin: {"status": ...}
    DELETE /api/orders/<id>             admin
"""
import uuid
from datetime import date

from flask import Blueprint, Response, jsonify, request
from psycopg import sql

from core.auth import admin_required, current_user, login_required
from core.responses import error, found_or_404, deleted_or_404
from core.db import Table, query, rpc
from core.storage import StorageError, download, upload
from core.telegram import format_order, notify, notify_admin
from core.validation import ValidationError, json_body, text, one_of
from routes.images import MAX_BYTES, TYPES
from routes.settings import load_settings

bp = Blueprint('orders', __name__, url_prefix='/api/orders')
STATUSES = ['pending', 'shipped', 'delivered', 'cancelled']
PER_PAGE = 20

# Each order comes with its items and timeline embedded as "items" and "events"
orders = Table('orders', columns="""*, coalesce(
    (select json_agg(i order by i.id) from order_items i where i.order_id = orders.id),
    '[]') as items, coalesce(
    (select json_agg(e order by e.created_at, e.id) from order_events e where e.order_id = orders.id),
    '[]') as events""")

CUSTOMER_MESSAGES = {
    'shipped': '🚚 Your order #{id} is on its way!',
    'delivered': '✅ Your order #{id} was delivered. Thank you for shopping with us!',
    'cancelled': '❌ Your order #{id} was cancelled.',
}


def validate_items(data):
    items = data.get('items')
    if not isinstance(items, list) or not items:
        raise ValidationError('Your cart is empty')
    try:
        return [{'product_id': int(i['product_id']), 'qty': int(i['qty']),
                 'variant_id': int(i['variant_id']) if i.get('variant_id') else None} for i in items]
    except (KeyError, TypeError, ValueError):
        raise ValidationError('Invalid cart items')


def notify_customer(order, message):
    """Telegram message to the order's customer, if they connected Telegram."""
    rows = query('select telegram_chat_id from users where id = %s', (order['user_id'],))
    if rows and rows[0]['telegram_chat_id']:
        notify(rows[0]['telegram_chat_id'], message)


def set_status(order_id, status, tell_customer=True):
    """Change the status (cancelling restocks the items). Returns the order or None."""
    before = orders.get(order_id)
    if not before or not rpc('set_order_status', p_order_id=order_id, p_status=status):
        return None
    order = orders.get(order_id)
    if tell_customer and before['status'] != status and status in CUSTOMER_MESSAGES:
        notify_customer(order, CUSTOMER_MESSAGES[status].format(id=order_id))
    return order


def set_payment(order_id, payment_status):
    """Admin marks an order paid / unpaid. Returns the order or None."""
    rows = query('update orders set payment_status = %s where id = %s and payment_status <> %s '
                 'returning id', (payment_status, order_id, payment_status))
    if rows:
        event = 'payment confirmed' if payment_status == 'paid' else 'payment marked unpaid'
        query('insert into order_events (order_id, event) values (%s, %s)', (order_id, event))
    order = orders.get(order_id)
    if rows and order and payment_status == 'paid':
        notify_customer(order, f'💳 We received your payment for order #{order_id}. Thank you!')
    return order


def own_order(order_id):
    """The order if the signed-in user may see it (their own, or any for admins)."""
    order = orders.get(order_id)
    user = current_user()
    if order and (user['role'] == 'admin' or order['user_id'] == user['id']):
        return order
    return None


def alert_low_stock(order_id):
    """Tell the admin about products this order pushed down to the low-stock threshold."""
    threshold = load_settings()['low_stock_threshold']
    rows = query("""select p.name, p.stock from order_items i join products p on p.id = i.product_id
                    where i.order_id = %s group by p.id
                    having p.stock <= %s and p.stock + sum(i.qty) > %s""",
                 (order_id, threshold, threshold))
    if rows:
        notify_admin('⚠️ Low stock\n\n' + '\n'.join(
            f"{r['name']}: {r['stock'] or 'sold out'}{' left' if r['stock'] else ''}" for r in rows))


def order_filters(args):
    """SQL condition and params for the admin order search."""
    conditions, params = [], {}
    if args.get('status') in STATUSES:
        conditions.append('status = %(status)s')
        params['status'] = args['status']
    if args.get('payment') in ('unpaid', 'submitted', 'paid'):
        conditions.append('payment_status = %(payment)s')
        params['payment'] = args['payment']
    q = (args.get('q') or '').strip().lstrip('#')
    if q:
        conditions.append("""(id::text = %(q)s or customer ilike %(like)s or email ilike %(like)s
                              or phone ilike %(like)s or coupon_code ilike %(like)s)""")
        params.update(q=q, like=f'%{q}%')
    for key, op in (('from', '>='), ('to', '<')):
        value = args.get(key)
        if value:
            try:
                date.fromisoformat(value)
            except ValueError:
                raise ValidationError(f'"{key}" must be a date')
            # Dates are Cambodia days; "to" includes the whole day.
            shift = " + interval '1 day'" if key == 'to' else ''
            conditions.append(f"created_at {op} (%({key})s::date::timestamp{shift}) "
                              "at time zone 'Asia/Phnom_Penh'")
            params[key] = value
    return ' and '.join(conditions) or 'true', params


# ---------- Checkout ----------

@bp.post('/quote')
def quote():
    data = json_body()
    return jsonify(rpc('quote_order', p_items=validate_items(data), p_coupon=text(data, 'coupon_code')))


@bp.post('')
@login_required
def create_order():
    data = json_body()
    user = current_user()
    shipping = {
        'customer': text(data, 'customer', 'Name', required=True),
        'phone': text(data, 'phone', 'Phone', required=True),
        'address': text(data, 'address', 'Delivery address', required=True),
    }
    # Stock checks, coupon, charges, saving items and lowering stock happen in one
    # transaction inside the place_order function (see migrations/005_shop_features.sql).
    order_id = rpc('place_order',
                   p_user_id=user['id'],
                   p_customer=shipping['customer'],
                   p_email=user['email'],
                   p_phone=shipping['phone'],
                   p_address=shipping['address'],
                   p_note=text(data, 'note'),
                   p_items=validate_items(data),
                   p_coupon=text(data, 'coupon_code'),
                   p_payment_method=data.get('payment_method') or 'cod')
    # Remember the delivery details to fill in the next checkout.
    query('update users set phone = %s, address = %s where id = %s',
          (shipping['phone'], shipping['address'], user['id']))
    order = orders.get(order_id)
    buttons = [[(s.title(), f"status:{order_id}:{s}") for s in STATUSES if s != 'pending']]
    if order['payment_method'] == 'bank':
        buttons.append([('Confirm payment', f'paid:{order_id}')])
    notify_admin('🛒 New order\n\n' + format_order(order), buttons)
    notify_customer(order, f"🛒 We got your order #{order_id} (${order['total']:.2f}). "
                           "We'll message you when it ships.")
    alert_low_stock(order_id)
    return jsonify(order), 201


# ---------- Reading orders ----------

@bp.get('')
@admin_required
def list_orders():
    condition, params = order_filters(request.args)
    try:
        page = max(1, int(request.args.get('page', 1)))
    except ValueError:
        page = 1
    total = query(sql.SQL('select count(*) from orders where {}').format(sql.SQL(condition)),
                  params)[0]['count']
    rows = query(sql.SQL('select {} from orders where {} order by id desc limit %(limit)s offset %(offset)s')
                 .format(orders.columns, sql.SQL(condition)),
                 {**params, 'limit': PER_PAGE, 'offset': (page - 1) * PER_PAGE})
    return jsonify(orders=rows, total=total, page=page, pages=max(1, -(-total // PER_PAGE)))


@bp.get('/mine')
@login_required
def my_orders():
    return jsonify(orders.where('user_id = %s', (current_user()['id'],)))


@bp.get('/<int:order_id>')
@login_required
def read_order(order_id):
    return found_or_404(own_order(order_id), 'Order')


# ---------- Customer actions ----------

@bp.post('/<int:order_id>/cancel')
@login_required
def cancel_order(order_id):
    """Customers can cancel their own order until it ships."""
    order = own_order(order_id)
    if not order:
        return error('Order not found', 404)
    if order['status'] != 'pending':
        raise ValidationError(f"This order is already {order['status']} and can't be cancelled")
    order = set_status(order_id, 'cancelled', tell_customer=False)
    notify_admin(f'❌ Order #{order_id} was cancelled by the customer\n\n' + format_order(order))
    return jsonify(order)


@bp.post('/<int:order_id>/payment')
@login_required
def upload_payment(order_id):
    """The customer sends a screenshot of their bank transfer."""
    order = own_order(order_id)
    if not order:
        return error('Order not found', 404)
    if order['payment_method'] != 'bank':
        raise ValidationError('This order is paid on delivery')
    if order['status'] == 'cancelled':
        raise ValidationError('This order was cancelled')
    if order['payment_status'] == 'paid':
        raise ValidationError('This order is already paid')
    file = request.files.get('file')
    if not file or not file.filename:
        raise ValidationError('Choose a screenshot of your payment')
    if file.mimetype not in TYPES:
        raise ValidationError('Screenshot must be JPG, PNG, WebP or GIF')
    data = file.read()
    if len(data) > MAX_BYTES:
        raise ValidationError('Screenshot must be 4 MB or smaller')
    key = f'payments/{uuid.uuid4().hex}.{TYPES[file.mimetype]}'
    try:
        upload(key, data, file.mimetype)
    except StorageError as e:
        return error(str(e), 502)
    query("update orders set payment_status = 'submitted', payment_proof = %s where id = %s",
          (key, order_id))
    query("insert into order_events (order_id, event) values (%s, 'payment submitted')", (order_id,))
    order = orders.get(order_id)
    notify_admin(f'💳 Payment screenshot for order #{order_id}\n\n' + format_order(order),
                 [[('Confirm payment', f'paid:{order_id}')]])
    return jsonify(order)


@bp.get('/<int:order_id>/payment-proof')
@login_required
def read_payment_proof(order_id):
    order = own_order(order_id)
    if not order or not order['payment_proof']:
        return error('Screenshot not found', 404)
    try:
        found = download(order['payment_proof'])
    except StorageError as e:
        return error(str(e), 502)
    if not found:
        return error('Screenshot not found', 404)
    data, content_type = found
    return Response(data, mimetype=content_type, headers={'Cache-Control': 'private, max-age=3600'})


# ---------- Admin ----------

@bp.put('/<int:order_id>/payment')
@admin_required
def update_payment(order_id):
    status = one_of(json_body(), 'payment_status', ['paid', 'unpaid'])
    return found_or_404(set_payment(order_id, status), 'Order')


@bp.put('/<int:order_id>')
@admin_required
def update_order(order_id):
    status = one_of(json_body(), 'status', STATUSES)
    return found_or_404(set_status(order_id, status), 'Order')


@bp.delete('/<int:order_id>')
@admin_required
def delete_order(order_id):
    return deleted_or_404(orders.delete(order_id), 'Order')
