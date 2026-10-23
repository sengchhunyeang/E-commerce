"""Neon Object Storage (S3-compatible) for uploaded files.

    upload('products/abc.png', data, 'image/png')
    download('products/abc.png') -> (data, content_type) or None if missing

boto3 reads AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and
AWS_REGION from the environment; the bucket name comes from S3_BUCKET.
The bucket is private, so files are served through the app (routes/images.py).
"""
import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from config import S3_BUCKET


class StorageError(Exception):
    pass


_client = None


def client():
    # Created on first use so the app still starts when storage isn't configured.
    global _client
    if _client is None:
        if not S3_BUCKET:
            raise StorageError('Object storage is not configured (set S3_BUCKET)')
        _client = boto3.client('s3', config=Config(s3={'addressing_style': 'path'}))
    return _client


def upload(key, data, content_type):
    try:
        client().put_object(Bucket=S3_BUCKET, Key=key, Body=data, ContentType=content_type)
    except (BotoCoreError, ClientError) as e:
        raise StorageError(f'Upload to storage failed: {e}')


def download(key):
    try:
        obj = client().get_object(Bucket=S3_BUCKET, Key=key)
        return obj['Body'].read(), obj['ContentType']
    except ClientError as e:
        if e.response['Error']['Code'] in ('NoSuchKey', '404'):
            return None
        raise StorageError(f'Storage read failed: {e}')
    except BotoCoreError as e:
        raise StorageError(f'Storage read failed: {e}')
