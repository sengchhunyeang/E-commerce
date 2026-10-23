// WebShop single page app: a tiny router plus one render function per view.

const app = document.getElementById('app');
const $ = sel => app.querySelector(sel);

// ---------- Helpers ----------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Number(n).toFixed(2);

async function api(url, options = {}) {
    const res = await fetch(url, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json();
    if (!res.ok) throw new Error(data?.error || 'Request failed');
    return data;
}

let toastTimer;
function toast(message, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2500);
}

function thumb(p, cls = 'thumb') {
    return p.image_url
        ? `<img class="${cls}" src="${esc(p.image_url)}" alt="${esc(p.name)}">`
        : `<div class="${cls} placeholder">${esc(p.name.charAt(0).toUpperCase())}</div>`;
}

// ---------- Cart (kept in the browser) ----------

const cart = {
    load() {
        try { return JSON.parse(localStorage.getItem('cart')) || {}; } catch { return {}; }
    },
    save(items) {
        try { localStorage.setItem('cart', JSON.stringify(items)); } catch { }
        updateCartCount();
    },
    add(id, qty = 1) {
        const items = this.load();
        items[id] = (items[id] || 0) + qty;
        this.save(items);
    },
    set(id, qty) {
        const items = this.load();
        if (qty > 0) items[id] = qty; else delete items[id];
        this.save(items);
    },
    clear() { this.save({}); },
};

function updateCartCount() {
    const count = Object.values(cart.load()).reduce((a, b) => a + b, 0);
    document.getElementById('cart-count').textContent = count;
}

// ---------- Views ----------

async function viewShop() {
    const products = await api('/api/products');
    app.innerHTML = `
        <div class="toolbar">
            <h1>Shop</h1>
            <input id="search" type="search" placeholder="Search products…">
        </div>
        <div id="grid" class="grid"></div>`;

    const draw = q => {
        const list = products.filter(p => p.name.toLowerCase().includes(q));
        $('#grid').innerHTML = list.length ? list.map(productCard).join('') : '<p class="muted">No products found.</p>';
    };
    draw('');
    $('#search').addEventListener('input', e => draw(e.target.value.trim().toLowerCase()));
}

function productCard(p) {
    return `
        <div class="card">
            <a href="/product/${p.id}" data-link>${thumb(p)}</a>
            <div class="card-body">
                <a href="/product/${p.id}" data-link class="card-title">${esc(p.name)}</a>
                <div class="price">${money(p.price)}</div>
                <button class="btn" data-add="${p.id}" ${p.stock ? '' : 'disabled'}>
                    ${p.stock ? 'Add to cart' : 'Out of stock'}
                </button>
            </div>
        </div>`;
}

async function viewProduct(id) {
    const p = await api(`/api/products/${id}`);
    document.title = `${p.name} · WebShop`;
    app.innerHTML = `
        <a href="/" data-link class="back">← Back to shop</a>
        <div class="panel detail">
            ${thumb(p, 'thumb large')}
            <div>
                <h1>${esc(p.name)}</h1>
                <div class="price big">${money(p.price)}</div>
                <p>${esc(p.description) || '<span class="muted">No description.</span>'}</p>
                <p class="muted">${p.stock ? `${p.stock} in stock` : 'Out of stock'}</p>
                ${p.stock ? `
                <div class="row">
                    <input id="qty" type="number" min="1" max="${p.stock}" value="1">
                    <button id="add" class="btn">Add to cart</button>
                </div>` : ''}
            </div>
        </div>`;

    $('#add')?.addEventListener('click', () => {
        const qty = Math.max(1, Math.min(p.stock, parseInt($('#qty').value) || 1));
        cart.add(p.id, qty);
        toast(`Added ${qty} × ${p.name} to cart`);
    });
}

async function viewCart() {
    const products = await api('/api/products');
    const byId = Object.fromEntries(products.map(p => [p.id, p]));
    const items = cart.load();

    // Drop products that were deleted since they were added
    for (const id of Object.keys(items)) if (!byId[id]) cart.set(id, 0);

    const lines = Object.entries(cart.load()).map(([id, qty]) => ({ p: byId[id], qty }));
    if (!lines.length) {
        app.innerHTML = `<h1>Your cart</h1><div class="panel"><p class="muted">Your cart is empty.</p>
            <a href="/" data-link class="btn">Continue shopping</a></div>`;
        return;
    }
    const total = lines.reduce((sum, l) => sum + l.p.price * l.qty, 0);

    app.innerHTML = `
        <h1>Your cart</h1>
        <div class="panel">
            <table>
                <thead><tr><th>Product</th><th>Price</th><th>Qty</th><th>Subtotal</th><th></th></tr></thead>
                <tbody>
                ${lines.map(({ p, qty }) => `
                    <tr>
                        <td><a href="/product/${p.id}" data-link>${esc(p.name)}</a>
                            ${qty > p.stock ? `<div class="warn">Only ${p.stock} in stock</div>` : ''}</td>
                        <td>${money(p.price)}</td>
                        <td><input type="number" min="0" max="${p.stock}" value="${qty}" data-qty="${p.id}" class="qty"></td>
                        <td>${money(p.price * qty)}</td>
                        <td><button class="btn danger small" data-remove="${p.id}">Remove</button></td>
                    </tr>`).join('')}
                </tbody>
            </table>
            <div class="total">Total: ${money(total)}</div>
        </div>

        <h2>Checkout</h2>
        <form id="checkout" class="panel form">
            <label>Full name <input name="customer" required></label>
            <label>Email <input name="email" type="email" required></label>
            <button class="btn">Place order (${money(total)})</button>
        </form>`;

    app.querySelectorAll('[data-qty]').forEach(input =>
        input.addEventListener('change', () => {
            cart.set(input.dataset.qty, parseInt(input.value) || 0);
            viewCart();
        }));
    app.querySelectorAll('[data-remove]').forEach(btn =>
        btn.addEventListener('click', () => {
            cart.set(btn.dataset.remove, 0);
            viewCart();
        }));

    $('#checkout').addEventListener('submit', async e => {
        e.preventDefault();
        const form = new FormData(e.target);
        try {
            const order = await api('/api/orders', {
                method: 'POST',
                body: {
                    customer: form.get('customer'),
                    email: form.get('email'),
                    items: Object.entries(cart.load()).map(([product_id, qty]) => ({ product_id, qty })),
                },
            });
            cart.clear();
            toast(`Order #${order.id} placed. Thank you!`);
            navigate('/orders');
        } catch (err) {
            toast(err.message, true);
        }
    });
}

async function viewOrders() {
    const orders = await api('/api/orders');
    app.innerHTML = `
        <h1>Orders</h1>
        ${orders.length ? '' : '<div class="panel"><p class="muted">No orders yet.</p></div>'}
        ${orders.map(o => `
            <div class="panel order">
                <div class="order-head">
                    <div>
                        <strong>Order #${o.id}</strong> · ${esc(new Date(o.created_at).toLocaleString())}<br>
                        <span class="muted">${esc(o.customer)} &lt;${esc(o.email)}&gt;</span>
                    </div>
                    <div class="row">
                        <select data-status="${o.id}" class="status ${o.status}">
                            ${window.ORDER_STATUSES.map(s =>
                                `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
                        </select>
                        <button class="btn danger small" data-delete="${o.id}">Delete</button>
                    </div>
                </div>
                <ul class="items">
                    ${o.items.map(i => `<li>${i.qty} × ${esc(i.name)} <span>${money(i.price * i.qty)}</span></li>`).join('')}
                </ul>
                <div class="total">Total: ${money(o.total)}</div>
            </div>`).join('')}`;

    app.querySelectorAll('[data-status]').forEach(select =>
        select.addEventListener('change', async () => {
            try {
                await api(`/api/orders/${select.dataset.status}`, { method: 'PUT', body: { status: select.value } });
                select.className = `status ${select.value}`;
                toast('Order status updated');
            } catch (err) { toast(err.message, true); }
        }));
    app.querySelectorAll('[data-delete]').forEach(btn =>
        btn.addEventListener('click', async () => {
            if (!confirm(`Delete order #${btn.dataset.delete}?`)) return;
            try {
                await api(`/api/orders/${btn.dataset.delete}`, { method: 'DELETE' });
                toast('Order deleted');
                viewOrders();
            } catch (err) { toast(err.message, true); }
        }));
}

async function viewAdmin() {
    const products = await api('/api/products');
    app.innerHTML = `
        <h1>Admin</h1>
        <div id="reminder"></div>

        <h1>Manage products</h1>
        <form id="product-form" class="panel form">
            <h2 id="form-title">Add product</h2>
            <input type="hidden" name="id">
            <div class="form-grid">
                <label>Name <input name="name" required></label>
                <label>Price <input name="price" type="number" step="0.01" min="0" required></label>
                <label>Stock <input name="stock" type="number" step="1" min="0" required></label>
                <label>Image URL <input name="image_url" type="url" placeholder="optional"></label>
            </div>
            <label>Description <textarea name="description" rows="3"></textarea></label>
            <div class="row">
                <button class="btn">Save</button>
                <button type="button" id="cancel-edit" class="btn secondary" hidden>Cancel</button>
            </div>
        </form>

        <div class="panel">
            <table>
                <thead><tr><th></th><th>Name</th><th>Price</th><th>Stock</th><th></th></tr></thead>
                <tbody>
                ${products.map(p => `
                    <tr>
                        <td>${thumb(p, 'thumb tiny')}</td>
                        <td>${esc(p.name)}</td>
                        <td>${money(p.price)}</td>
                        <td>${p.stock}</td>
                        <td class="actions">
                            <button class="btn small secondary" data-edit="${p.id}">Edit</button>
                            <button class="btn small danger" data-delete="${p.id}">Delete</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;

    drawReminder();

    const form = $('#product-form');
    const resetForm = () => {
        form.reset();
        form.id.value = '';
        $('#form-title').textContent = 'Add product';
        $('#cancel-edit').hidden = true;
    };

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        const id = data.id;
        delete data.id;
        try {
            await api(id ? `/api/products/${id}` : '/api/products', { method: id ? 'PUT' : 'POST', body: data });
            toast(id ? 'Product updated' : 'Product added');
            viewAdmin();
        } catch (err) { toast(err.message, true); }
    });
    $('#cancel-edit').addEventListener('click', resetForm);

    app.querySelectorAll('[data-edit]').forEach(btn =>
        btn.addEventListener('click', () => {
            const p = products.find(x => x.id == btn.dataset.edit);
            for (const key of ['id', 'name', 'price', 'stock', 'image_url', 'description']) form[key].value = p[key];
            $('#form-title').textContent = `Edit product #${p.id}`;
            $('#cancel-edit').hidden = false;
            form.scrollIntoView({ behavior: 'smooth' });
        }));
    app.querySelectorAll('[data-delete]').forEach(btn =>
        btn.addEventListener('click', async () => {
            if (!confirm('Delete this product?')) return;
            try {
                await api(`/api/products/${btn.dataset.delete}`, { method: 'DELETE' });
                cart.set(btn.dataset.delete, 0);
                toast('Product deleted');
                viewAdmin();
            } catch (err) { toast(err.message, true); }
        }));
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Telegram class reminder settings (top of the admin page)
async function drawReminder() {
    const box = $('#reminder');
    let s;
    try {
        s = await api('/api/class-reminder');
    } catch (err) {
        box.innerHTML = `<div class="panel"><p class="warn">${esc(err.message)}</p></div>`;
        return;
    }

    box.innerHTML = `
        <form id="reminder-form" class="panel form">
            <h2>Telegram class reminder</h2>
            <label><span><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> Send automatically</span></label>
            <label>Meeting link <input name="meet_link" type="url" required value="${esc(s.meet_link)}"></label>
            <div class="form-grid">
                <label>Alert time (bot posts at) <input name="alert_time" type="time" required value="${s.alert_time}"></label>
                <label>Class starts <input name="start_time" type="time" required value="${s.start_time}"></label>
                <label>Class ends <input name="end_time" type="time" required value="${s.end_time}"></label>
                <label>Group chat ID <input name="chat_id" required value="${esc(s.chat_id)}"></label>
            </div>
            <div class="days">Class days
                <div class="row">${DAYS.map((d, i) => `
                    <label><input type="checkbox" name="days" value="${i + 1}" ${s.days.includes(i + 1) ? 'checked' : ''}> ${d}</label>`).join('')}
                </div>
            </div>
            <label>Message <textarea name="message" rows="5" required>${esc(s.message)}</textarea></label>
            <p class="muted">{link}, {start} and {end} are replaced with the meeting link and class times.
                Times are Cambodia time (UTC+7). Last sent: ${s.last_sent_on || 'never'}.</p>
            <div class="row">
                <button class="btn">Save</button>
                <button type="button" id="send-now" class="btn secondary">Send to group now</button>
            </div>
        </form>`;

    const form = box.querySelector('#reminder-form');
    const read = () => ({
        ...Object.fromEntries(new FormData(form)),
        enabled: form.enabled.checked,
        days: [...form.querySelectorAll('[name=days]:checked')].map(c => Number(c.value)),
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        try {
            await api('/api/class-reminder', { method: 'PUT', body: read() });
            toast('Reminder settings saved');
            drawReminder();
        } catch (err) { toast(err.message, true); }
    });
    box.querySelector('#send-now').addEventListener('click', async () => {
        if (!form.reportValidity() || !confirm('Send this message to the Telegram group now?')) return;
        try {
            await api('/api/class-reminder/test', { method: 'POST', body: read() });
            toast('Sent to Telegram');
        } catch (err) { toast(err.message, true); }
    });
}

// ---------- Router ----------

const routes = [
    [/^\/$/, viewShop, 'Shop', '/'],
    [/^\/product\/(\d+)$/, viewProduct, 'Product', '/'],
    [/^\/cart$/, viewCart, 'Cart', '/cart'],
    [/^\/orders$/, viewOrders, 'Orders', '/orders'],
    [/^\/admin$/, viewAdmin, 'Admin', '/admin'],
];

async function render() {
    const path = location.pathname;
    const route = routes.find(([re]) => re.test(path));
    if (!route) {
        app.innerHTML = `<h1>Page not found</h1><a href="/" data-link class="btn">Go to shop</a>`;
        return;
    }
    const [re, view, title, navPath] = route;
    document.title = `${title} · WebShop`;
    document.querySelectorAll('.nav-links a').forEach(a =>
        a.classList.toggle('active', a.getAttribute('href') === navPath));
    try {
        await view(...path.match(re).slice(1));
    } catch (err) {
        app.innerHTML = `<div class="panel"><p class="warn">${esc(err.message)}</p>
            <a href="/" data-link class="btn">Back to shop</a></div>`;
    }
    window.scrollTo(0, 0);
}

function navigate(path) {
    if (path !== location.pathname) history.pushState(null, '', path);
    render();
}

document.addEventListener('click', e => {
    const link = e.target.closest('a[data-link]');
    if (link) {
        e.preventDefault();
        navigate(link.getAttribute('href'));
        return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
        cart.add(add.dataset.add);
        toast('Added to cart');
    }
});

window.addEventListener('popstate', render);

updateCartCount();
render();
