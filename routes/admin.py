"""Admin dashboard numbers and customer accounts.

    GET /api/admin/stats             sales totals, orders by status, low stock, best sellers
    GET /api/admin/users             every account with its order count and spend
    PUT /api/admin/users/<id>/role   {"role": "admin" | "customer"}
"""
from flask import Blueprint, jsonify

from core.auth import admin_required, current_user
from core.db import query
from core.responses import found_or_404
from core.validation import ValidationError, json_body, one_of

bp = Blueprint('admin', __name__, url_prefix='/api/admin')

LOW_STOCK = 5


@bp.get('/stats')
@admin_required
def stats():
    totals = query("""select
        coalesce(sum(total) filter (where status <> 'cancelled'), 0) as revenue,
        count(*) filter (where status <> 'cancelled') as orders,
        coalesce(sum(total) filter (where status <> 'cancelled'
                                    and created_at >= now() - interval '30 days'), 0) as revenue_30d,
        (select count(*) from users where role = 'customer') as customers,
        (select count(*) from products) as products
        from orders""")[0]
    by_status = {r['status']: r['count'] for r in
                 query('select status, count(*) from orders group by status')}
    low_stock = query('select id, name, stock from products where stock <= %s order by stock, name',
                      (LOW_STOCK,))
    best_sellers = query("""select i.name, sum(i.qty) as qty, sum(i.qty * i.price) as sales
                            from order_items i join orders o on o.id = i.order_id
                            where o.status <> 'cancelled'
                            group by i.name order by qty desc limit 5""")
    return jsonify(totals=totals, by_status=by_status, low_stock=low_stock, best_sellers=best_sellers)


@bp.get('/users')
@admin_required
def list_users():
    return jsonify(query("""select u.id, u.name, u.email, u.role, u.phone, u.created_at,
            count(o.id) as orders,
            coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0) as spent
        from users u left join orders o on o.user_id = u.id
        group by u.id order by u.id desc"""))


@bp.put('/users/<int:user_id>/role')
@admin_required
def set_role(user_id):
    role = one_of(json_body(), 'role', ['customer', 'admin'])
    if user_id == current_user()['id'] and role != 'admin':
        raise ValidationError("You can't remove your own admin role")
    rows = query('update users set role = %s where id = %s returning id, name, email, role',
                 (role, user_id))
    return found_or_404(rows[0] if rows else None, 'User')
