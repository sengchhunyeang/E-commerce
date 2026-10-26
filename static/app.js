// WebShop single page app: a tiny router plus one render function per view.

const app = document.getElementById('app');
const $ = sel => app.querySelector(sel);
const $$ = sel => app.querySelectorAll(sel);

// ---------- Helpers ----------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Number(n).toFixed(2);
const date = s => new Date(s).toLocaleString();

async function api(url, options = {}) {
    const res = await fetch(url, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json();
    if (res.status === 401 && me) {
        // The session ended (signed out elsewhere or password changed)
        me = null;
        drawNav();
    }
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

function stars(rating) {
    const full = Math.round(rating);
    return `<span class="stars" title="${rating} out of 5">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span>`;
}

const statusBadge = s => `<span class="status ${s}">${s}</span>`;

// ---------- Signed-in user ----------

let me = null;            // {id, name, email, role, phone, address} or null
let wished = new Set();   // product ids in the wishlist

async function loadMe() {
    me = await api('/api/auth/me');
    wished = new Set(me ? (await api('/api/wishlist')).map(p => p.id) : []);
    drawNav();
}

function drawNav() {
    const links = [['/', 'Shop'], ['/cart', 'Cart <span id="cart-count" class="badge">0</span>']];
    if (me) links.push(['/wishlist', 'Wishlist'], ['/orders', 'My orders']);
    if (me?.role === 'admin') links.push(['/admin', 'Admin']);
    links.push(me ? ['/account', `👤 ${esc(me.name.split(' ')[0])}`] : ['/signin', 'Sign in']);
    document.getElementById('nav').innerHTML =
        links.map(([href, label]) => `<li><a href="${href}" data-link>${label}</a></li>`).join('');
    updateCartCount();
    markActiveLink();
}

function markActiveLink() {
    const section = '/' + location.pathname.split('/')[1];
    document.querySelectorAll('#nav a').forEach(a =>
        a.classList.toggle('active', a.getAttribute('href') === (section === '/product' ? '/' : section)));
}

// Returns false (and goes to the sign-in page) when nobody is signed in.
function requireSignIn() {
    if (me) return true;
    navigate(`/signin?next=${encodeURIComponent(location.pathname)}`);
    return false;
}

async function toggleWish(id) {
    if (!requireSignIn()) return;
    const saved = wished.has(id);
    const list = await api(`/api/wishlist/${id}`, { method: saved ? 'DELETE' : 'PUT' });
    wished = new Set(list.map(p => p.id));
    document.querySelectorAll(`[data-wish="${id}"]`).forEach(b => drawWishButton(b, id));
    toast(saved ? 'Removed from wishlist' : 'Saved to wishlist');
}

function wishButton(id) {
    return `<button class="wish ${wished.has(id) ? 'on' : ''}" data-wish="${id}"
        title="${wished.has(id) ? 'Remove from wishlist' : 'Save to wishlist'}">${wished.has(id) ? '♥' : '♡'}</button>`;
}

function drawWishButton(button, id) {
    button.outerHTML = wishButton(id);
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
    const badge = document.getElementById('cart-count');
    if (badge) badge.textContent = count;
}

// ---------- Shop ----------

const SORTS = {
    newest: (a, b) => b.id - a.id,
    'price-asc': (a, b) => a.price - b.price,
    'price-desc': (a, b) => b.price - a.price,
    rating: (a, b) => b.rating - a.rating || b.review_count - a.review_count,
    name: (a, b) => a.name.localeCompare(b.name),
};

async function viewShop() {
    const [products, categories] = await Promise.all([api('/api/products'), api('/api/categories')]);
    app.innerHTML = `
        <div class="toolbar">
            <h1>Shop</h1>
            <div class="row">
                <input id="search" type="search" placeholder="Search products…">
                <select id="category">
                    <option value="">All categories</option>
                    ${categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
                </select>
                <select id="sort">
                    <option value="newest">Newest</option>
                    <option value="price-asc">Price: low to high</option>
                    <option value="price-desc">Price: high to low</option>
                    <option value="rating">Top rated</option>
                    <option value="name">Name</option>
                </select>
                <label class="check"><input id="in-stock" type="checkbox"> In stock</label>
            </div>
        </div>
        <div id="grid" class="grid"></div>`;

    const draw = () => {
        const q = $('#search').value.trim().toLowerCase();
        const category = Number($('#category').value);
        const list = products
            .filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
            .filter(p => !category || p.category_id === category)
            .filter(p => !$('#in-stock').checked || p.stock > 0)
            .sort(SORTS[$('#sort').value]);
        $('#grid').innerHTML = list.length ? list.map(productCard).join('') : '<p class="muted">No products found.</p>';
    };
    draw();
    $('#search').addEventListener('input', draw);
    ['#category', '#sort', '#in-stock'].forEach(sel => $(sel).addEventListener('change', draw));
}

function productCard(p) {
    return `
        <div class="card">
            <div class="card-media">
                <a href="/product/${p.id}" data-link>${thumb(p)}</a>
                ${wishButton(p.id)}
            </div>
            <div class="card-body">
                ${p.category ? `<span class="tag">${esc(p.category)}</span>` : ''}
                <a href="/product/${p.id}" data-link class="card-title">${esc(p.name)}</a>
                ${p.review_count ? `<div>${stars(p.rating)} <span class="muted">(${p.review_count})</span></div>` : ''}
                <div class="price">${money(p.price)}</div>
                <button class="btn" data-add="${p.id}" ${p.stock ? '' : 'disabled'}>
                    ${p.stock ? 'Add to cart' : 'Out of stock'}
                </button>
            </div>
        </div>`;
}

async function viewProduct(id) {
    const [p, reviews] = await Promise.all([api(`/api/products/${id}`), api(`/api/products/${id}/reviews`)]);
    document.title = `${p.name} · WebShop`;
    const mine = me && reviews.find(r => r.user_id === me.id);
    app.innerHTML = `
        <a href="/" data-link class="back">← Back to shop</a>
        <div class="panel detail">
            ${thumb(p, 'thumb large')}
            <div>
                ${p.category ? `<span class="tag">${esc(p.category)}</span>` : ''}
                <h1>${esc(p.name)}</h1>
                ${p.review_count ? `<p>${stars(p.rating)} ${p.rating} · ${p.review_count} review${p.review_count > 1 ? 's' : ''}</p>` : ''}
                <div class="price big">${money(p.price)}</div>
                <p>${esc(p.description) || '<span class="muted">No description.</span>'}</p>
                <p class="muted">${p.stock ? `${p.stock} in stock` : 'Out of stock'}</p>
                <div class="row">
                    ${p.stock ? `
                    <input id="qty" type="number" min="1" max="${p.stock}" value="1">
                    <button id="add" class="btn">Add to cart</button>` : ''}
                    ${wishButton(p.id)}
                </div>
            </div>
        </div>

        <h2>Reviews</h2>
        ${me ? `
        <form id="review-form" class="panel form">
            <h2>${mine ? 'Edit your review' : 'Write a review'}</h2>
            <div class="rating-input">
                ${[5, 4, 3, 2, 1].map(n => `
                    <input type="radio" name="rating" id="star${n}" value="${n}" ${mine?.rating === n ? 'checked' : ''} required>
                    <label for="star${n}" title="${n} star${n > 1 ? 's' : ''}">★</label>`).join('')}
            </div>
            <label>Comment <textarea name="comment" rows="3" placeholder="What did you think?">${esc(mine?.comment)}</textarea></label>
            <button class="btn">${mine ? 'Update review' : 'Post review'}</button>
        </form>` : `
        <div class="panel"><a href="/signin?next=/product/${p.id}" data-link>Sign in</a> to write a review.</div>`}
        <div class="panel">
            ${reviews.length ? reviews.map(r => `
                <div class="review">
                    <div class="row">
                        ${stars(r.rating)} <strong>${esc(r.name)}</strong>
                        <span class="muted">${esc(new Date(r.created_at).toLocaleDateString())}</span>
                        ${me && (r.user_id === me.id || me.role === 'admin')
                            ? `<button class="btn small danger" data-delete-review="${r.id}">Delete</button>` : ''}
                    </div>
                    ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
                </div>`).join('') : '<p class="muted">No reviews yet.</p>'}
        </div>`;

    $('#add')?.addEventListener('click', () => {
        const qty = Math.max(1, Math.min(p.stock, parseInt($('#qty').value) || 1));
        cart.add(p.id, qty);
        toast(`Added ${qty} × ${p.name} to cart`);
    });
    $('#review-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        const form = new FormData(e.target);
        try {
            await api(`/api/products/${p.id}/reviews`, {
                method: 'PUT', body: { rating: Number(form.get('rating')), comment: form.get('comment') },
            });
            toast('Thanks for your review!');
            viewProduct(id);
        } catch (err) { toast(err.message, true); }
    });
    $$('[data-delete-review]').forEach(btn => btn.addEventListener('click', async () => {
        if (!confirm('Delete this review?')) return;
        try {
            await api(`/api/products/${p.id}/reviews/${btn.dataset.deleteReview}`, { method: 'DELETE' });
            toast('Review deleted');
            viewProduct(id);
        } catch (err) { toast(err.message, true); }
    }));
}

async function viewWishlist() {
    if (!requireSignIn()) return;
    const products = await api('/api/wishlist');
    wished = new Set(products.map(p => p.id));
    app.innerHTML = `
        <h1>Wishlist</h1>
        ${products.length ? `<div class="grid">${products.map(productCard).join('')}</div>` : `
        <div class="panel"><p class="muted">Nothing saved yet. Tap ♡ on a product to save it.</p>
            <a href="/" data-link class="btn">Browse products</a></div>`}`;
}

// ---------- Cart & checkout ----------

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
        ${me ? `
        <form id="checkout" class="panel form">
            <div class="form-grid">
                <label>Full name <input name="customer" required value="${esc(me.name)}"></label>
                <label>Phone <input name="phone" type="tel" required value="${esc(me.phone)}"></label>
            </div>
            <label>Delivery address <textarea name="address" rows="2" required>${esc(me.address)}</textarea></label>
            <label>Note for the seller (optional) <input name="note" placeholder="e.g. call before delivery"></label>
            <p class="muted">Payment: cash on delivery. A confirmation goes to ${esc(me.email)}.</p>
            <button class="btn">Place order (${money(total)})</button>
        </form>` : `
        <div class="panel">
            <p>Sign in or create an account to check out. Your cart is kept.</p>
            <div class="row">
                <a href="/signin?next=/cart" data-link class="btn">Sign in</a>
                <a href="/signup?next=/cart" data-link class="btn secondary">Create account</a>
            </div>
        </div>`}`;

    $$('[data-qty]').forEach(input =>
        input.addEventListener('change', () => {
            cart.set(input.dataset.qty, parseInt(input.value) || 0);
            viewCart();
        }));
    $$('[data-remove]').forEach(btn =>
        btn.addEventListener('click', () => {
            cart.set(btn.dataset.remove, 0);
            viewCart();
        }));

    $('#checkout')?.addEventListener('submit', async e => {
        e.preventDefault();
        const button = e.target.querySelector('button');
        button.disabled = true;  // no double orders on a double click
        try {
            const order = await api('/api/orders', {
                method: 'POST',
                body: {
                    ...Object.fromEntries(new FormData(e.target)),
                    items: Object.entries(cart.load()).map(([product_id, qty]) => ({ product_id, qty })),
                },
            });
            cart.clear();
            await loadMe();  // the profile now remembers the delivery details
            toast(`Order #${order.id} placed. Thank you!`);
            navigate('/orders');
        } catch (err) {
            toast(err.message, true);
            button.disabled = false;
        }
    });
}

// ---------- Orders ----------

function orderPanel(o, adminControls = false) {
    return `
        <div class="panel order">
            <div class="order-head">
                <div>
                    <strong>Order #${o.id}</strong> · ${esc(date(o.created_at))}<br>
                    <span class="muted">${esc(o.customer)} &lt;${esc(o.email)}&gt;</span>
                    ${o.phone ? `<br><span class="muted">📞 ${esc(o.phone)}</span>` : ''}
                    ${o.address ? `<br><span class="muted">📍 ${esc(o.address)}</span>` : ''}
                    ${o.note ? `<br><span class="muted">📝 ${esc(o.note)}</span>` : ''}
                </div>
                <div class="row">
                    ${adminControls ? `
                    <select data-status="${o.id}" class="status ${o.status}" ${o.status === 'cancelled' ? 'disabled' : ''}>
                        ${window.ORDER_STATUSES.map(s =>
                            `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                    <button class="btn danger small" data-delete="${o.id}">Delete</button>` : `
                    ${statusBadge(o.status)}
                    ${o.status === 'pending' ? `<button class="btn secondary small" data-cancel="${o.id}">Cancel order</button>` : ''}`}
                </div>
            </div>
            <ul class="items">
                ${o.items.map(i => `<li>${i.qty} × ${esc(i.name)} <span>${money(i.price * i.qty)}</span></li>`).join('')}
            </ul>
            <div class="total">Total: ${money(o.total)}</div>
        </div>`;
}

async function viewMyOrders() {
    if (!requireSignIn()) return;
    const orders = await api('/api/orders/mine');
    app.innerHTML = `
        <h1>My orders</h1>
        ${orders.length ? orders.map(o => orderPanel(o)).join('') : `
        <div class="panel"><p class="muted">You haven't ordered anything yet.</p>
            <a href="/" data-link class="btn">Start shopping</a></div>`}`;

    $$('[data-cancel]').forEach(btn =>
        btn.addEventListener('click', async () => {
            if (!confirm(`Cancel order #${btn.dataset.cancel}?`)) return;
            try {
                await api(`/api/orders/${btn.dataset.cancel}/cancel`, { method: 'POST' });
                toast('Order cancelled');
                viewMyOrders();
            } catch (err) { toast(err.message, true); }
        }));
}

// ---------- Sign in, sign up, account ----------

const nextPath = () => {
    const next = new URLSearchParams(location.search).get('next') || '/';
    return next.startsWith('/') && !next.startsWith('//') ? next : '/';  // stay on this site
};

function viewSignIn() {
    if (me) return navigate(nextPath());
    app.innerHTML = `
        <form id="auth-form" class="panel form auth">
            <h1>Sign in</h1>
            <label>Email <input name="email" type="email" autocomplete="email" required autofocus></label>
            <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
            <button class="btn">Sign in</button>
            <p class="muted">New here? <a href="/signup${location.search}" data-link>Create an account</a></p>
        </form>`;
    authForm('/api/auth/signin', 'Welcome back!');
}

function viewSignUp() {
    if (me) return navigate(nextPath());
    app.innerHTML = `
        <form id="auth-form" class="panel form auth">
            <h1>Create account</h1>
            <label>Full name <input name="name" autocomplete="name" required autofocus></label>
            <label>Email <input name="email" type="email" autocomplete="email" required></label>
            <label>Password <input name="password" type="password" autocomplete="new-password" minlength="8" required>
                <span class="muted hint">At least 8 characters</span></label>
            <button class="btn">Create account</button>
            <p class="muted">Already have an account? <a href="/signin${location.search}" data-link>Sign in</a></p>
        </form>`;
    authForm('/api/auth/signup', 'Account created. Welcome!');
}

function authForm(url, message) {
    $('#auth-form').addEventListener('submit', async e => {
        e.preventDefault();
        const button = e.target.querySelector('button');
        button.disabled = true;
        try {
            await api(url, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
            await loadMe();
            toast(message);
            navigate(nextPath());
        } catch (err) {
            toast(err.message, true);
            button.disabled = false;
        }
    });
}

function viewAccount() {
    if (!requireSignIn()) return;
    app.innerHTML = `
        <div class="toolbar">
            <h1>My account</h1>
            <button id="signout" class="btn secondary">Sign out</button>
        </div>
        <form id="profile" class="panel form">
            <h2>Profile</h2>
            <p class="muted">${esc(me.email)}${me.role === 'admin' ? ' · admin' : ''}</p>
            <div class="form-grid">
                <label>Full name <input name="name" required value="${esc(me.name)}"></label>
                <label>Phone <input name="phone" type="tel" value="${esc(me.phone)}"></label>
            </div>
            <label>Delivery address <textarea name="address" rows="2">${esc(me.address)}</textarea></label>
            <button class="btn">Save profile</button>
        </form>
        <form id="password" class="panel form">
            <h2>Change password</h2>
            <div class="form-grid">
                <label>Current password <input name="current_password" type="password" autocomplete="current-password" required></label>
                <label>New password <input name="new_password" type="password" autocomplete="new-password" minlength="8" required></label>
            </div>
            <p class="muted">You stay signed in here; other devices are signed out.</p>
            <button class="btn">Change password</button>
        </form>`;

    $('#profile').addEventListener('submit', async e => {
        e.preventDefault();
        try {
            me = await api('/api/auth/me', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
            drawNav();
            toast('Profile saved');
        } catch (err) { toast(err.message, true); }
    });
    $('#password').addEventListener('submit', async e => {
        e.preventDefault();
        try {
            await api('/api/auth/password', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
            e.target.reset();
            toast('Password changed');
        } catch (err) { toast(err.message, true); }
    });
    $('#signout').addEventListener('click', async () => {
        await api('/api/auth/signout', { method: 'POST' });
        me = null;
        wished = new Set();
        drawNav();
        toast('Signed out');
        navigate('/');
    });
}

// ---------- Admin ----------

const ADMIN_TABS = [
    ['', 'Dashboard', adminDashboard],
    ['orders', 'Orders', adminOrders],
    ['products', 'Products', adminProducts],
    ['categories', 'Categories', adminCategories],
    ['customers', 'Customers', adminCustomers],
    ['reminder', 'Class reminder', drawReminder],
];

async function viewAdmin(tab = '') {
    if (!requireSignIn()) return;
    if (me.role !== 'admin') {
        app.innerHTML = `<div class="panel"><p class="warn">Admins only.</p></div>`;
        return;
    }
    const current = ADMIN_TABS.find(([key]) => key === tab);
    if (!current) return navigate('/admin');
    app.innerHTML = `
        <h1>Admin</h1>
        <div class="tabs">${ADMIN_TABS.map(([key, label]) =>
            `<a href="/admin${key ? '/' + key : ''}" data-link class="${key === tab ? 'active' : ''}">${label}</a>`).join('')}
        </div>
        <div id="admin-body"><p class="muted">Loading…</p></div>`;
    await current[2]();
}

const adminBody = () => $('#admin-body');

async function adminDashboard() {
    const s = await api('/api/admin/stats');
    const tiles = [
        ['Revenue', money(s.totals.revenue)],
        ['Last 30 days', money(s.totals.revenue_30d)],
        ['Orders', s.totals.orders],
        ['Customers', s.totals.customers],
        ['Products', s.totals.products],
    ];
    adminBody().innerHTML = `
        <div class="stats">${tiles.map(([label, value]) =>
            `<div class="stat"><div class="muted">${label}</div><div class="stat-value">${value}</div></div>`).join('')}
        </div>
        <div class="panel">
            <h2>Orders by status</h2>
            <div class="row">${window.ORDER_STATUSES.map(st =>
                `<a href="/admin/orders?status=${st}" data-link class="status ${st} pill">${st}: ${s.by_status[st] || 0}</a>`).join('')}
            </div>
        </div>
        <div class="two-col">
            <div class="panel">
                <h2>Best sellers</h2>
                ${s.best_sellers.length ? `<table><tbody>${s.best_sellers.map(b =>
                    `<tr><td>${esc(b.name)}</td><td>${b.qty} sold</td><td>${money(b.sales)}</td></tr>`).join('')}</tbody></table>`
                    : '<p class="muted">No sales yet.</p>'}
            </div>
            <div class="panel">
                <h2>Low stock</h2>
                ${s.low_stock.length ? `<table><tbody>${s.low_stock.map(p =>
                    `<tr><td>${esc(p.name)}</td><td class="${p.stock ? '' : 'warn'}">${p.stock ? `${p.stock} left` : 'Sold out'}</td></tr>`).join('')}</tbody></table>`
                    : '<p class="muted">Everything is well stocked.</p>'}
            </div>
        </div>`;
}

async function adminOrders() {
    const orders = await api('/api/orders');
    const status = new URLSearchParams(location.search).get('status') || '';
    adminBody().innerHTML = `
        <div class="toolbar">
            <input id="order-search" type="search" placeholder="Search name, email, phone or #id…">
            <select id="order-status">
                <option value="">All statuses</option>
                ${window.ORDER_STATUSES.map(s => `<option value="${s}" ${s === status ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
        </div>
        <div id="order-list"></div>`;

    const draw = () => {
        const q = $('#order-search').value.trim().toLowerCase();
        const st = $('#order-status').value;
        const list = orders
            .filter(o => !st || o.status === st)
            .filter(o => !q || `#${o.id} ${o.customer} ${o.email} ${o.phone}`.toLowerCase().includes(q));
        $('#order-list').innerHTML = list.length ? list.map(o => orderPanel(o, true)).join('')
            : '<div class="panel"><p class="muted">No orders.</p></div>';

        $$('[data-status]').forEach(select =>
            select.addEventListener('change', async () => {
                const id = Number(select.dataset.status);
                if (select.value === 'cancelled' &&
                    !confirm(`Cancel order #${id}? Its items go back in stock, and it can't be reopened.`)) {
                    select.value = orders.find(o => o.id === id).status;
                    return;
                }
                try {
                    const updated = await api(`/api/orders/${id}`, { method: 'PUT', body: { status: select.value } });
                    Object.assign(orders.find(o => o.id === id), updated);
                    toast('Order status updated');
                    draw();
                } catch (err) { toast(err.message, true); }
            }));
        $$('[data-delete]').forEach(btn =>
            btn.addEventListener('click', async () => {
                if (!confirm(`Delete order #${btn.dataset.delete}? This can't be undone.`)) return;
                try {
                    await api(`/api/orders/${btn.dataset.delete}`, { method: 'DELETE' });
                    orders.splice(orders.findIndex(o => o.id == btn.dataset.delete), 1);
                    toast('Order deleted');
                    draw();
                } catch (err) { toast(err.message, true); }
            }));
    };
    draw();
    $('#order-search').addEventListener('input', draw);
    $('#order-status').addEventListener('change', draw);
}

async function adminProducts() {
    const [products, categories] = await Promise.all([api('/api/products'), api('/api/categories')]);
    adminBody().innerHTML = `
        <form id="product-form" class="panel form">
            <h2 id="form-title">Add product</h2>
            <input type="hidden" name="id">
            <div class="form-grid">
                <label>Name <input name="name" required></label>
                <label>Category
                    <select name="category_id">
                        <option value="">— None —</option>
                        ${categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
                    </select>
                </label>
                <label>Price <input name="price" type="number" step="0.01" min="0" required></label>
                <label>Stock <input name="stock" type="number" step="1" min="0" required></label>
                <label>Image URL <input name="image_url" placeholder="optional, or upload →"></label>
                <label>Upload image
                    <input id="image-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
                </label>
            </div>
            <img id="image-preview" class="thumb preview" alt="Product image preview" hidden>
            <label>Description <textarea name="description" rows="3"></textarea></label>
            <div class="row">
                <button class="btn">Save</button>
                <button type="button" id="cancel-edit" class="btn secondary" hidden>Cancel</button>
            </div>
        </form>

        <div class="panel">
            <table>
                <thead><tr><th></th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Rating</th><th></th></tr></thead>
                <tbody>
                ${products.map(p => `
                    <tr>
                        <td>${thumb(p, 'thumb tiny')}</td>
                        <td><a href="/product/${p.id}" data-link>${esc(p.name)}</a></td>
                        <td>${esc(p.category || '—')}</td>
                        <td>${money(p.price)}</td>
                        <td class="${p.stock ? '' : 'warn'}">${p.stock}</td>
                        <td>${p.review_count ? `${p.rating} ★ (${p.review_count})` : '—'}</td>
                        <td class="actions">
                            <button class="btn small secondary" data-edit="${p.id}">Edit</button>
                            <button class="btn small danger" data-delete="${p.id}">Delete</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;

    const form = $('#product-form');
    const preview = $('#image-preview');
    const showPreview = () => {
        preview.hidden = !form.image_url.value;
        if (form.image_url.value) preview.src = form.image_url.value;
    };
    form.image_url.addEventListener('change', showPreview);

    $('#image-file').addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        const save = form.querySelector('button:not([type])');
        save.disabled = true;
        try {
            const body = new FormData();
            body.append('file', file);
            const res = await fetch('/api/images', { method: 'POST', body });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');
            form.image_url.value = data.url;
            showPreview();
            toast('Image uploaded. Click Save to keep it.');
        } catch (err) {
            toast(err.message, true);
        } finally {
            save.disabled = false;
            e.target.value = '';
        }
    });

    const resetForm = () => {
        form.reset();
        form.id.value = '';
        showPreview();
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
            adminProducts();
        } catch (err) { toast(err.message, true); }
    });
    $('#cancel-edit').addEventListener('click', resetForm);

    $$('[data-edit]').forEach(btn =>
        btn.addEventListener('click', () => {
            const p = products.find(x => x.id == btn.dataset.edit);
            for (const key of ['id', 'name', 'price', 'stock', 'image_url', 'description']) form[key].value = p[key];
            form.category_id.value = p.category_id ?? '';
            showPreview();
            $('#form-title').textContent = `Edit product #${p.id}`;
            $('#cancel-edit').hidden = false;
            form.scrollIntoView({ behavior: 'smooth' });
        }));
    $$('[data-delete]').forEach(btn =>
        btn.addEventListener('click', async () => {
            if (!confirm('Delete this product?')) return;
            try {
                await api(`/api/products/${btn.dataset.delete}`, { method: 'DELETE' });
                cart.set(btn.dataset.delete, 0);
                toast('Product deleted');
                adminProducts();
            } catch (err) { toast(err.message, true); }
        }));
}

async function adminCategories() {
    const categories = await api('/api/categories');
    adminBody().innerHTML = `
        <form id="category-form" class="panel form row">
            <input name="name" placeholder="New category name" required>
            <button class="btn">Add category</button>
        </form>
        <div class="panel">
            ${categories.length ? `<table>
                <thead><tr><th>Name</th><th>Products</th><th></th></tr></thead>
                <tbody>${categories.map(c => `
                    <tr>
                        <td><input value="${esc(c.name)}" data-name="${c.id}"></td>
                        <td>${c.product_count}</td>
                        <td class="actions">
                            <button class="btn small secondary" data-rename="${c.id}">Rename</button>
                            <button class="btn small danger" data-delete="${c.id}">Delete</button>
                        </td>
                    </tr>`).join('')}
                </tbody></table>` : '<p class="muted">No categories yet.</p>'}
        </div>`;

    $('#category-form').addEventListener('submit', async e => {
        e.preventDefault();
        try {
            await api('/api/categories', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
            toast('Category added');
            adminCategories();
        } catch (err) { toast(err.message, true); }
    });
    $$('[data-rename]').forEach(btn => btn.addEventListener('click', async () => {
        try {
            const name = $(`[data-name="${btn.dataset.rename}"]`).value;
            await api(`/api/categories/${btn.dataset.rename}`, { method: 'PUT', body: { name } });
            toast('Category renamed');
        } catch (err) { toast(err.message, true); }
    }));
    $$('[data-delete]').forEach(btn => btn.addEventListener('click', async () => {
        if (!confirm('Delete this category? Its products are kept, without a category.')) return;
        try {
            await api(`/api/categories/${btn.dataset.delete}`, { method: 'DELETE' });
            toast('Category deleted');
            adminCategories();
        } catch (err) { toast(err.message, true); }
    }));
}

async function adminCustomers() {
    const users = await api('/api/admin/users');
    adminBody().innerHTML = `
        <div class="panel">
            <table>
                <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Joined</th><th>Orders</th><th>Spent</th><th>Role</th></tr></thead>
                <tbody>${users.map(u => `
                    <tr>
                        <td>${esc(u.name)}</td>
                        <td>${esc(u.email)}</td>
                        <td>${esc(u.phone) || '—'}</td>
                        <td>${esc(new Date(u.created_at).toLocaleDateString())}</td>
                        <td>${u.orders}</td>
                        <td>${money(u.spent)}</td>
                        <td><select data-role="${u.id}" ${u.id === me.id ? 'disabled title="You can\'t change your own role"' : ''}>
                            ${['customer', 'admin'].map(r => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}
                        </select></td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;

    $$('[data-role]').forEach(select => select.addEventListener('change', async () => {
        const user = users.find(u => u.id == select.dataset.role);
        if (!confirm(`Make ${user.name} ${select.value === 'admin' ? 'an admin' : 'a customer'}?`)) {
            select.value = user.role;
            return;
        }
        try {
            await api(`/api/admin/users/${user.id}/role`, { method: 'PUT', body: { role: select.value } });
            user.role = select.value;
            toast('Role updated');
        } catch (err) {
            select.value = user.role;
            toast(err.message, true);
        }
    }));
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Telegram class reminder settings (Admin → Class reminder)
async function drawReminder() {
    const box = adminBody();
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
    [/^\/$/, viewShop, 'Shop'],
    [/^\/product\/(\d+)$/, viewProduct, 'Product'],
    [/^\/cart$/, viewCart, 'Cart'],
    [/^\/wishlist$/, viewWishlist, 'Wishlist'],
    [/^\/orders$/, viewMyOrders, 'My orders'],
    [/^\/signin$/, viewSignIn, 'Sign in'],
    [/^\/signup$/, viewSignUp, 'Create account'],
    [/^\/account$/, viewAccount, 'My account'],
    [/^\/admin(?:\/(\w+))?$/, viewAdmin, 'Admin'],
];

async function render() {
    const path = location.pathname;
    const route = routes.find(([re]) => re.test(path));
    markActiveLink();
    if (!route) {
        app.innerHTML = `<h1>Page not found</h1><a href="/" data-link class="btn">Go to shop</a>`;
        return;
    }
    const [re, view, title] = route;
    document.title = `${title} · WebShop`;
    try {
        await view(...path.match(re).slice(1));
    } catch (err) {
        app.innerHTML = `<div class="panel"><p class="warn">${esc(err.message)}</p>
            <a href="/" data-link class="btn">Back to shop</a></div>`;
    }
    window.scrollTo(0, 0);
}

function navigate(path) {
    if (path !== location.pathname + location.search) history.pushState(null, '', path);
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
        return;
    }
    const wish = e.target.closest('[data-wish]');
    if (wish) {
        toggleWish(Number(wish.dataset.wish)).catch(err => toast(err.message, true));
    }
});

window.addEventListener('popstate', render);

loadMe().catch(() => drawNav()).finally(render);
