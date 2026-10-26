from flask import Blueprint, jsonify

from core.auth import admin_required, current_user, login_required
from core.responses import error, found_or_404, deleted_or_404
from core.db import Table, query, rpc
from core.telegram import format_order, notify_admin
from core.validation import ValidationError, json_body, text, one_of

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


def set_status(order_id, status):
    """Change the status (cancelling restocks the items). Returns the order or None."""
    return orders.get(order_id) if rpc('set_order_status', p_order_id=order_id, p_status=status) else None


def own_order(order_id):
    """The order if the signed-in user may see it (their own, or any for admins)."""
    order = orders.get(order_id)
    user = current_user()
    if order and (user['role'] == 'admin' or order['user_id'] == user['id']):
        return order
    return None


@bp.get('')
@admin_required
def list_orders():
    return jsonify(orders.all())


@bp.get('/mine')
@login_required
def my_orders():
    return jsonify(orders.where('user_id = %s', (current_user()['id'],)))


@bp.get('/<int:order_id>')
@login_required
def read_order(order_id):
    return found_or_404(own_order(order_id), 'Order')


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
    # Stock checks, saving items and lowering stock happen in one transaction
    # inside the place_order function (see migrations/004_accounts_and_shop.sql).
    order_id = rpc('place_order',
                   p_user_id=user['id'],
                   p_customer=shipping['customer'],
                   p_email=user['email'],
                   p_phone=shipping['phone'],
                   p_address=shipping['address'],
                   p_note=text(data, 'note'),
                   p_items=validate_items(data))
    # Remember the delivery details to fill in the next checkout.
    query('update users set phone = %s, address = %s where id = %s',
          (shipping['phone'], shipping['address'], user['id']))
    order = orders.get(order_id)
    notify_admin('🛒 New order\n\n' + format_order(order),
                 [[(s.title(), f"status:{order_id}:{s}") for s in STATUSES if s != 'pending']])
    return jsonify(order), 201


@bp.post('/<int:order_id>/cancel')
@login_required
def cancel_order(order_id):
    """Customers can cancel their own order until it ships."""
    order = own_order(order_id)
    if not order:
        return error('Order not found', 404)
    if order['status'] != 'pending':
        raise ValidationError(f"This order is already {order['status']} and can't be cancelled")
    order = set_status(order_id, 'cancelled')
    notify_admin(f'❌ Order #{order_id} was cancelled by the customer\n\n' + format_order(order))
    return jsonify(order)


@bp.put('/<int:order_id>')
@admin_required
def update_order(order_id):
    status = one_of(json_body(), 'status', STATUSES)
    return found_or_404(set_status(order_id, status), 'Order')


@bp.delete('/<int:order_id>')
@admin_required
def delete_order(order_id):
    return deleted_or_404(orders.delete(order_id), 'Order')
