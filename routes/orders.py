from flask import Blueprint, jsonify

from core.responses import found_or_404, deleted_or_404
from core.db import Table, rpc
from core.telegram import format_order, notify_admin
from core.validation import ValidationError, json_body, text, email, one_of

bp = Blueprint('orders', __name__, url_prefix='/api/orders')
STATUSES = ['pending', 'shipped', 'delivered', 'cancelled']

# Each order comes with its items embedded as "items"
orders = Table('orders', columns="""*, coalesce(
    (select json_agg(i order by i.id) from order_items i where i.order_id = orders.id),
    '[]') as items""")


def validate_items(data):
    items = data.get('items')
    if not isinstance(items, list) or not items:
        raise ValidationError('Your cart is empty')
    try:
        return [{'product_id': int(i['product_id']), 'qty': int(i['qty'])} for i in items]
    except (KeyError, TypeError, ValueError):
        raise ValidationError('Invalid cart items')


@bp.get('')
def list_orders():
    return jsonify(orders.all())


@bp.post('')
def create_order():
    data = json_body()
    # Stock checks, saving items and lowering stock happen in one transaction
    # inside the place_order function (see migrations/001_init.sql).
    order_id = rpc('place_order',
                   p_customer=text(data, 'customer', 'Name', required=True),
                   p_email=email(data),
                   p_items=validate_items(data))
    order = orders.get(order_id)
    notify_admin('🛒 New order\n\n' + format_order(order),
                 [[(s.title(), f"status:{order_id}:{s}") for s in STATUSES if s != 'pending']])
    return jsonify(order), 201


@bp.put('/<int:order_id>')
def update_order(order_id):
    status = one_of(json_body(), 'status', STATUSES)
    return found_or_404(orders.update(order_id, {'status': status}), 'Order')


@bp.delete('/<int:order_id>')
def delete_order(order_id):
    return deleted_or_404(orders.delete(order_id), 'Order')
