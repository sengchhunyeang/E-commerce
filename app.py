from flask import Flask

from core.responses import register_error_handlers
from routes import class_reminder, images, orders, pages, products, telegram


def create_app():
    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = images.MAX_BYTES + 64 * 1024  # room for form fields
    app.register_blueprint(products.bp)
    app.register_blueprint(images.bp)
    app.register_blueprint(orders.bp)
    app.register_blueprint(telegram.bp)
    app.register_blueprint(class_reminder.bp)
    app.register_blueprint(pages.bp)
    register_error_handlers(app)
    return app


# Vercel looks for a module-level WSGI app named `app`.
app = create_app()

if __name__ == '__main__':
    app.run(debug=True)
