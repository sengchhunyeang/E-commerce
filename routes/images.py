"""Image uploads for products, stored in Neon Object Storage.

    POST /api/images                   multipart "file" -> {"url": "/api/images/products/<uuid>.png"}
    GET  /api/images/products/<file>   the image (read from the private bucket)
    GET  /api/images/7                 older uploads kept in the Postgres images table
"""
import uuid

from flask import Blueprint, Response, request

from core.auth import admin_required
from core.db import query
from core.responses import error
from core.storage import StorageError, download, upload
from core.validation import ValidationError

bp = Blueprint('images', __name__, url_prefix='/api/images')

TYPES = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif'}
MAX_BYTES = 4 * 1024 * 1024  # Vercel rejects request bodies over 4.5 MB
# An image never changes after upload, so browsers can cache it for good.
CACHE = {'Cache-Control': 'public, max-age=31536000, immutable'}


@bp.post('')
@admin_required
def upload_image():
    file = request.files.get('file')
    if not file or not file.filename:
        raise ValidationError('Choose an image to upload')
    if file.mimetype not in TYPES:
        raise ValidationError('Image must be JPG, PNG, WebP or GIF')
    data = file.read()
    if len(data) > MAX_BYTES:
        raise ValidationError('Image must be 4 MB or smaller')
    key = f'products/{uuid.uuid4().hex}.{TYPES[file.mimetype]}'
    try:
        upload(key, data, file.mimetype)
    except StorageError as e:
        return error(str(e), 502)
    return {'url': f'/api/images/{key}'}, 201


@bp.get('/products/<name>')
def read_image(name):
    try:
        found = download(f'products/{name}')
    except StorageError as e:
        return error(str(e), 502)
    if not found:
        return error('Image not found', 404)
    data, content_type = found
    return Response(data, mimetype=content_type, headers=CACHE)


@bp.get('/<int:image_id>')
def read_db_image(image_id):
    rows = query('select content_type, data from images where id = %s', (image_id,))
    if not rows:
        return error('Image not found', 404)
    return Response(bytes(rows[0]['data']), mimetype=rows[0]['content_type'], headers=CACHE)
