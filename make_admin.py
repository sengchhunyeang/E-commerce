"""Give an account admin rights (the first admin has to be made here).

Usage:  python make_admin.py you@example.com

Sign up on the site first, then run this. Further admins can be made on the
/admin page (Customers tab). Connects with DATABASE_URL from .env.
"""
import sys

from core.db import query


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    rows = query("update users set role = 'admin' where lower(email) = lower(%s) returning name",
                 (sys.argv[1],))
    if not rows:
        sys.exit(f'No account with email {sys.argv[1]}. Sign up on the site first.')
    print(f"{rows[0]['name']} is now an admin.")


if __name__ == '__main__':
    main()
