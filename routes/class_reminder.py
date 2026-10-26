"""Telegram class reminder, configured on the /admin page.

The settings live in the one-row class_reminder table. A scheduler calls
GET /api/class-reminder/run every few minutes (see .github/workflows/
class-reminder.yml); the message goes out once per class day, at alert_time.
"""
import hmac
from datetime import datetime, time, timedelta, timezone
from html import escape

from flask import Blueprint, jsonify, request

from config import CRON_SECRET
from core.auth import admin_required
from core.db import query
from core.responses import error
from core.telegram import TelegramError, send
from core.validation import ValidationError, json_body, text

bp = Blueprint('class_reminder', __name__, url_prefix='/api/class-reminder')

# Times are entered in Cambodia time (UTC+7, no daylight saving).
LOCAL_TZ = timezone(timedelta(hours=7))
# If the scheduler runs late, still send up to this long after alert_time.
GRACE = timedelta(hours=1)

SELECT = """select enabled, chat_id, meet_link,
                   to_char(alert_time, 'HH24:MI') as alert_time,
                   to_char(start_time, 'HH24:MI') as start_time,
                   to_char(end_time, 'HH24:MI') as end_time,
                   days, message, last_sent_on::text as last_sent_on
            from class_reminder where id = 1"""

UPDATE = """update class_reminder set
                enabled = %(enabled)s, chat_id = %(chat_id)s, meet_link = %(meet_link)s,
                alert_time = %(alert_time)s::time, start_time = %(start_time)s::time,
                end_time = %(end_time)s::time, days = %(days)s::smallint[], message = %(message)s
            where id = 1"""


def load():
    rows = query(SELECT)
    if not rows:
        raise ValidationError('Run python migrate.py to create the class_reminder table')
    return rows[0]


def clock(data, key, label):
    value = text(data, key, label, required=True)
    try:
        return datetime.strptime(value, '%H:%M').strftime('%H:%M')
    except ValueError:
        raise ValidationError(f'{label} must look like 18:30')


def validate(data):
    days = data.get('days')
    if not isinstance(days, list) or not days or not all(d in range(1, 8) for d in days):
        raise ValidationError('Pick at least one class day')
    settings = {
        'enabled': bool(data.get('enabled')),
        'chat_id': text(data, 'chat_id', 'Group chat ID', required=True),
        'meet_link': text(data, 'meet_link', 'Meeting link', required=True),
        'alert_time': clock(data, 'alert_time', 'Alert time'),
        'start_time': clock(data, 'start_time', 'Class start'),
        'end_time': clock(data, 'end_time', 'Class end'),
        'days': sorted(set(days)),
        'message': text(data, 'message', 'Message', required=True),
    }
    if not settings['meet_link'].startswith(('https://', 'http://')):
        raise ValidationError('Meeting link must start with https://')
    if settings['end_time'] <= settings['start_time']:
        raise ValidationError('Class end must be after class start')
    return settings


def pretty(hhmm):
    """'19:30' -> '7:30 PM'"""
    return datetime.strptime(hhmm, '%H:%M').strftime('%I:%M %p').lstrip('0')


def render(settings):
    """The message as Telegram will show it (HTML-escaped for parse_mode=HTML)."""
    message = settings['message']
    for key, value in {'{link}': settings['meet_link'], '{start}': pretty(settings['start_time']),
                       '{end}': pretty(settings['end_time'])}.items():
        message = message.replace(key, value)
    return escape(message, quote=False)


def is_due(settings, now):
    alert = datetime.combine(now.date(), time.fromisoformat(settings['alert_time']), LOCAL_TZ)
    return (settings['enabled'] and now.isoweekday() in settings['days']
            and settings['last_sent_on'] != now.date().isoformat()
            and alert <= now < alert + GRACE)


@bp.get('')
@admin_required
def read_settings():
    return jsonify(load())


@bp.put('')
@admin_required
def update_settings():
    load()
    query(UPDATE, validate(json_body()))
    return jsonify(load())


@bp.post('/test')
@admin_required
def send_test():
    """Send the message in the form right now (without saving it)."""
    settings = validate(json_body())
    try:
        send(settings['chat_id'], render(settings))
    except TelegramError as e:
        return error(str(e), 502)
    return jsonify(sent=True)


@bp.get('/run')
def run():
    token = request.headers.get('Authorization', '')
    if not CRON_SECRET or not hmac.compare_digest(token, f'Bearer {CRON_SECRET}'):
        return error('Unauthorized', 401)
    settings = load()
    now = datetime.now(LOCAL_TZ)
    if not is_due(settings, now):
        return jsonify(sent=False, now=now.strftime('%a %H:%M'))
    # Claim today first, so two overlapping scheduler calls can't both send.
    today = now.date().isoformat()
    claimed = query('update class_reminder set last_sent_on = %s where id = 1 '
                    'and last_sent_on is distinct from %s::date returning id', (today, today))
    if not claimed:
        return jsonify(sent=False)
    try:
        send(settings['chat_id'], render(settings))
    except TelegramError as e:
        query('update class_reminder set last_sent_on = %s where id = 1', (settings['last_sent_on'],))
        return error(str(e), 502)
    return jsonify(sent=True)
