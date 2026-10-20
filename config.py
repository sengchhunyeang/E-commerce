"""Settings loaded from the .env file."""
import os

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get('DATABASE_URL', '')

if not DATABASE_URL:
    raise RuntimeError('Set DATABASE_URL (your Neon connection string) in the .env file')
