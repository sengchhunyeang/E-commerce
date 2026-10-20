from flask import Blueprint, jsonify

from core.responses import found_or_404, deleted_or_404
from core.db import Table
from core.validation import json_body, text, number

bp = Blueprint('products', __name__, url_prefix='/api/products')
products = Table('products')


def validate_product(data):
    return {
        'name': text(data, 'name', required=True),
        'price': round(number(data, 'price'), 2),
        'stock': number(data, 'stock', int),
        'image_url': text(data, 'image_url'),
        'description': text(data, 'description'),
    }


@bp.get('')
def list_products():
    return jsonify(products.all())


@bp.get('/<int:product_id>')
def read_product(product_id):
    return found_or_404(products.get(product_id), 'Product')


@bp.post('')
def create_product():
    return jsonify(products.create(validate_product(json_body()))), 201


@bp.put('/<int:product_id>')
def update_product(product_id):
    return found_or_404(products.update(product_id, validate_product(json_body())), 'Product')


@bp.delete('/<int:product_id>')
def delete_product(product_id):
    return deleted_or_404(products.delete(product_id), 'Product')
