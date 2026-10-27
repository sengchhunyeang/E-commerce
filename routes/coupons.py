"""Discount codes, managed on /admin/coupons. Customers apply them at checkout
(checked and counted by order_charges() / place_order() in SQL).

    GET    /api/coupons        every coupon (admin)
    POST   /api/coupons        {code, kind: percent|fixed, value, min_subtotal, max_uses?, expires_on?, active}
    PUT    /api/coupons/<id>   same fields
    DELETE /api/coupons/<id>
"""
from datetime import date

from flask import Blueprint, jsonify

from core.auth import admin_required
from core.db import Table, query
from core.responses import deleted_or_404, found_or_404
from core.validation import ValidationError, json_body, number, one_of, text

bp = Blueprint('coupons', __name__, url_prefix='/api/coupons')
coupons = Table('coupons', columns='*, expires_on::text as expires_on')


def validate_coupon(data, coupon_id=None):
    code = text(data, 'code', 'Code', required=True).upper()
    if ' ' in code:
        raise ValidationError('Code cannot contain spaces')
    if query('select 1 from coupons where lower(code) = lower(%s) and id is distinct from %s',
             (code, coupon_id)):
        raise ValidationError(f'Coupon "{code}" already exists')
    kind = one_of(data, 'kind', ['percent', 'fixed'])
    value = round(number(data, 'value', label='Value'), 2)
    if value <= 0 or (kind == 'percent' and value > 100):
        raise ValidationError('A percent discount must be between 0 and 100')
    expires_on = text(data, 'expires_on')
    if expires_on:
        try:
            date.fromisoformat(expires_on)
        except ValueError:
            raise ValidationError('Expiry must be a date')
    return {
        'code': code,
        'kind': kind,
        'value': value,
        'min_subtotal': round(number(data, 'min_subtotal', label='Minimum spend'), 2)
                        if data.get('min_subtotal') not in (None, '') else 0,
        'max_uses': number(data, 'max_uses', int, 'Usage limit', minimum=1)
                    if data.get('max_uses') not in (None, '') else None,
        'expires_on': expires_on or None,
        'active': bool(data.get('active')),
    }


@bp.get('')
@admin_required
def list_coupons():
    return jsonify(coupons.all())


@bp.post('')
@admin_required
def create_coupon():
    return jsonify(coupons.create(validate_coupon(json_body()))), 201


@bp.put('/<int:coupon_id>')
@admin_required
def update_coupon(coupon_id):
    return found_or_404(coupons.update(coupon_id, validate_coupon(json_body(), coupon_id)), 'Coupon')


@bp.delete('/<int:coupon_id>')
@admin_required
def delete_coupon(coupon_id):
    # Past orders keep their coupon_code text (coupon_id is set to null).
    return deleted_or_404(coupons.delete(coupon_id), 'Coupon')
