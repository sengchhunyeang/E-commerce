from flask import Blueprint, jsonify

from core.auth import admin_required, current_user, login_required
from core.responses import found_or_404, deleted_or_404, error
from core.db import Table, query
from core.validation import ValidationError, json_body, text, number

bp = Blueprint('products', __name__, url_prefix='/api/products')

# Each product comes with its category name and average review rating
products = Table('products', columns="""*,
    (select c.name from categories c where c.id = products.category_id) as category,
    coalesce((select round(avg(r.rating), 1) from reviews r where r.product_id = products.id), 0) as rating,
    (select count(*) from reviews r where r.product_id = products.id) as review_count""")


def validate_product(data):
    category_id = data.get('category_id')
    return {
        'name': text(data, 'name', required=True),
        'price': round(number(data, 'price'), 2),
        'stock': number(data, 'stock', int),
        'image_url': text(data, 'image_url'),
        'description': text(data, 'description'),
        'category_id': number(data, 'category_id', int, 'Category') if category_id else None,
    }


@bp.get('')
def list_products():
    return jsonify(products.all())


@bp.get('/<int:product_id>')
def read_product(product_id):
    return found_or_404(products.get(product_id), 'Product')


@bp.post('')
@admin_required
def create_product():
    return jsonify(products.create(validate_product(json_body()))), 201


@bp.put('/<int:product_id>')
@admin_required
def update_product(product_id):
    return found_or_404(products.update(product_id, validate_product(json_body())), 'Product')


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
