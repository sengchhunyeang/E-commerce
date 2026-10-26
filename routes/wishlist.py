"""The signed-in customer's saved products.

    GET    /api/wishlist        products, newest first
    PUT    /api/wishlist/<id>   save a product
    DELETE /api/wishlist/<id>   remove it
"""
from flask import Blueprint, jsonify

from core.auth import current_user, login_required
from core.db import query
from core.responses import error

bp = Blueprint('wishlist', __name__, url_prefix='/api/wishlist')


def saved_products():
    return query("""select p.* from wishlist w join products p on p.id = w.product_id
                    where w.user_id = %s order by w.created_at desc""", (current_user()['id'],))


@bp.get('')
@login_required
def list_wishlist():
    return jsonify(saved_products())


@bp.put('/<int:product_id>')
@login_required
def add(product_id):
    if not query('select 1 from products where id = %s', (product_id,)):
        return error('Product not found', 404)
    query('insert into wishlist (user_id, product_id) values (%s, %s) on conflict do nothing',
          (current_user()['id'], product_id))
    return jsonify(saved_products())


@bp.delete('/<int:product_id>')
@login_required
def remove(product_id):
    query('delete from wishlist where user_id = %s and product_id = %s',
          (current_user()['id'], product_id))
    return jsonify(saved_products())
