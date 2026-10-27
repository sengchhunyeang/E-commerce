"""Reusable Postgres (Neon) helpers.

    products = Table('products')
    products.all()            -> list of rows
    products.get(1)           -> row or None
    products.where('stock = %s', (0,)) -> matching rows
    products.create({...})    -> new row
    products.update(1, {...}) -> updated row or None
    products.delete(1)        -> True if a row was deleted
"""
import time
import weakref
from datetime import datetime
from decimal import Decimal

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool, PoolTimeout

from config import DATABASE_URL

_returned_at = weakref.WeakKeyDictionary()  # connection -> when it went back to the pool
FRESH_SECONDS = 30


def _check(conn):
    """Neon closes idle connections, so test one that sat unused for a while.
    A connection used in the last few seconds is handed out without the extra round trip."""
    if time.monotonic() - _returned_at.get(conn, 0) > FRESH_SECONDS:
        ConnectionPool.check_connection(conn)


def _returned(conn):
    _returned_at[conn] = time.monotonic()


# Every query() is a single statement, so autocommit saves the BEGIN/COMMIT round trips
# (statements, including function calls like place_order, are still atomic).
# prepare_threshold=None keeps it compatible with Neon's pooled (-pooler) endpoint.
pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=5, open=True,
                      check=_check, reset=_returned,
                      kwargs={'row_factory': dict_row, 'prepare_threshold': None, 'autocommit': True})


class DatabaseError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def _clean(row):
    """Make a row JSON friendly: numbers as floats, times as ISO strings."""
    for key, value in row.items():
        if isinstance(value, Decimal):
            row[key] = float(value)
        elif isinstance(value, datetime):
            row[key] = value.isoformat()
    return row


def query(statement, params=()):
    """Run one statement in its own transaction and return the rows as dicts."""
    try:
        with pool.connection() as conn:
            cur = conn.execute(statement, params)
            rows = cur.fetchall() if cur.description else []
    except (psycopg.errors.RaiseException, psycopg.IntegrityError, psycopg.DataError) as e:
        raise DatabaseError(e.diag.message_primary or 'Invalid data')
    except (psycopg.OperationalError, PoolTimeout):
        raise DatabaseError('Could not reach the database', 502)
    except psycopg.Error:
        raise DatabaseError('Database error', 502)
    return [_clean(row) for row in rows]


def rpc(function, **args):
    """Call a Postgres function, e.g. rpc('place_order', p_customer='Ann', ...)."""
    named = sql.SQL(', ').join(sql.SQL('{} => %s').format(sql.Identifier(name)) for name in args)
    values = [Jsonb(v) if isinstance(v, (dict, list)) else v for v in args.values()]
    rows = query(sql.SQL('select {}({}) as result').format(sql.Identifier(function), named), values)
    return rows[0]['result']


class Table:
    """Create/read/update/delete helpers for one table.

    columns is the select list (trusted SQL from code, not user input).
    """

    def __init__(self, name, columns='*'):
        self.table = sql.Identifier(name)
        self.columns = sql.SQL(columns)

    def all(self):
        return query(sql.SQL('select {} from {} order by id desc').format(self.columns, self.table))

    def where(self, condition, params=()):
        """Rows matching a trusted SQL condition, e.g. where('user_id = %s', (5,))."""
        return query(sql.SQL('select {} from {} where {} order by id desc').format(
            self.columns, self.table, sql.SQL(condition)), params)

    def get(self, record_id):
        rows = query(sql.SQL('select {} from {} where id = %s').format(self.columns, self.table),
                     (record_id,))
        return rows[0] if rows else None

    def create(self, fields):
        statement = sql.SQL('insert into {} ({}) values ({}) returning {}').format(
            self.table,
            sql.SQL(', ').join(map(sql.Identifier, fields)),
            sql.SQL(', ').join(sql.Placeholder() * len(fields)),
            self.columns)
        return query(statement, list(fields.values()))[0]

    def update(self, record_id, fields):
        statement = sql.SQL('update {} set {} where id = %s returning {}').format(
            self.table,
            sql.SQL(', ').join(sql.SQL('{} = %s').format(sql.Identifier(k)) for k in fields),
            self.columns)
        rows = query(statement, [*fields.values(), record_id])
        return rows[0] if rows else None

    def delete(self, record_id):
        rows = query(sql.SQL('delete from {} where id = %s returning id').format(self.table),
                     (record_id,))
        return bool(rows)
