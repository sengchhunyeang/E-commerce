"""The signed-in customer's saved products.

    GET    /api/wishlist        products, newest first
    PUT    /api/wishlist/<id>   save a product
    DELETE /api/wishlist/<id>   remove it
"""
from flask import Blueprint, jsonify
from psycopg import sql

from core.auth import current_user, login_required
from core.db import query
from core.responses import error
from routes.products import products

bp = Blueprint('wishlist', __name__, url_prefix='/api/wishlist')


def saved_products():
    # Same fields as /api/products (rating, variants, ...)
    return query(sql.SQL("""select p.* from wishlist w
                            join lateral (select {} from products where products.id = w.product_id) p on true
                            where w.user_id = %s order by w.created_at desc""").format(products.columns),
                 (current_user()['id'],))


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
