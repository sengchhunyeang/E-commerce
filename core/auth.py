"""Customer accounts: password hashing, the signed-in user, and route guards.

    @login_required   -> 401 unless someone is signed in
    @admin_required   -> 401 / 403 unless an admin is signed in
    current_user()    -> {"id", "name", "email", "role", "phone", "address", "telegram"} or None

The session cookie holds the user id plus a fingerprint of the password hash,
so changing the password signs out every other device.
"""
import hashlib
from functools import wraps

from flask import g, session
from werkzeug.security import check_password_hash, generate_password_hash

from core.db import query
from core.responses import error

USER = ('select id, name, email, role, phone, address, telegram_chat_id is not null as telegram, '
        'password_hash from users where {} = %s')


def hash_password(password):
    return generate_password_hash(password)


def password_matches(user, password):
    return check_password_hash(user['password_hash'], password)


def _fingerprint(password_hash):
    return hashlib.sha256(password_hash.encode()).hexdigest()[:16]


def find_user(email):
    rows = query(USER.format('lower(email)'), (email.lower(),))
    return rows[0] if rows else None


def sign_in(user):
    session.clear()
    session.permanent = True
    session['user_id'] = user['id']
    session['key'] = _fingerprint(user['password_hash'])
    g.pop('user', None)  # current_user() reloads it


def sign_out():
    session.clear()
    g.user = None


def public(user):
    """The user without the password hash, safe to send to the browser."""
    return {k: v for k, v in user.items() if k != 'password_hash'} if user else None


def current_user():
    if 'user' not in g:
        user = None
        if session.get('user_id'):
            rows = query(USER.format('id'), (session['user_id'],))
            if rows and session.get('key') == _fingerprint(rows[0]['password_hash']):
                user = rows[0]
        g.user = public(user)
    return g.user


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not current_user():
            return error('Please sign in first', 401)
        return view(*args, **kwargs)
    return wrapper


def admin_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return error('Please sign in first', 401)
        if user['role'] != 'admin':
            return error('Admins only', 403)
        return view(*args, **kwargs)
    return wrapper
