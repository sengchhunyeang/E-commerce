"""Products, their options (variants) and reviews.

    GET    /api/products                   every product, with category, rating and variants
    GET    /api/products/<id>
    GET    /api/products/<id>/related      up to 4 similar products
    POST   /api/products                   admin; body may include "variants": [{id?, name, price?, stock}]
    PUT    /api/products/<id>              admin
    DELETE /api/products/<id>              admin
"""
from flask import Blueprint, jsonify
from psycopg import sql
from psycopg.types.json import Jsonb

from core.auth import admin_required, current_user, login_required
from core.responses import found_or_404, deleted_or_404, error
from core.db import Table, query, rpc
from core.validation import ValidationError, json_body, text, number

bp = Blueprint('products', __name__, url_prefix='/api/products')

# Each product comes with its category name, average review rating and options
products = Table('products', columns="""*,
    (select c.name from categories c where c.id = products.category_id) as category,
    coalesce((select round(avg(r.rating), 1) from reviews r where r.product_id = products.id), 0) as rating,
    (select count(*) from reviews r where r.product_id = products.id) as review_count,
    coalesce((select json_agg(v order by v.position, v.id) from product_variants v
              where v.product_id = products.id), '[]') as variants""")


def validate_product(data):
    category_id = data.get('category_id')
    compare_at = data.get('compare_at_price')
    images = data.get('images') or []
    if not isinstance(images, list) or not all(isinstance(i, str) for i in images):
        raise ValidationError('Invalid gallery images')
    product = {
        'name': text(data, 'name', required=True),
        'price': round(number(data, 'price'), 2),
        'stock': number(data, 'stock', int),
        'image_url': text(data, 'image_url'),
        'description': text(data, 'description'),
        'category_id': number(data, 'category_id', int, 'Category') if category_id else None,
        'compare_at_price': round(number(data, 'compare_at_price', label='Was price'), 2)
                            if compare_at not in (None, '') else None,
        'featured': bool(data.get('featured')),
        'images': Jsonb([i.strip() for i in images if i.strip()][:12]),
    }
    if product['compare_at_price'] is not None and product['compare_at_price'] <= product['price']:
        raise ValidationError('"Was" price must be higher than the price (or leave it empty)')
    return product


def validate_variants(data):
    """None when the request doesn't touch variants, else the cleaned list."""
    variants = data.get('variants')
    if variants is None:
        return None
    if not isinstance(variants, list):
        raise ValidationError('Invalid options')
    cleaned = []
    for v in variants:
        name = text(v, 'name', 'Option name', required=True)
        cleaned.append({
            'id': v.get('id') or None,
            'name': name,
            'price': round(number(v, 'price', label=f'Price of "{name}"'), 2)
                     if v.get('price') not in (None, '') else None,
            'stock': number(v, 'stock', int, f'Stock of "{name}"'),
        })
    if len({v['name'].lower() for v in cleaned}) < len(cleaned):
        raise ValidationError('Option names must be different')
    return cleaned


def save(product_id, data):
    variants = validate_variants(data)
    if variants is not None:
        # Also sets the product's stock to the total of its options.
        rpc('save_variants', p_product_id=product_id, p_variants=variants)
    return products.get(product_id)


@bp.get('')
def list_products():
    return jsonify(products.all())


@bp.get('/<int:product_id>')
def read_product(product_id):
    return found_or_404(products.get(product_id), 'Product')


@bp.get('/<int:product_id>/related')
def related_products(product_id):
    """Same category first, then best rated; in-stock products before sold-out ones."""
    return jsonify(query(sql.SQL("""
        select * from (select {} from products where id <> %(id)s) p
        order by (p.category_id is not distinct from
                  (select category_id from products where id = %(id)s)) desc,
                 (p.stock > 0) desc, p.rating desc, p.id desc
        limit 4""").format(products.columns), {'id': product_id}))


@bp.post('')
@admin_required
def create_product():
    data = json_body()
    return jsonify(save(products.create(validate_product(data))['id'], data)), 201


@bp.put('/<int:product_id>')
@admin_required
def update_product(product_id):
    data = json_body()
    if not products.update(product_id, validate_product(data)):
        return error('Product not found', 404)
    return jsonify(save(product_id, data))


@bp.delete('/<int:product_id>')
@admin_required
def delete_product(product_id):
    return deleted_or_404(products.delete(product_id), 'Product')


# ---------- Reviews ----------

REVIEWS = """select r.id, r.rating, r.comment, r.created_at, r.user_id, u.name
             from reviews r join users u on u.id = r.user_id
             where r.product_id = %s order by r.created_at desc"""


@bp.get('/<int:product_id>/reviews')
def list_reviews(product_id):
    return jsonify(query(REVIEWS, (product_id,)))


@bp.put('/<int:product_id>/reviews')
@login_required
def save_review(product_id):
    """Add or replace the signed-in customer's review of this product."""
    data = json_body()
    rating = number(data, 'rating', int)
    if not 1 <= rating <= 5:
        raise ValidationError('Pick a rating from 1 to 5 stars')
    if not products.get(product_id):
        return error('Product not found', 404)
    query("""insert into reviews (product_id, user_id, rating, comment) values (%s, %s, %s, %s)
             on conflict (product_id, user_id)
             do update set rating = excluded.rating, comment = excluded.comment, created_at = now()""",
          (product_id, current_user()['id'], rating, text(data, 'comment')))
    return jsonify(query(REVIEWS, (product_id,)))


@bp.delete('/<int:product_id>/reviews/<int:review_id>')
@login_required
def delete_review(product_id, review_id):
    """Customers can delete their own review; admins can delete any."""
    user = current_user()
    rows = query('delete from reviews where id = %s and product_id = %s and (user_id = %s or %s) '
                 'returning id', (review_id, product_id, user['id'], user['role'] == 'admin'))
    return deleted_or_404(rows, 'Review')
