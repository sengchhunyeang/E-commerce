# E-commerce

Flask + Neon Postgres shop.

## Run locally

```
pip install -r requirements.txt
cp .env.example .env   # then put your Neon DATABASE_URL in it
python migrate.py
python app.py
```

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel, **Add New → Project** and import the repo.
3. Under **Environment Variables**, add `DATABASE_URL` (the Neon pooled connection string).
4. Deploy. Run `python migrate.py` locally against the same database to create the tables.
