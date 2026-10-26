"""Sign up, sign in, sign out and the account page.

    POST /api/auth/signup     {name, email, password}
    POST /api/auth/signin     {email, password}
    POST /api/auth/signout
    GET  /api/auth/me         the signed-in user, or null
    PUT  /api/auth/me         {name, phone, address}
    PUT  /api/auth/password   {current_password, new_password}
"""
from flask import Blueprint, g, jsonify

from core.auth import (current_user, find_user, hash_password, login_required, password_matches,
                       sign_in, sign_out)
from core.db import query
from core.responses import error
from core.validation import ValidationError, email, json_body, text

bp = Blueprint('auth', __name__, url_prefix='/api/auth')

# Checked against when the email is unknown, so a wrong email takes as long as a wrong password.
DUMMY_USER = {'password_hash': hash_password('not-a-real-password')}


def new_password(data, key, label='Password'):
    value = str(data.get(key) or '')
    if len(value) < 8:
        raise ValidationError(f'{label} must be at least 8 characters')
    if len(value) > 200:
        raise ValidationError(f'{label} is too long')
    return value


@bp.post('/signup')
def signup():
    data = json_body()
    name = text(data, 'name', required=True)
    address = email(data).lower()
    password = new_password(data, 'password')
    if find_user(address):
        raise ValidationError('An account with this email already exists. Sign in instead.')
    rows = query('insert into users (name, email, password_hash) values (%s, %s, %s) '
                 'returning id, password_hash', (name, address, hash_password(password)))
    sign_in(rows[0])
    return jsonify(current_user()), 201


@bp.post('/signin')
def signin():
    data = json_body()
    user = find_user(email(data))
    if not password_matches(user or DUMMY_USER, str(data.get('password') or '')) or not user:
        return error('Wrong email or password', 401)
    sign_in(user)
    return jsonify(current_user())


@bp.post('/signout')
def signout():
    sign_out()
    return '', 204


@bp.get('/me')
def me():
    return jsonify(current_user())


@bp.put('/me')
@login_required
def update_me():
    data = json_body()
    query('update users set name = %s, phone = %s, address = %s where id = %s',
          (text(data, 'name', required=True), text(data, 'phone'), text(data, 'address'),
           current_user()['id']))
    g.pop('user', None)  # reload the changed user
    return jsonify(current_user())


@bp.put('/password')
@login_required
def change_password():
    data = json_body()
    user = find_user(current_user()['email'])
    if not password_matches(user, str(data.get('current_password') or '')):
        raise ValidationError('Current password is wrong')
    rows = query('update users set password_hash = %s where id = %s returning id, password_hash',
                 (hash_password(new_password(data, 'new_password', 'New password')), user['id']))
    sign_in(rows[0])  # keep this device signed in; other devices are signed out
    return jsonify(current_user())
