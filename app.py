import os
from datetime import timedelta

from flask import Flask

from config import SECRET_KEY
from core.responses import register_error_handlers
from routes import (admin, auth, categories, class_reminder, images, orders, pages, products,
                    telegram, wishlist)


def create_app():
    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = images.MAX_BYTES + 64 * 1024  # room for form fields
    app.config.update(
        SECRET_KEY=SECRET_KEY,
        PERMANENT_SESSION_LIFETIME=timedelta(days=30),
        SESSION_COOKIE_SAMESITE='Lax',  # other sites can't send requests with the login cookie
        SESSION_COOKIE_SECURE=bool(os.environ.get('VERCEL')),  # https only on Vercel
    )
    app.register_blueprint(auth.bp)
    app.register_blueprint(products.bp)
    app.register_blueprint(categories.bp)
    app.register_blueprint(images.bp)
    app.register_blueprint(orders.bp)
    app.register_blueprint(wishlist.bp)
    app.register_blueprint(admin.bp)
    app.register_blueprint(telegram.bp)
    app.register_blueprint(class_reminder.bp)
    app.register_blueprint(pages.bp)
    register_error_handlers(app)
    return app


# Vercel looks for a module-level WSGI app named `app`.
app = create_app()

if __name__ == '__main__':
    app.run(debug=True)
