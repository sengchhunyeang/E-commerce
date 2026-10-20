"""Shared JSON responses and error handling."""
from flask import jsonify

from core.db import DatabaseError
from core.validation import ValidationError


def error(message, code=400):
    return jsonify(error=message), code


def found_or_404(record, label):
    """Return the record as JSON, or a 404 like 'Product not found'."""
    return jsonify(record) if record else error(f'{label} not found', 404)


def deleted_or_404(deleted, label):
    return ('', 204) if deleted else error(f'{label} not found', 404)


def register_error_handlers(app):
    """Turn raised errors into {"error": "..."} responses for every route."""

    @app.errorhandler(ValidationError)
    def handle_validation_error(e):
        return error(str(e))

    @app.errorhandler(DatabaseError)
    def handle_database_error(e):
        return error(e.message, e.status)
