"""Sign up, sign in, sign out and the account page.

    POST /api/auth/signup     {name, email, password}
    POST /api/auth/signin     {email, password}
    POST /api/auth/signout
    GET  /api/auth/me         the signed-in user, or null
    PUT  /api/auth/me         {name, phone, address}
    PUT  /api/auth/password   {current_password, new_password}
    POST /api/auth/forgot     {email} -> emails (and Telegrams) a reset link
    POST /api/auth/reset      {token, password}
    POST /api/auth/telegram   -> {"url": "https://t.me/<bot>?start=<token>"} to connect Telegram
    DELETE /api/auth/telegram disconnect Telegram
"""
import hashlib
import secrets
from html import escape

from flask import Blueprint, g, jsonify, request

from core.auth import (current_user, find_user, hash_password, login_required, password_matches,
                       sign_in, sign_out)
from core.db import query
from core.mail import configured as email_configured, send_email
from core.responses import error
from core.telegram import bot_username, notify
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


# ---------- Forgotten password ----------

RESET_HOURS = 1


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


@bp.post('/forgot')
def forgot_password():
    """Always answers the same way, so it can't be used to find out who has an account."""
    user = find_user(email(json_body()))
    # At most one link a minute per account.
    if user and not query(f"""select 1 from password_resets where user_id = %s
                              and expires_at > now() + interval '{RESET_HOURS} hour' - interval '1 minute'""",
                          (user['id'],)):
        token = secrets.token_urlsafe(32)
        query(f"insert into password_resets (token_hash, user_id, expires_at) "
              f"values (%s, %s, now() + interval '{RESET_HOURS} hour')", (token_hash(token), user['id']))
        link = f'{request.host_url}reset?token={token}'
        send_email(user['email'], 'Reset your password',
                   f"<p>Hi {escape(user['name'])},</p><p>Reset your password here (valid for "
                   f"{RESET_HOURS} hour):</p><p><a href=\"{link}\">{link}</a></p>"
                   "<p>If you didn't ask for this, ignore this email.</p>")
        chat = query('select telegram_chat_id from users where id = %s', (user['id'],))[0]['telegram_chat_id']
        notify(chat, f'🔑 Reset your password (valid for {RESET_HOURS} hour):\n{escape(link)}')
    return jsonify(email=email_configured())


@bp.post('/reset')
def reset_password():
    data = json_body()
    password = new_password(data, 'password')
    rows = query("""update password_resets set used_at = now()
                    where token_hash = %s and used_at is null and expires_at > now()
                    returning user_id""", (token_hash(str(data.get('token') or '')),))
    if not rows:
        raise ValidationError('This reset link is invalid or has expired. Ask for a new one.')
    user = query('update users set password_hash = %s where id = %s returning id, password_hash',
                 (hash_password(password), rows[0]['user_id']))[0]
    # Other unused links for this account stop working too.
    query('update password_resets set used_at = now() where user_id = %s and used_at is null',
          (user['id'],))
    sign_in(user)
    return jsonify(current_user())


# ---------- Telegram ----------

@bp.post('/telegram')
@login_required
def link_telegram():
    """The customer opens the link and presses Start; the bot then saves their chat ID."""
    username = bot_username()
    if not username:
        return error('The Telegram bot is not set up for this shop', 503)
    token = secrets.token_urlsafe(16)
    query('update users set telegram_link_token = %s where id = %s', (token, current_user()['id']))
    return jsonify(url=f'https://t.me/{username}?start={token}')


@bp.delete('/telegram')
@login_required
def unlink_telegram():
    query('update users set telegram_chat_id = null, telegram_link_token = null where id = %s',
          (current_user()['id'],))
    g.pop('user', None)
    return jsonify(current_user())
