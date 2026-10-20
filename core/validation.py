"""Reusable input validation. Helpers raise ValidationError, which
core.responses turns into a 400 response with the message."""
from flask import request


class ValidationError(Exception):
    pass


def json_body():
    return request.get_json(silent=True) or {}


def text(data, key, label=None, required=False):
    value = str(data.get(key) or '').strip()
    if required and not value:
        raise ValidationError(f'{label or key.capitalize()} is required')
    return value


def number(data, key, cast=float, label=None, minimum=0):
    label = label or key.capitalize()
    try:
        value = cast(data.get(key))
    except (TypeError, ValueError):
        raise ValidationError(f'{label} must be a number')
    if minimum is not None and value < minimum:
        raise ValidationError(f'{label} must be at least {minimum}')
    return value


def email(data, key='email'):
    value = text(data, key, 'Email', required=True)
    if '@' not in value:
        raise ValidationError('Enter a valid email')
    return value


def one_of(data, key, choices):
    value = data.get(key)
    if value not in choices:
        raise ValidationError(f'{key.capitalize()} must be one of: {", ".join(choices)}')
    return value
