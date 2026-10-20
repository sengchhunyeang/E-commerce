from flask import Blueprint, render_template, abort

from routes.orders import STATUSES

bp = Blueprint('pages', __name__)


# Single page app: every non-API path returns the same page,
# and static/app.js renders the view.
@bp.route('/')
@bp.route('/<path:path>')
def index(path=''):
    if path.startswith('api/'):
        abort(404)
    return render_template('index.html', statuses=STATUSES)
