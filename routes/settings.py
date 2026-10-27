"""Shop-wide settings, edited on /admin/settings.

    GET /api/settings    shop details, shipping, tax and bank payment info (public)
    PUT /api/settings    save them (admin)
"""
from flask import Blueprint, jsonify

from core.auth import admin_required
from core.db import query
from core.validation import ValidationError, json_body, number, text

bp = Blueprint('settings', __name__, url_prefix='/api/settings')

COLUMNS = ['shop_name', 'shop_address', 'shop_phone', 'shipping_fee', 'free_shipping_over',
           'tax_rate', 'low_stock_threshold', 'bank_enabled', 'bank_name', 'bank_account_name',
           'bank_account_number', 'bank_qr_url']


def load_settings():
    rows = query(f"select {', '.join(COLUMNS)} from shop_settings where id = 1")
    if not rows:
        raise ValidationError('Run python migrate.py to create the shop_settings table')
    return rows[0]


def validate(data):
    settings = {
        'shop_name': text(data, 'shop_name', 'Shop name', required=True),
        'shop_address': text(data, 'shop_address'),
        'shop_phone': text(data, 'shop_phone'),
        'shipping_fee': round(number(data, 'shipping_fee', label='Shipping fee'), 2),
        'free_shipping_over': round(number(data, 'free_shipping_over', label='Free shipping over'), 2),
        'tax_rate': round(number(data, 'tax_rate', label='Tax rate'), 2),
        'low_stock_threshold': number(data, 'low_stock_threshold', int, 'Low stock alert'),
        'bank_enabled': bool(data.get('bank_enabled')),
        'bank_name': text(data, 'bank_name'),
        'bank_account_name': text(data, 'bank_account_name'),
        'bank_account_number': text(data, 'bank_account_number'),
        'bank_qr_url': text(data, 'bank_qr_url'),
    }
    if settings['tax_rate'] > 100:
        raise ValidationError('Tax rate must be 100% or less')
    if settings['bank_enabled'] and not (settings['bank_account_number'] or settings['bank_qr_url']):
        raise ValidationError('Add an account number or a QR code to turn on bank transfer')
    return settings


@bp.get('')
def read_settings():
    return jsonify(load_settings())


@bp.put('')
@admin_required
def update_settings():
    settings = validate(json_body())
    query(f"update shop_settings set {', '.join(f'{c} = %({c})s' for c in COLUMNS)} where id = 1",
          settings)
    return jsonify(load_settings())
