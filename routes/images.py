"""Image uploads for products.

    POST /api/images       multipart "file" -> {"url": "/api/images/7"}
    GET  /api/images/7     the image itself
"""
from flask import Blueprint, Response, request

from core.db import query
from core.responses import error
from core.validation import ValidationError

bp = Blueprint('images', __name__, url_prefix='/api/images')

TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/gif'}
MAX_BYTES = 4 * 1024 * 1024  # Vercel rejects request bodies over 4.5 MB


@bp.post('')
def upload_image():
    file = request.files.get('file')
    if not file or not file.filename:
        raise ValidationError('Choose an image to upload')
    if file.mimetype not in TYPES:
        raise ValidationError('Image must be JPG, PNG, WebP or GIF')
    data = file.read()
    if len(data) > MAX_BYTES:
        raise ValidationError('Image must be 4 MB or smaller')
    row = query('insert into images (content_type, data) values (%s, %s) returning id',
                (file.mimetype, data))[0]
    return {'url': f"/api/images/{row['id']}"}, 201


@bp.get('/<int:image_id>')
def read_image(image_id):
    rows = query('select content_type, data from images where id = %s', (image_id,))
    if not rows:
        return error('Image not found', 404)
    # An image never changes after upload, so browsers can cache it for good.
    return Response(bytes(rows[0]['data']), mimetype=rows[0]['content_type'],
                    headers={'Cache-Control': 'public, max-age=31536000, immutable'})
