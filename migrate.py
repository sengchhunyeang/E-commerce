"""Apply pending SQL migrations from migrations/ to the Neon Postgres database.

Usage:  python migrate.py

Each .sql file runs once, in name order, inside its own transaction.
Applied files are recorded in the schema_migrations table.
Connects with DATABASE_URL from .env.
"""
import sys
from pathlib import Path

import psycopg

from config import DATABASE_URL

MIGRATIONS_DIR = Path(__file__).parent / 'migrations'

SETUP_SQL = """
    create table if not exists schema_migrations (
        name       text primary key,
        applied_at timestamptz not null default now()
    )
"""


def main():
    with psycopg.connect(DATABASE_URL, autocommit=True, prepare_threshold=None) as conn:
        conn.execute(SETUP_SQL)
        applied = {row[0] for row in conn.execute('select name from schema_migrations')}
        pending = sorted(f for f in MIGRATIONS_DIR.glob('*.sql') if f.name not in applied)

        if not pending:
            print('Database is up to date.')
            return

        for file in pending:
            print(f'Applying {file.name} ... ', end='', flush=True)
            try:
                with conn.transaction():
                    conn.execute(file.read_text(encoding='utf-8'))
                    conn.execute('insert into schema_migrations (name) values (%s)', (file.name,))
            except psycopg.Error as e:
                print('failed')
                sys.exit(f'{file.name}: {e}')
            print('done')
        print(f'Applied {len(pending)} migration(s).')


if __name__ == '__main__':
    main()
