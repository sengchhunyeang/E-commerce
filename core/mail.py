"""Send email through the Resend HTTP API (no extra dependencies).

    send_email('ann@example.com', 'Subject', '<p>Hello</p>')  -> True if sent, never raises
"""
import json
import logging
from urllib.error import URLError
from urllib.request import Request, urlopen

from config import MAIL_FROM, RESEND_API_KEY

log = logging.getLogger(__name__)


def configured():
    return bool(RESEND_API_KEY and MAIL_FROM)


def send_email(to, subject, html):
    if not configured():
        return False
    request = Request('https://api.resend.com/emails',
                      data=json.dumps({'from': MAIL_FROM, 'to': [to], 'subject': subject,
                                       'html': html}).encode(),
                      headers={'Content-Type': 'application/json',
                               'Authorization': f'Bearer {RESEND_API_KEY}'})
    try:
        with urlopen(request, timeout=10):
            return True
    except (URLError, OSError) as e:
        log.warning('Email to %s failed: %s', to, e)
        return False
