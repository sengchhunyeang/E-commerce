from flask import Blueprint, jsonify

from core.auth import admin_required
from core.db import Table, query
from core.responses import deleted_or_404, found_or_404
from core.validation import ValidationError, json_body, text

bp = Blueprint('categories', __name__, url_prefix='/api/categories')
categories = Table('categories', columns="""*,
    (select count(*) from products p where p.category_id = categories.id) as product_count""")


def validate_category(data, category_id=None):
    name = text(data, 'name', required=True)
    if query('select 1 from categories where lower(name) = lower(%s) and id is distinct from %s',
             (name, category_id)):
        raise ValidationError(f'Category "{name}" already exists')
    return {'name': name}


@bp.get('')
def list_categories():
    return jsonify(sorted(categories.all(), key=lambda c: c['name'].lower()))


@bp.post('')
@admin_required
def create_category():
    return jsonify(categories.create(validate_category(json_body()))), 201


@bp.put('/<int:category_id>')
@admin_required
def update_category(category_id):
    return found_or_404(categories.update(category_id, validate_category(json_body(), category_id)),
                        'Category')


@bp.delete('/<int:category_id>')
@admin_required
def delete_category(category_id):
    # Its products stay, without a category (on delete set null).
    return deleted_or_404(categories.delete(category_id), 'Category')
