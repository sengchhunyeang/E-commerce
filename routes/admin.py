"""Admin dashboard numbers, sales reports and customer accounts.

    GET /api/admin/stats             sales totals, orders by status, low stock, best sellers
    GET /api/admin/reports?days=30   revenue per day, top products, categories, payment methods
    GET /api/admin/orders.csv        orders as a spreadsheet (same filters as GET /api/orders)
    GET /api/admin/users             every account with its order count and spend
    PUT /api/admin/users/<id>/role   {"role": "admin" | "customer"}
"""
import csv
import io

from flask import Blueprint, Response, jsonify, request
from psycopg import sql

from core.auth import admin_required, current_user
from core.db import query
from core.responses import found_or_404
from core.validation import ValidationError, json_body, one_of
from routes.orders import order_filters
from routes.settings import load_settings

bp = Blueprint('admin', __name__, url_prefix='/api/admin')

# Days are counted in Cambodia time.
LOCAL_DAY = "(o.created_at at time zone 'Asia/Phnom_Penh')::date"


@bp.get('/stats')
@admin_required
def stats():
    totals = query("""select
        coalesce(sum(total) filter (where status <> 'cancelled'), 0) as revenue,
        count(*) filter (where status <> 'cancelled') as orders,
        coalesce(sum(total) filter (where status <> 'cancelled'
                                    and created_at >= now() - interval '30 days'), 0) as revenue_30d,
        (select count(*) from users where role = 'customer') as customers,
        (select count(*) from products) as products,
        count(*) filter (where payment_status = 'submitted' and status <> 'cancelled') as payments_to_check
        from orders""")[0]
    by_status = {r['status']: r['count'] for r in
                 query('select status, count(*) from orders group by status')}
    low_stock = query('select id, name, stock from products where stock <= %s order by stock, name',
                      (load_settings()['low_stock_threshold'],))
    best_sellers = query("""select i.name, sum(i.qty) as qty, sum(i.qty * i.price) as sales
                            from order_items i join orders o on o.id = i.order_id
                            where o.status <> 'cancelled'
                            group by i.name order by qty desc limit 5""")
    return jsonify(totals=totals, by_status=by_status, low_stock=low_stock, best_sellers=best_sellers)


@bp.get('/reports')
@admin_required
def reports():
    try:
        days = min(max(int(request.args.get('days', 30)), 1), 365)
    except ValueError:
        days = 30
    # Orders in the last `days` Cambodia days, today included; cancelled ones don't count.
    recent = f"""o.status <> 'cancelled' and {LOCAL_DAY} >
                 (now() at time zone 'Asia/Phnom_Penh')::date - %(days)s"""
    params = {'days': days}
    summary = query(f"""select coalesce(sum(o.total), 0) as revenue, count(*) as orders,
                               coalesce(avg(o.total), 0) as average,
                               coalesce(sum(o.discount), 0) as discounts,
                               coalesce(sum(o.shipping_fee), 0) as shipping,
                               coalesce(sum(o.tax), 0) as tax
                        from orders o where {recent}""", params)[0]
    daily = query(f"""select d::date::text as day, coalesce(sum(o.total), 0) as revenue, count(o.id) as orders
                      from generate_series((now() at time zone 'Asia/Phnom_Penh')::date - (%(days)s - 1),
                                           (now() at time zone 'Asia/Phnom_Penh')::date, interval '1 day') d
                      left join orders o on {LOCAL_DAY} = d::date and {recent}
                      group by d order by d""", params)
    products = query(f"""select i.name, sum(i.qty) as qty, sum(i.qty * i.price) as sales
                         from order_items i join orders o on o.id = i.order_id where {recent}
                         group by i.name order by sales desc limit 10""", params)
    categories = query(f"""select coalesce(c.name, 'No category') as name, sum(i.qty * i.price) as sales
                           from order_items i join orders o on o.id = i.order_id
                           left join products p on p.id = i.product_id
                           left join categories c on c.id = p.category_id
                           where {recent} group by 1 order by sales desc""", params)
    payments = query(f"""select o.payment_method as method, count(*) as orders, sum(o.total) as revenue
                         from orders o where {recent} group by 1 order by 2 desc""", params)
    return jsonify(days=days, summary=summary, daily=daily, products=products,
                   categories=categories, payments=payments)


CSV_COLUMNS = ['id', 'created_at', 'status', 'customer', 'email', 'phone', 'address', 'items',
               'subtotal', 'discount', 'coupon_code', 'shipping_fee', 'tax', 'total',
               'payment_method', 'payment_status', 'note']


@bp.get('/orders.csv')
@admin_required
def export_orders():
    condition, params = order_filters(request.args)
    rows = query(sql.SQL("""select o.*, (select string_agg(i.qty || ' x ' || i.name, '; ' order by i.id)
                                         from order_items i where i.order_id = o.id) as items
                            from orders o where {} order by o.id desc""").format(sql.SQL(condition)),
                 params)
    out = io.StringIO()
    writer = csv.DictWriter(out, CSV_COLUMNS, extrasaction='ignore')
    writer.writeheader()
    writer.writerows(rows)
    # The BOM lets Excel open the file as UTF-8 (Khmer names, emoji).
    return Response('\ufeff' + out.getvalue(), mimetype='text/csv',
                    headers={'Content-Disposition': 'attachment; filename=orders.csv'})


@bp.get('/users')
@admin_required
def list_users():
    return jsonify(query("""select u.id, u.name, u.email, u.role, u.phone, u.created_at,
            u.telegram_chat_id is not null as telegram,
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
