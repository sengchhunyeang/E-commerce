// WebShop single page app: a tiny router plus one render function per view.

const app = document.getElementById('app');
const $ = sel => app.querySelector(sel);
const $$ = sel => app.querySelectorAll(sel);

// ---------- Helpers ----------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Number(n).toFixed(2);
const date = s => new Date(s).toLocaleString();
const day = s => new Date(s).toLocaleDateString();

// Catalog reads (products, categories, shop settings) are kept for a minute so going back
// and forth is instant. Any change (POST/PUT/DELETE) empties the cache.
const CACHED = /^\/api\/(products|categories|settings)\b/;
const CACHE_MS = 60_000;
const apiCache = new Map();  // url -> {at, promise}

function api(url, options = {}) {
    if (options.method && options.method !== 'GET') {
        apiCache.clear();
        return request(url, options);
    }
    // Admin pages always read fresh numbers (stock changes with every order).
    if (!CACHED.test(url) || location.pathname.startsWith('/admin')) return request(url, options);
    const hit = apiCache.get(url);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
    const promise = request(url, options);
    apiCache.set(url, { at: Date.now(), promise });
    promise.catch(() => apiCache.delete(url));
    return promise;
}

// Load a page's data in the background (on hover) so it opens instantly.
function prefetch(path) {
    const product = path.match(/^\/product\/(\d+)$/);
    const urls = product ? [`/api/products/${product[1]}`, `/api/products/${product[1]}/reviews`,
                            `/api/products/${product[1]}/related`]
        : path === '/' || path === '/cart' ? ['/api/products', '/api/categories'] : [];
    urls.forEach(url => api(url).catch(() => { }));
}

async function request(url, options) {
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

// POST one file as multipart "file"; returns the JSON response.
async function uploadFile(url, file) {
    const body = new FormData();
    body.append('file', file);
    const res = await fetch(url, { method: 'POST', body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
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
        ? `<img class="${cls}" src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`
        : `<div class="${cls} placeholder">${esc(p.name.charAt(0).toUpperCase())}</div>`;
}

function stars(rating) {
    const full = Math.round(rating);
    return `<span class="stars" title="${rating} out of 5">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span>`;
}

const statusBadge = s => `<span class="status ${s}">${s}</span>`;

// ---------- Prices, options and sales ----------

const variantPrice = (p, v) => (v && v.price != null ? v.price : p.price);
const onSale = p => p.compare_at_price != null && p.compare_at_price > p.price;

function priceRange(p) {
    if (!p.variants?.length) return money(p.price);
    const prices = p.variants.map(v => variantPrice(p, v));
    const lo = Math.min(...prices), hi = Math.max(...prices);
    return lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`;
}

function priceTag(p, big = false) {
    return `<div class="price ${big ? 'big' : ''}">${priceRange(p)}
        ${onSale(p) ? `<s class="was">${money(p.compare_at_price)}</s>` : ''}</div>`;
}

const saleBadge = p => onSale(p)
    ? `<span class="sale-badge">−${Math.round((1 - p.price / p.compare_at_price) * 100)}%</span>` : '';

// ---------- Orders: charges, payment, timeline ----------

const PAY_METHOD = { cod: 'Cash on delivery', bank: 'Bank transfer' };
const PAY_STATUS = { unpaid: 'unpaid', submitted: 'checking payment', paid: 'paid' };
const paymentBadge = o =>
    `<span class="pay ${o.payment_status}">${PAY_METHOD[o.payment_method]} · ${PAY_STATUS[o.payment_status]}</span>`;

// Subtotal, discount, shipping, tax and total of an order or a checkout quote
function charges(o, showFreeShipping = false) {
    const row = (label, value, cls = '') => `<div class="sum-row ${cls}"><span>${label}</span><span>${value}</span></div>`;
    return `<div class="summary">
        ${row('Subtotal', money(o.subtotal))}
        ${o.discount ? row(`Discount${o.coupon_code ? ` (${esc(o.coupon_code)})` : ''}`, '−' + money(o.discount), 'good') : ''}
        ${o.shipping_fee || showFreeShipping ? row('Shipping', o.shipping_fee ? money(o.shipping_fee) : 'Free') : ''}
        ${o.tax ? row('Tax', money(o.tax)) : ''}
        ${row('Total', money(o.total), 'grand')}
    </div>`;
}

const EVENTS = {
    placed: '🛒 Order placed',
    pending: '↩ Back to pending',
    shipped: '🚚 Shipped',
    delivered: '✅ Delivered',
    cancelled: '❌ Cancelled',
    'payment submitted': '🧾 Payment screenshot sent',
    'payment confirmed': '💳 Payment confirmed',
    'payment marked unpaid': '↩ Payment marked unpaid',
};

function timeline(o) {
    const next = { pending: ['🚚 Shipped', '✅ Delivered'], shipped: ['✅ Delivered'] }[o.status] || [];
    return `<ol class="timeline">
        ${o.events.map(e => `<li class="done"><span>${EVENTS[e.event] || esc(e.event)}</span>
            <time>${esc(date(e.created_at))}</time></li>`).join('')}
        ${next.map(label => `<li class="todo"><span>${label}</span></li>`).join('')}
    </ol>`;
}

// ---------- Signed-in user and shop settings ----------

let me = null;            // {id, name, email, role, phone, address, telegram} or null
let wished = new Set();   // product ids in the wishlist
let shop = {};            // /api/settings: shop details, shipping, tax, bank payment

async function loadMe() {
    // Both at once; the wishlist call fails harmlessly when nobody is signed in.
    const [user, list] = await Promise.all([api('/api/auth/me'), api('/api/wishlist').catch(() => [])]);
    me = user;
    wished = new Set(me ? list.map(p => p.id) : []);
    drawNav();
}

async function loadShop() {
    try { shop = await api('/api/settings'); } catch { shop = {}; }
}

function drawNav() {
    const links = [['/', 'Shop'], ['/cart', 'Cart <span id="cart-count" class="badge">0</span>']];
    if (me) links.push(['/wishlist', 'Wishlist'], ['/orders', 'My orders']);
    if (me?.role === 'admin') links.push(['/admin', 'Admin']);
    links.push(me ? ['/account', `👤 ${esc(me.name.split(' ')[0])}`] : ['/signin', 'Sign in']);
    document.getElementById('nav').innerHTML =
        links.map(([href, label]) => `<li><a href="${href}" data-link>${label}</a></li>`).join('') +
        (me ? '<li><button type="button" class="nav-signout" data-signout>Sign out</button></li>' : '');
    updateCartCount();
    markActiveLink();
}

async function signOut() {
    try {
        await api('/api/auth/signout', { method: 'POST' });
    } catch (err) {
        return toast(err.message, true);
    }
    me = null;
    wished = new Set();
    drawNav();
    toast('Signed out');
    navigate('/');
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
// Keys are "productId" or "productId:variantId"; values are quantities.

const cart = {
    load() {
        try { return JSON.parse(localStorage.getItem('cart')) || {}; } catch { return {}; }
    },
    save(items) {
        try { localStorage.setItem('cart', JSON.stringify(items)); } catch { }
        updateCartCount();
    },
    add(key, qty = 1) {
        const items = this.load();
        items[key] = (items[key] || 0) + qty;
        this.save(items);
    },
    set(key, qty) {
        const items = this.load();
        if (qty > 0) items[key] = qty; else delete items[key];
        this.save(items);
    },
    clear() { this.save({}); },
};

const cartKey = (productId, variantId) => (variantId ? `${productId}:${variantId}` : String(productId));

function cartItems() {
    return Object.entries(cart.load()).map(([key, qty]) => {
        const [product_id, variant_id] = key.split(':').map(Number);
        return { product_id, variant_id: variant_id || null, qty };
    });
}

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
    const featured = products.filter(p => p.featured);
    app.innerHTML = `
        <div id="featured"></div>
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
                <label class="check"><input id="on-sale" type="checkbox"> On sale</label>
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
            .filter(p => !$('#on-sale').checked || onSale(p))
            .sort(SORTS[$('#sort').value]);
        $('#grid').innerHTML = list.length ? list.map(productCard).join('') : '<p class="muted">No products found.</p>';
        // Featured strip only on the unfiltered shop
        const filtered = q || category || $('#in-stock').checked || $('#on-sale').checked;
        $('#featured').innerHTML = featured.length && !filtered ? `
            <h2>⭐ Featured</h2>
            <div class="grid featured">${featured.slice(0, 4).map(productCard).join('')}</div>` : '';
    };
    draw();
    $('#search').addEventListener('input', draw);
    ['#category', '#sort', '#in-stock', '#on-sale'].forEach(sel => $(sel).addEventListener('change', draw));
}

function productCard(p) {
    const button = !p.stock
        ? `<button class="btn" disabled>Out of stock</button>`
        : p.variants?.length
            ? `<a href="/product/${p.id}" data-link class="btn">Choose options</a>`
            : `<button class="btn" data-add="${p.id}">Add to cart</button>`;
    return `
        <div class="card">
            <div class="card-media">
                <a href="/product/${p.id}" data-link>${thumb(p)}</a>
                ${saleBadge(p)}
                ${wishButton(p.id)}
            </div>
            <div class="card-body">
                ${p.category ? `<span class="tag">${esc(p.category)}</span>` : ''}
                <a href="/product/${p.id}" data-link class="card-title">${esc(p.name)}</a>
                ${p.review_count ? `<div>${stars(p.rating)} <span class="muted">(${p.review_count})</span></div>` : ''}
                ${priceTag(p)}
                ${button}
            </div>
        </div>`;
}

async function viewProduct(id) {
    const [p, reviews, related] = await Promise.all([
        api(`/api/products/${id}`), api(`/api/products/${id}/reviews`), api(`/api/products/${id}/related`)]);
    document.title = `${p.name} · WebShop`;
    const mine = me && reviews.find(r => r.user_id === me.id);
    const photos = [p.image_url, ...(p.images || [])].filter(Boolean);
    const hasVariants = p.variants.length > 0;
    app.innerHTML = `
        <a href="/" data-link class="back">← Back to shop</a>
        <div class="panel detail">
            <div class="gallery">
                <div class="card-media">${photos.length
                    ? `<img id="main-photo" class="thumb large" src="${esc(photos[0])}" alt="${esc(p.name)}">`
                    : thumb(p, 'thumb large')}${saleBadge(p)}</div>
                ${photos.length > 1 ? `<div class="gallery-thumbs">${photos.map((src, i) => `
                    <button type="button" class="${i ? '' : 'active'}" data-photo="${esc(src)}">
                        <img src="${esc(src)}" alt="${esc(p.name)} photo ${i + 1}"></button>`).join('')}</div>` : ''}
            </div>
            <div>
                ${p.category ? `<span class="tag">${esc(p.category)}</span>` : ''}
                <h1>${esc(p.name)}</h1>
                ${p.review_count ? `<p>${stars(p.rating)} ${p.rating} · ${p.review_count} review${p.review_count > 1 ? 's' : ''}</p>` : ''}
                <div id="price">${priceTag(p, true)}</div>
                <p>${esc(p.description) || '<span class="muted">No description.</span>'}</p>
                ${hasVariants ? `
                <label class="option-picker">Option
                    <select id="variant">
                        <option value="">Choose…</option>
                        ${p.variants.map(v => `<option value="${v.id}" ${v.stock ? '' : 'disabled'}>
                            ${esc(v.name)} — ${money(variantPrice(p, v))}${v.stock ? '' : ' (sold out)'}</option>`).join('')}
                    </select>
                </label>` : ''}
                <p id="stock" class="muted">${p.stock ? (hasVariants ? 'Choose an option' : `${p.stock} in stock`) : 'Out of stock'}</p>
                <div class="row">
                    ${p.stock ? `
                    <input id="qty" type="number" min="1" max="${p.stock}" value="1">
                    <button id="add" class="btn">Add to cart</button>` : ''}
                    ${wishButton(p.id)}
                </div>
            </div>
        </div>

        ${related.length ? `<h2>You may also like</h2><div class="grid">${related.map(productCard).join('')}</div>` : ''}

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
                        <span class="muted">${esc(day(r.created_at))}</span>
                        ${me && (r.user_id === me.id || me.role === 'admin')
                            ? `<button class="btn small danger" data-delete-review="${r.id}">Delete</button>` : ''}
                    </div>
                    ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
                </div>`).join('') : '<p class="muted">No reviews yet.</p>'}
        </div>`;

    $$('[data-photo]').forEach(btn => btn.addEventListener('click', () => {
        $('#main-photo').src = btn.dataset.photo;
        $$('[data-photo]').forEach(b => b.classList.toggle('active', b === btn));
    }));

    const chosen = () => p.variants.find(v => v.id === Number($('#variant')?.value));
    $('#variant')?.addEventListener('change', () => {
        const v = chosen();
        $('#price').innerHTML = v
            ? `<div class="price big">${money(variantPrice(p, v))}</div>` : priceTag(p, true);
        $('#stock').textContent = v ? `${v.stock} in stock` : 'Choose an option';
        $('#qty').max = v ? v.stock : p.stock;
    });

    $('#add')?.addEventListener('click', () => {
        const v = chosen();
        if (hasVariants && !v) {
            toast('Choose an option first', true);
            return;
        }
        const max = v ? v.stock : p.stock;
        const qty = Math.max(1, Math.min(max, parseInt($('#qty').value) || 1));
        cart.add(cartKey(p.id, v?.id), qty);
        toast(`Added ${qty} × ${p.name}${v ? ` (${v.name})` : ''} to cart`);
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

let couponCode = '';  // kept while moving around the site

async function viewCart() {
    const products = await api('/api/products');
    const byId = Object.fromEntries(products.map(p => [p.id, p]));

    // Drop products and options that were deleted since they were added
    for (const { product_id, variant_id } of cartItems()) {
        const p = byId[product_id];
        if (!p || (variant_id && !p.variants.some(v => v.id === variant_id))
            || (!variant_id && p.variants.length)) cart.set(cartKey(product_id, variant_id), 0);
    }

    const lines = cartItems().map(({ product_id, variant_id, qty }) => {
        const p = byId[product_id];
        const v = p.variants.find(x => x.id === variant_id);
        return { key: cartKey(product_id, variant_id), p, v, qty,
                 price: variantPrice(p, v), stock: v ? v.stock : p.stock };
    });
    if (!lines.length) {
        app.innerHTML = `<h1>Your cart</h1><div class="panel"><p class="muted">Your cart is empty.</p>
            <a href="/" data-link class="btn">Continue shopping</a></div>`;
        return;
    }

    app.innerHTML = `
        <h1>Your cart</h1>
        <div class="panel">
            <table>
                <thead><tr><th>Product</th><th>Price</th><th>Qty</th><th>Subtotal</th><th></th></tr></thead>
                <tbody>
                ${lines.map(({ key, p, v, qty, price, stock }) => `
                    <tr>
                        <td><a href="/product/${p.id}" data-link>${esc(p.name)}</a>
                            ${v ? `<div class="muted">${esc(v.name)}</div>` : ''}
                            ${qty > stock ? `<div class="warn">Only ${stock} in stock</div>` : ''}</td>
                        <td>${money(price)}</td>
                        <td><input type="number" min="0" max="${stock}" value="${qty}" data-qty="${key}" class="qty"></td>
                        <td>${money(price * qty)}</td>
                        <td><button class="btn danger small" data-remove="${key}">Remove</button></td>
                    </tr>`).join('')}
                </tbody>
            </table>
            <form id="coupon" class="row coupon">
                <input name="code" placeholder="Coupon code" value="${esc(couponCode)}" autocomplete="off">
                <button class="btn secondary small">Apply</button>
                ${couponCode ? '<button type="button" id="remove-coupon" class="btn small secondary">Remove</button>' : ''}
                <span id="coupon-msg" class="warn"></span>
            </form>
            <div id="totals"><p class="muted">Calculating…</p></div>
            <p id="free-ship" class="muted"></p>
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
            <div class="pay-methods">Payment
                <label class="check"><input type="radio" name="payment_method" value="cod" checked> 💵 Cash on delivery</label>
                ${shop.bank_enabled ? `<label class="check"><input type="radio" name="payment_method" value="bank">
                    🏦 Bank transfer / KHQR <span class="muted">(pay now, then upload your receipt)</span></label>` : ''}
            </div>
            <p class="muted">A confirmation goes to ${esc(me.email)}.</p>
            <button id="place" class="btn">Place order</button>
        </form>` : `
        <div class="panel">
            <p>Sign in or create an account to check out. Your cart is kept.</p>
            <div class="row">
                <a href="/signin?next=/cart" data-link class="btn">Sign in</a>
                <a href="/signup?next=/cart" data-link class="btn secondary">Create account</a>
            </div>
        </div>`}`;

    // The server prices the cart (coupon, shipping, tax) so the total always matches the order.
    const quote = async () => {
        let q;
        const msg = $('#coupon-msg');
        try {
            q = await api('/api/orders/quote', { method: 'POST', body: { items: cartItems(), coupon_code: couponCode } });
            msg.textContent = q.coupon_code ? `✓ ${q.coupon_code} applied` : '';
            msg.className = 'good';
        } catch (err) {
            msg.textContent = err.message;
            msg.className = 'warn';
            couponCode = '';
            q = await api('/api/orders/quote', { method: 'POST', body: { items: cartItems(), coupon_code: '' } });
        }
        $('#totals').innerHTML = charges(q, shop.shipping_fee > 0);  // "Free" only if shipping usually costs
        const left = shop.free_shipping_over - (q.subtotal - q.discount);
        $('#free-ship').textContent = shop.free_shipping_over > 0 && shop.shipping_fee > 0 && left > 0
            ? `Add ${money(left)} more for free shipping.` : '';
        if ($('#place')) $('#place').textContent = `Place order (${money(q.total)})`;
    };
    quote().catch(err => toast(err.message, true));

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
    $('#coupon').addEventListener('submit', e => {
        e.preventDefault();
        couponCode = e.target.code.value.trim();
        viewCart();  // quote() shows whether the coupon worked
    });
    $('#remove-coupon')?.addEventListener('click', () => {
        couponCode = '';
        viewCart();
    });

    $('#checkout')?.addEventListener('submit', async e => {
        e.preventDefault();
        const button = e.target.querySelector('#place');
        button.disabled = true;  // no double orders on a double click
        try {
            const order = await api('/api/orders', {
                method: 'POST',
                body: { ...Object.fromEntries(new FormData(e.target)), items: cartItems(), coupon_code: couponCode },
            });
            cart.clear();
            couponCode = '';
            await loadMe();  // the profile now remembers the delivery details
            toast(`Order #${order.id} placed. Thank you!`);
            navigate(`/orders/${order.id}`);
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
            ${charges(o)}
            <div class="order-foot row">
                ${paymentBadge(o)}
                ${adminControls && o.payment_proof
                    ? `<a href="/api/orders/${o.id}/payment-proof" target="_blank" rel="noopener" class="btn small secondary">🧾 Screenshot</a>` : ''}
                ${adminControls && o.status !== 'cancelled' ? (o.payment_status === 'paid'
                    ? `<button class="btn small secondary" data-paid="${o.id}" data-value="unpaid">Mark unpaid</button>`
                    : `<button class="btn small" data-paid="${o.id}" data-value="paid">Mark paid</button>`) : ''}
                <span class="spacer"></span>
                <a href="/orders/${o.id}" data-link class="btn small secondary">Details</a>
                <a href="/orders/${o.id}/invoice" data-link class="btn small secondary">Invoice</a>
            </div>
        </div>`;
}

// Cancel buttons on customer order panels
function bindCancel(after) {
    $$('[data-cancel]').forEach(btn =>
        btn.addEventListener('click', async () => {
            if (!confirm(`Cancel order #${btn.dataset.cancel}?`)) return;
            try {
                await api(`/api/orders/${btn.dataset.cancel}/cancel`, { method: 'POST' });
                toast('Order cancelled');
                after();
            } catch (err) { toast(err.message, true); }
        }));
}

async function viewMyOrders() {
    if (!requireSignIn()) return;
    const orders = await api('/api/orders/mine');
    app.innerHTML = `
        <h1>My orders</h1>
        ${orders.length ? orders.map(o => orderPanel(o)).join('') : `
        <div class="panel"><p class="muted">You haven't ordered anything yet.</p>
            <a href="/" data-link class="btn">Start shopping</a></div>`}`;
    bindCancel(viewMyOrders);
}

function bankDetails(amount) {
    return `
        <div class="bank">
            ${shop.bank_qr_url ? `<img class="qr" src="${esc(shop.bank_qr_url)}" alt="Bank QR code">` : ''}
            <div>
                <p>Send <strong>${money(amount)}</strong> to:</p>
                ${shop.bank_name ? `<p>🏦 ${esc(shop.bank_name)}</p>` : ''}
                ${shop.bank_account_name ? `<p>👤 ${esc(shop.bank_account_name)}</p>` : ''}
                ${shop.bank_account_number ? `<p>🔢 <strong>${esc(shop.bank_account_number)}</strong></p>` : ''}
                <p class="muted">Then upload a screenshot of the transfer below.</p>
            </div>
        </div>`;
}

async function viewOrder(id) {
    if (!requireSignIn()) return;
    const o = await api(`/api/orders/${id}`);
    const isAdminView = me.role === 'admin' && o.user_id !== me.id;
    const needsPayment = o.payment_method === 'bank' && o.status !== 'cancelled' && o.payment_status !== 'paid';
    app.innerHTML = `
        <a href="${isAdminView ? '/admin/orders' : '/orders'}" data-link class="back">← ${isAdminView ? 'All orders' : 'My orders'}</a>
        <div class="toolbar">
            <h1>Order #${o.id}</h1>
            <div class="row">${statusBadge(o.status)} ${paymentBadge(o)}</div>
        </div>
        ${needsPayment && !isAdminView ? `
        <div class="panel pay-box">
            <h2>${o.payment_status === 'submitted' ? '🧾 We are checking your payment' : '🏦 Pay by bank transfer'}</h2>
            ${o.payment_status === 'submitted'
                ? '<p class="muted">Thanks! We\'ll confirm it soon. You can send another screenshot if needed.</p>' : ''}
            ${bankDetails(o.total)}
            <form id="proof" class="row">
                <input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required>
                <button class="btn">Upload screenshot</button>
            </form>
        </div>` : ''}
        <div class="two-col">
            <div>${orderPanel(o)}</div>
            <div class="panel">
                <h2>Tracking</h2>
                ${timeline(o)}
            </div>
        </div>`;
    // Admins use the Admin → Orders controls; here they only read.
    if (isAdminView) $$('[data-cancel]').forEach(b => b.remove());
    bindCancel(() => viewOrder(id));

    $('#proof')?.addEventListener('submit', async e => {
        e.preventDefault();
        const button = e.target.querySelector('button');
        button.disabled = true;
        try {
            await uploadFile(`/api/orders/${id}/payment`, e.target.file.files[0]);
            toast('Screenshot sent. Thank you!');
            viewOrder(id);
        } catch (err) {
            toast(err.message, true);
            button.disabled = false;
        }
    });
}

async function viewInvoice(id) {
    if (!requireSignIn()) return;
    const o = await api(`/api/orders/${id}`);
    document.title = `Invoice #${o.id} · ${shop.shop_name || 'WebShop'}`;
    app.innerHTML = `
        <div class="row no-print">
            <a href="/orders/${o.id}" data-link class="back">← Order #${o.id}</a>
            <span class="spacer"></span>
            <button id="print" class="btn">🖨 Print / Save as PDF</button>
        </div>
        <div class="panel invoice">
            <div class="invoice-head">
                <div>
                    <h1>Invoice</h1>
                    <p>No. <strong>INV-${String(o.id).padStart(5, '0')}</strong></p>
                    <p class="muted">Date: ${esc(day(o.created_at))}</p>
                </div>
                <div class="shop-info">
                    <strong>${esc(shop.shop_name || 'WebShop')}</strong>
                    ${shop.shop_address ? `<br>${esc(shop.shop_address)}` : ''}
                    ${shop.shop_phone ? `<br>📞 ${esc(shop.shop_phone)}` : ''}
                </div>
            </div>
            <div class="two-col">
                <div>
                    <h2>Bill to</h2>
                    <p>${esc(o.customer)}<br>${esc(o.email)}${o.phone ? `<br>${esc(o.phone)}` : ''}
                        ${o.address ? `<br>${esc(o.address)}` : ''}</p>
                </div>
                <div>
                    <h2>Payment</h2>
                    <p>${PAY_METHOD[o.payment_method]}<br>Status: <strong>${PAY_STATUS[o.payment_status]}</strong>
                        <br>Order: ${esc(o.status)}</p>
                </div>
            </div>
            <table>
                <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead>
                <tbody>${o.items.map(i => `
                    <tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.price * i.qty)}</td></tr>`).join('')}
                </tbody>
            </table>
            ${charges(o)}
            <p class="muted thanks">Thank you for your order!</p>
        </div>`;
    $('#print').addEventListener('click', () => window.print());
}

// ---------- Sign in, sign up, password reset, account ----------

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
            <p class="muted"><a href="/forgot" data-link>Forgot your password?</a></p>
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

function viewForgot() {
    app.innerHTML = `
        <form id="forgot" class="panel form auth">
            <h1>Forgot password</h1>
            <p class="muted">Enter your account email. We'll send you a link to choose a new password.</p>
            <label>Email <input name="email" type="email" autocomplete="email" required autofocus></label>
            <button class="btn">Send reset link</button>
            <p class="muted"><a href="/signin" data-link>Back to sign in</a></p>
        </form>`;
    $('#forgot').addEventListener('submit', async e => {
        e.preventDefault();
        e.target.querySelector('button').disabled = true;
        try {
            const res = await api('/api/auth/forgot', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
            e.target.innerHTML = `
                <h1>Check your messages</h1>
                <p>If an account exists for that email, we've sent a reset link
                   ${res.email ? 'by email (and to Telegram if you connected it)' : 'to the Telegram account connected to it'}.
                   The link works for 1 hour.</p>
                ${res.email ? '' : '<p class="muted">Email isn\'t set up for this shop yet. If you never connected Telegram, contact us to reset your password.</p>'}
                <p><a href="/signin" data-link>Back to sign in</a></p>`;
        } catch (err) {
            toast(err.message, true);
            e.target.querySelector('button').disabled = false;
        }
    });
}

function viewReset() {
    const token = new URLSearchParams(location.search).get('token') || '';
    app.innerHTML = `
        <form id="reset" class="panel form auth">
            <h1>Choose a new password</h1>
            <label>New password <input name="password" type="password" autocomplete="new-password" minlength="8" required autofocus>
                <span class="muted hint">At least 8 characters</span></label>
            <label>Repeat it <input name="again" type="password" autocomplete="new-password" minlength="8" required></label>
            <button class="btn">Save password</button>
        </form>`;
    $('#reset').addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.target;
        if (form.password.value !== form.again.value) return toast("The passwords don't match", true);
        try {
            await api('/api/auth/reset', { method: 'POST', body: { token, password: form.password.value } });
            await loadMe();
            toast('Password changed. You are signed in.');
            navigate('/');
        } catch (err) { toast(err.message, true); }
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
        <div class="panel">
            <h2>Telegram updates</h2>
            ${me.telegram ? `
            <p>✅ Connected. You get a Telegram message when your orders change.</p>
            <button id="tg-off" class="btn secondary">Disconnect</button>` : `
            <p class="muted">Get a Telegram message when your order ships, is delivered or your payment is confirmed.</p>
            <div class="row">
                <button id="tg-on" class="btn">Connect Telegram</button>
                <button id="tg-check" class="btn secondary" hidden>I pressed Start — check</button>
            </div>`}
        </div>
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
    $('#tg-on')?.addEventListener('click', async () => {
        try {
            const { url } = await api('/api/auth/telegram', { method: 'POST' });
            window.open(url, '_blank', 'noopener');
            $('#tg-check').hidden = false;
            toast('In Telegram, press Start');
        } catch (err) { toast(err.message, true); }
    });
    $('#tg-check')?.addEventListener('click', async () => {
        await loadMe();
        if (me.telegram) { toast('Telegram connected'); viewAccount(); }
        else toast('Not connected yet. Press Start in Telegram first.', true);
    });
    $('#tg-off')?.addEventListener('click', async () => {
        try {
            me = await api('/api/auth/telegram', { method: 'DELETE' });
            toast('Telegram disconnected');
            viewAccount();
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
    $('#signout').addEventListener('click', signOut);
}

// ---------- Admin ----------

const ADMIN_TABS = [
    ['', 'Dashboard', adminDashboard],
    ['orders', 'Orders', adminOrders],
    ['products', 'Products', adminProducts],
    ['categories', 'Categories', adminCategories],
    ['coupons', 'Coupons', adminCoupons],
    ['customers', 'Customers', adminCustomers],
    ['reports', 'Reports', adminReports],
    ['settings', 'Settings', adminSettings],
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
        <div id="admin-body">${skeleton('list')}</div>`;
    await current[2]();
}

const adminBody = () => $('#admin-body');

// Page buttons: "‹ 1 2 3 ›" for `pages` pages; calls go(page) on click.
function pager(box, page, pages, go) {
    box.innerHTML = pages > 1 ? `
        <button class="btn small secondary" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
        <span class="muted">Page ${page} of ${pages}</span>
        <button class="btn small secondary" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next ›</button>` : '';
    box.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => go(Number(b.dataset.page))));
}

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
        ${s.totals.payments_to_check ? `
        <a href="/admin/orders?payment=submitted" data-link class="panel alert">
            🧾 ${s.totals.payments_to_check} bank payment${s.totals.payments_to_check > 1 ? 's' : ''} to check →</a>` : ''}
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
                <p class="muted hint">Threshold and Telegram alert: <a href="/admin/settings" data-link>Settings</a></p>
            </div>
        </div>`;
}

async function adminOrders() {
    const params = new URLSearchParams(location.search);
    const opt = (value, label, current) => `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`;
    adminBody().innerHTML = `
        <form id="order-filters" class="panel filters">
            <input name="q" type="search" placeholder="Search name, email, phone, coupon or #id…" value="${esc(params.get('q'))}">
            <select name="status">
                ${opt('', 'All statuses', params.get('status') || '')}
                ${window.ORDER_STATUSES.map(s => opt(s, s, params.get('status'))).join('')}
            </select>
            <select name="payment">
                ${opt('', 'Any payment', params.get('payment') || '')}
                ${opt('unpaid', 'Unpaid', params.get('payment'))}
                ${opt('submitted', 'To check', params.get('payment'))}
                ${opt('paid', 'Paid', params.get('payment'))}
            </select>
            <label>From <input name="from" type="date" value="${esc(params.get('from'))}"></label>
            <label>To <input name="to" type="date" value="${esc(params.get('to'))}"></label>
            <a id="export" class="btn small secondary" download>⬇ Export CSV</a>
        </form>
        <p id="order-count" class="muted"></p>
        <div id="order-list"></div>
        <div id="pager" class="pager"></div>`;

    const form = $('#order-filters');
    let page = Number(params.get('page')) || 1;
    let orders = [];
    const filters = () => {
        const f = new URLSearchParams();
        for (const [k, v] of new FormData(form)) if (v) f.set(k, v);
        return f;
    };

    const load = async () => {
        const f = filters();
        $('#export').href = `/api/admin/orders.csv?${f}`;
        if (page > 1) f.set('page', page);
        history.replaceState(null, '', `/admin/orders${f.toString() ? '?' + f : ''}`);
        const data = await api(`/api/orders?${f}`);
        orders = data.orders;
        $('#order-count').textContent = `${data.total} order${data.total === 1 ? '' : 's'}`;
        $('#order-list').innerHTML = orders.length ? orders.map(o => orderPanel(o, true)).join('')
            : '<div class="panel"><p class="muted">No orders match.</p></div>';
        pager($('#pager'), data.page, data.pages, p => { page = p; load(); window.scrollTo(0, 0); });
        bind();
    };

    const bind = () => {
        $$('[data-status]').forEach(select =>
            select.addEventListener('change', async () => {
                const id = Number(select.dataset.status);
                if (select.value === 'cancelled' &&
                    !confirm(`Cancel order #${id}? Its items go back in stock, and it can't be reopened.`)) {
                    select.value = orders.find(o => o.id === id).status;
                    return;
                }
                try {
                    await api(`/api/orders/${id}`, { method: 'PUT', body: { status: select.value } });
                    toast('Order status updated');
                    load();
                } catch (err) { toast(err.message, true); }
            }));
        $$('[data-paid]').forEach(btn =>
            btn.addEventListener('click', async () => {
                try {
                    await api(`/api/orders/${btn.dataset.paid}/payment`, {
                        method: 'PUT', body: { payment_status: btn.dataset.value } });
                    toast(btn.dataset.value === 'paid' ? 'Marked as paid' : 'Marked as unpaid');
                    load();
                } catch (err) { toast(err.message, true); }
            }));
        $$('[data-delete]').forEach(btn =>
            btn.addEventListener('click', async () => {
                if (!confirm(`Delete order #${btn.dataset.delete}? This can't be undone.`)) return;
                try {
                    await api(`/api/orders/${btn.dataset.delete}`, { method: 'DELETE' });
                    toast('Order deleted');
                    load();
                } catch (err) { toast(err.message, true); }
            }));
    };

    const reload = () => { page = 1; load().catch(err => toast(err.message, true)); };
    let typing;
    form.q.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(reload, 300); });
    form.addEventListener('change', e => { if (e.target.name !== 'q') reload(); });
    form.addEventListener('submit', e => { e.preventDefault(); reload(); });
    await load();
}

function variantRow(v = {}) {
    return `
        <div class="variant-row" data-id="${v.id || ''}">
            <input class="v-name" placeholder="Name, e.g. Red / L" value="${esc(v.name)}" required>
            <input class="v-price" type="number" step="0.01" min="0" placeholder="Price (optional)" value="${v.price ?? ''}">
            <input class="v-stock" type="number" step="1" min="0" placeholder="Stock" value="${v.stock ?? 0}" required>
            <button type="button" class="btn small danger" data-remove-variant title="Remove option">×</button>
        </div>`;
}

const PRODUCTS_PER_PAGE = 15;

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
                <label>"Was" price (for a sale) <input name="compare_at_price" type="number" step="0.01" min="0" placeholder="optional"></label>
                <label>Stock <input name="stock" type="number" step="1" min="0" required>
                    <span id="stock-hint" class="muted hint" hidden>Total of the options below</span></label>
                <label>Image URL <input name="image_url" placeholder="optional, or upload →"></label>
                <label>Main image
                    <input id="image-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
                </label>
            </div>
            <img id="image-preview" class="thumb preview" alt="Product image preview" hidden>
            <label>Description <textarea name="description" rows="3"></textarea></label>
            <label class="inline"><input type="checkbox" name="featured"> ⭐ Featured on the shop page</label>

            <div class="sub">
                <strong>More photos</strong>
                <div id="gallery" class="gallery-edit"></div>
                <label class="inline">Add photos
                    <input id="gallery-files" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif"></label>
            </div>

            <div class="sub">
                <strong>Options</strong> <span class="muted">(size, color… each with its own stock and optional price)</span>
                <div id="variants"></div>
                <button type="button" id="add-variant" class="btn small secondary">+ Add option</button>
            </div>

            <div class="row">
                <button class="btn" id="save-product">Save</button>
                <button type="button" id="cancel-edit" class="btn secondary" hidden>Cancel</button>
            </div>
        </form>

        <div class="panel">
            <div class="toolbar">
                <h2>${products.length} products</h2>
                <input id="product-search" type="search" placeholder="Search products…">
            </div>
            <table>
                <thead><tr><th></th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Rating</th><th></th></tr></thead>
                <tbody id="product-rows"></tbody>
            </table>
            <div id="product-pager" class="pager"></div>
        </div>`;

    const form = $('#product-form');
    const preview = $('#image-preview');
    let gallery = [];
    const showPreview = () => {
        preview.hidden = !form.image_url.value;
        if (form.image_url.value) preview.src = form.image_url.value;
    };
    form.image_url.addEventListener('change', showPreview);

    const drawGallery = () => {
        $('#gallery').innerHTML = gallery.length ? gallery.map((src, i) => `
            <div class="gallery-item"><img src="${esc(src)}" alt="Photo ${i + 1}">
                <button type="button" class="btn small danger" data-remove-photo="${i}" title="Remove photo">×</button></div>`).join('')
            : '<p class="muted">No extra photos.</p>';
    };
    const syncStock = () => {
        const has = $$('.variant-row').length > 0;
        form.stock.readOnly = has;
        $('#stock-hint').hidden = !has;
        if (has) form.stock.value = [...$$('.v-stock')].reduce((sum, i) => sum + (parseInt(i.value) || 0), 0);
    };
    const setVariants = list => {
        $('#variants').innerHTML = list.map(variantRow).join('');
        syncStock();
    };

    const withSaveDisabled = async (fn) => {
        const save = $('#save-product');
        save.disabled = true;
        try { await fn(); } catch (err) { toast(err.message, true); } finally { save.disabled = false; }
    };
    $('#image-file').addEventListener('change', e => withSaveDisabled(async () => {
        const file = e.target.files[0];
        if (!file) return;
        form.image_url.value = (await uploadFile('/api/images', file)).url;
        showPreview();
        e.target.value = '';
        toast('Image uploaded. Click Save to keep it.');
    }));
    $('#gallery-files').addEventListener('change', e => withSaveDisabled(async () => {
        for (const file of e.target.files) {
            gallery.push((await uploadFile('/api/images', file)).url);
            drawGallery();
        }
        e.target.value = '';
        toast('Photos uploaded. Click Save to keep them.');
    }));
    form.addEventListener('click', e => {
        const photo = e.target.closest('[data-remove-photo]');
        if (photo) { gallery.splice(Number(photo.dataset.removePhoto), 1); drawGallery(); }
        const variant = e.target.closest('[data-remove-variant]');
        if (variant) { variant.parentElement.remove(); syncStock(); }
    });
    form.addEventListener('input', e => { if (e.target.classList.contains('v-stock')) syncStock(); });
    $('#add-variant').addEventListener('click', () => {
        $('#variants').insertAdjacentHTML('beforeend', variantRow());
        syncStock();
        $$('.v-name')[$$('.v-name').length - 1].focus();
    });

    const resetForm = () => {
        form.reset();
        form.id.value = '';
        gallery = [];
        drawGallery();
        setVariants([]);
        showPreview();
        $('#form-title').textContent = 'Add product';
        $('#cancel-edit').hidden = true;
    };
    resetForm();

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        const id = data.id;
        delete data.id;
        data.featured = form.featured.checked;
        data.images = gallery;
        data.variants = [...$$('.variant-row')].map(row => ({
            id: row.dataset.id || null,
            name: row.querySelector('.v-name').value,
            price: row.querySelector('.v-price').value,
            stock: row.querySelector('.v-stock').value,
        }));
        try {
            await api(id ? `/api/products/${id}` : '/api/products', { method: id ? 'PUT' : 'POST', body: data });
            toast(id ? 'Product updated' : 'Product added');
            adminProducts();
        } catch (err) { toast(err.message, true); }
    });
    $('#cancel-edit').addEventListener('click', resetForm);

    let page = 1;
    const drawRows = () => {
        const q = $('#product-search').value.trim().toLowerCase();
        const list = products.filter(p => !q || `${p.name} ${p.category || ''}`.toLowerCase().includes(q));
        const pages = Math.max(1, Math.ceil(list.length / PRODUCTS_PER_PAGE));
        page = Math.min(page, pages);
        $('#product-rows').innerHTML = list.slice((page - 1) * PRODUCTS_PER_PAGE, page * PRODUCTS_PER_PAGE).map(p => `
            <tr>
                <td>${thumb(p, 'thumb tiny')}</td>
                <td><a href="/product/${p.id}" data-link>${esc(p.name)}</a>
                    ${p.featured ? ' ⭐' : ''}${onSale(p) ? ' <span class="sale-tag">sale</span>' : ''}
                    ${p.variants.length ? `<div class="muted hint">${p.variants.length} options</div>` : ''}</td>
                <td>${esc(p.category || '—')}</td>
                <td>${priceRange(p)}</td>
                <td class="${p.stock ? '' : 'warn'}">${p.stock}</td>
                <td>${p.review_count ? `${p.rating} ★ (${p.review_count})` : '—'}</td>
                <td class="actions">
                    <button class="btn small secondary" data-edit="${p.id}">Edit</button>
                    <button class="btn small danger" data-delete="${p.id}">Delete</button>
                </td>
            </tr>`).join('') || '<tr><td colspan="7" class="muted">No products match.</td></tr>';
        pager($('#product-pager'), page, pages, p => { page = p; drawRows(); });
    };
    drawRows();
    $('#product-search').addEventListener('input', () => { page = 1; drawRows(); });

    $('#product-rows').addEventListener('click', async e => {
        const edit = e.target.closest('[data-edit]');
        const del = e.target.closest('[data-delete]');
        if (edit) {
            const p = products.find(x => x.id == edit.dataset.edit);
            for (const key of ['id', 'name', 'price', 'stock', 'image_url', 'description']) form[key].value = p[key];
            form.compare_at_price.value = p.compare_at_price ?? '';
            form.category_id.value = p.category_id ?? '';
            form.featured.checked = p.featured;
            gallery = [...(p.images || [])];
            drawGallery();
            setVariants(p.variants);
            showPreview();
            $('#form-title').textContent = `Edit product #${p.id}`;
            $('#cancel-edit').hidden = false;
            form.scrollIntoView({ behavior: 'smooth' });
        }
        if (del) {
            if (!confirm('Delete this product?')) return;
            try {
                await api(`/api/products/${del.dataset.delete}`, { method: 'DELETE' });
                cart.set(del.dataset.delete, 0);
                toast('Product deleted');
                adminProducts();
            } catch (err) { toast(err.message, true); }
        }
    });
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

const couponValue = c => (c.kind === 'percent' ? `${Number(c.value)}%` : money(c.value));

async function adminCoupons() {
    const coupons = await api('/api/coupons');
    const today = new Date().toISOString().slice(0, 10);
    adminBody().innerHTML = `
        <form id="coupon-form" class="panel form">
            <h2 id="coupon-title">New coupon</h2>
            <input type="hidden" name="id">
            <div class="form-grid">
                <label>Code <input name="code" required placeholder="e.g. WELCOME10" autocomplete="off"></label>
                <label>Type
                    <select name="kind">
                        <option value="percent">% off</option>
                        <option value="fixed">$ off</option>
                    </select>
                </label>
                <label>Value <input name="value" type="number" step="0.01" min="0.01" required></label>
                <label>Minimum spend <input name="min_subtotal" type="number" step="0.01" min="0" placeholder="0"></label>
                <label>Usage limit <input name="max_uses" type="number" step="1" min="1" placeholder="unlimited"></label>
                <label>Last valid day <input name="expires_on" type="date"></label>
            </div>
            <label class="inline"><input type="checkbox" name="active" checked> Active</label>
            <div class="row">
                <button class="btn">Save coupon</button>
                <button type="button" id="cancel-coupon" class="btn secondary" hidden>Cancel</button>
            </div>
        </form>
        <div class="panel">
            ${coupons.length ? `<table>
                <thead><tr><th>Code</th><th>Discount</th><th>Min spend</th><th>Used</th><th>Expires</th><th>Status</th><th></th></tr></thead>
                <tbody>${coupons.map(c => {
                    const expired = c.expires_on && c.expires_on < today;
                    const usedUp = c.max_uses && c.used_count >= c.max_uses;
                    const state = !c.active ? 'off' : expired ? 'expired' : usedUp ? 'used up' : 'active';
                    return `
                    <tr>
                        <td><strong>${esc(c.code)}</strong></td>
                        <td>${couponValue(c)}</td>
                        <td>${c.min_subtotal ? money(c.min_subtotal) : '—'}</td>
                        <td>${c.used_count}${c.max_uses ? ` / ${c.max_uses}` : ''}</td>
                        <td>${c.expires_on ? esc(c.expires_on) : '—'}</td>
                        <td><span class="coupon-state ${state.replace(' ', '-')}">${state}</span></td>
                        <td class="actions">
                            <button class="btn small secondary" data-edit="${c.id}">Edit</button>
                            <button class="btn small danger" data-delete="${c.id}">Delete</button>
                        </td>
                    </tr>`;
                }).join('')}
                </tbody></table>` : '<p class="muted">No coupons yet.</p>'}
        </div>`;

    const form = $('#coupon-form');
    const reset = () => {
        form.reset();
        form.id.value = '';
        $('#coupon-title').textContent = 'New coupon';
        $('#cancel-coupon').hidden = true;
    };
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        const id = data.id;
        delete data.id;
        data.active = form.active.checked;
        try {
            await api(id ? `/api/coupons/${id}` : '/api/coupons', { method: id ? 'PUT' : 'POST', body: data });
            toast(id ? 'Coupon updated' : 'Coupon created');
            adminCoupons();
        } catch (err) { toast(err.message, true); }
    });
    $('#cancel-coupon').addEventListener('click', reset);
    $$('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
        const c = coupons.find(x => x.id == btn.dataset.edit);
        for (const key of ['id', 'code', 'kind', 'value']) form[key].value = c[key];
        form.min_subtotal.value = c.min_subtotal || '';
        form.max_uses.value = c.max_uses ?? '';
        form.expires_on.value = c.expires_on ?? '';
        form.active.checked = c.active;
        $('#coupon-title').textContent = `Edit coupon ${c.code}`;
        $('#cancel-coupon').hidden = false;
        form.scrollIntoView({ behavior: 'smooth' });
    }));
    $$('[data-delete]').forEach(btn => btn.addEventListener('click', async () => {
        if (!confirm('Delete this coupon? Past orders keep their discount.')) return;
        try {
            await api(`/api/coupons/${btn.dataset.delete}`, { method: 'DELETE' });
            toast('Coupon deleted');
            adminCoupons();
        } catch (err) { toast(err.message, true); }
    }));
}

async function adminCustomers() {
    const users = await api('/api/admin/users');
    adminBody().innerHTML = `
        <div class="panel">
            <table>
                <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Telegram</th><th>Joined</th><th>Orders</th><th>Spent</th><th>Role</th></tr></thead>
                <tbody>${users.map(u => `
                    <tr>
                        <td>${esc(u.name)}</td>
                        <td>${esc(u.email)}</td>
                        <td>${esc(u.phone) || '—'}</td>
                        <td>${u.telegram ? '✅' : '—'}</td>
                        <td>${esc(day(u.created_at))}</td>
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

// ---------- Admin: reports ----------

const compactMoney = n => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`);

function niceMax(v) {
    const p = 10 ** Math.floor(Math.log10(v));
    const m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

// Over ~3 months, one bar per week reads better than one per day.
function groupWeeks(daily) {
    if (daily.length <= 92) return daily.map(d => ({ ...d, label: d.day }));
    const weeks = [];
    for (let i = 0; i < daily.length; i += 7) {
        const chunk = daily.slice(i, i + 7);
        weeks.push({
            day: chunk[0].day, label: `${chunk[0].day} – ${chunk[chunk.length - 1].day}`,
            revenue: chunk.reduce((s, d) => s + d.revenue, 0), orders: chunk.reduce((s, d) => s + d.orders, 0),
        });
    }
    return weeks;
}

// Single-series bar chart of revenue (one hue, no legend; hover a bar for its numbers).
function revenueChart(daily) {
    const bars = groupWeeks(daily);
    const W = 760, H = 240, L = 48, R = 8, T = 12, B = 28;
    const iw = W - L - R, ih = H - T - B;
    const top = niceMax(Math.max(1, ...bars.map(b => b.revenue)));
    const step = iw / bars.length;
    const bw = Math.max(1, step - 2);  // 2px gap between bars
    const y = v => T + ih - (v / top) * ih;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => top * f);
    const labelEvery = Math.ceil(bars.length / 6);
    const shortDay = s => new Date(s + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    const bar = (b, i) => {
        const x = L + i * step + 1, h = ih - (y(b.revenue) - T);
        if (h <= 0) return '';
        // 4px rounded top, square at the baseline
        const r = Math.min(4, bw / 2, h), yb = y(b.revenue), base = T + ih;
        return `<path class="bar" data-i="${i}" d="M${x},${base} V${yb + r} Q${x},${yb} ${x + r},${yb}
            H${x + bw - r} Q${x + bw},${yb} ${x + bw},${yb + r} V${base} Z"/>`;
    };
    return `
        <div class="chart-wrap">
            <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Revenue per ${daily.length <= 92 ? 'day' : 'week'}">
                ${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>
                    <text class="axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${compactMoney(t)}</text>`).join('')}
                ${bars.map(bar).join('')}
                ${bars.map((b, i) => i % labelEvery ? '' : `<text class="axis" x="${L + i * step + step / 2}" y="${H - 8}"
                    text-anchor="middle">${shortDay(b.day)}</text>`).join('')}
                ${bars.map((b, i) => `<rect class="hit" data-i="${i}" x="${L + i * step}" y="${T}" width="${step}" height="${ih}"/>`).join('')}
            </svg>
            <div class="chart-tip" hidden></div>
        </div>
        <details class="table-view"><summary>Show as table</summary>
            <table><thead><tr><th>Date</th><th>Orders</th><th>Revenue</th></tr></thead>
            <tbody>${bars.map(b => `<tr><td>${esc(b.label)}</td><td>${b.orders}</td><td>${money(b.revenue)}</td></tr>`).join('')}</tbody></table>
        </details>`;
}

function bindChart(box, daily) {
    const bars = groupWeeks(daily);
    const tip = box.querySelector('.chart-tip');
    const svg = box.querySelector('svg');
    svg.addEventListener('pointermove', e => {
        const hit = e.target.closest('.hit');
        if (!hit) return;
        const i = Number(hit.dataset.i), b = bars[i];
        svg.querySelectorAll('.bar').forEach(el => el.classList.toggle('on', el.dataset.i == i));
        tip.innerHTML = `<strong>${esc(b.label)}</strong><br>${money(b.revenue)} · ${b.orders} order${b.orders === 1 ? '' : 's'}`;
        tip.hidden = false;
        const rect = box.getBoundingClientRect();
        const x = Math.min(e.clientX - rect.left + 12, rect.width - tip.offsetWidth - 4);
        tip.style.left = `${Math.max(4, x)}px`;
        tip.style.top = `${e.clientY - rect.top - tip.offsetHeight - 10}px`;
    });
    svg.addEventListener('pointerleave', () => {
        tip.hidden = true;
        svg.querySelectorAll('.bar').forEach(el => el.classList.remove('on'));
    });
}

async function adminReports() {
    const days = Number(new URLSearchParams(location.search).get('days')) || 30;
    const r = await api(`/api/admin/reports?days=${days}`);
    const maxCategory = Math.max(1, ...r.categories.map(c => c.sales));
    const tiles = [
        ['Revenue', money(r.summary.revenue)],
        ['Orders', r.summary.orders],
        ['Average order', money(r.summary.average)],
        ['Discounts given', money(r.summary.discounts)],
        ['Shipping charged', money(r.summary.shipping)],
        ['Tax collected', money(r.summary.tax)],
    ];
    adminBody().innerHTML = `
        <div class="toolbar">
            <div class="row">${[7, 30, 90, 365].map(d =>
                `<a href="/admin/reports?days=${d}" data-link class="btn small ${d === r.days ? '' : 'secondary'}">${d === 365 ? '1 year' : `${d} days`}</a>`).join('')}
            </div>
            <a href="/api/admin/orders.csv" class="btn small secondary" download>⬇ All orders (CSV)</a>
        </div>
        <div class="stats">${tiles.map(([label, value]) =>
            `<div class="stat"><div class="muted">${label}</div><div class="stat-value">${value}</div></div>`).join('')}
        </div>
        <div class="panel" id="chart-panel">
            <h2>Revenue, last ${r.days === 365 ? 'year' : `${r.days} days`}</h2>
            ${revenueChart(r.daily)}
            <p class="muted hint">Cancelled orders are not counted.</p>
        </div>
        <div class="two-col">
            <div class="panel">
                <h2>Top products</h2>
                ${r.products.length ? `<table><thead><tr><th>Product</th><th>Sold</th><th>Sales</th></tr></thead><tbody>
                    ${r.products.map(p => `<tr><td>${esc(p.name)}</td><td>${p.qty}</td><td>${money(p.sales)}</td></tr>`).join('')}
                </tbody></table>` : '<p class="muted">No sales in this period.</p>'}
            </div>
            <div class="panel">
                <h2>Sales by category</h2>
                ${r.categories.length ? r.categories.map(c => `
                    <div class="hbar-row"><span>${esc(c.name)}</span><span>${money(c.sales)}</span></div>
                    <div class="hbar"><div style="width:${(c.sales / maxCategory) * 100}%"></div></div>`).join('')
                    : '<p class="muted">No sales in this period.</p>'}
                <h2>Payment methods</h2>
                ${r.payments.length ? `<table><tbody>${r.payments.map(p =>
                    `<tr><td>${PAY_METHOD[p.method] || esc(p.method)}</td><td>${p.orders} orders</td><td>${money(p.revenue)}</td></tr>`).join('')}
                </tbody></table>` : '<p class="muted">No orders in this period.</p>'}
            </div>
        </div>`;
    bindChart($('#chart-panel'), r.daily);
}

// ---------- Admin: shop settings ----------

async function adminSettings() {
    const s = await api('/api/settings');
    adminBody().innerHTML = `
        <form id="settings-form" class="panel form">
            <h2>Shop details <span class="muted hint">(shown on invoices)</span></h2>
            <div class="form-grid">
                <label>Shop name <input name="shop_name" required value="${esc(s.shop_name)}"></label>
                <label>Phone <input name="shop_phone" value="${esc(s.shop_phone)}"></label>
            </div>
            <label>Address <textarea name="shop_address" rows="2">${esc(s.shop_address)}</textarea></label>

            <h2>Shipping & tax</h2>
            <div class="form-grid">
                <label>Shipping fee ($) <input name="shipping_fee" type="number" step="0.01" min="0" value="${s.shipping_fee}"></label>
                <label>Free shipping from ($) <input name="free_shipping_over" type="number" step="0.01" min="0" value="${s.free_shipping_over}">
                    <span class="muted hint">0 = never free</span></label>
                <label>Tax (%) <input name="tax_rate" type="number" step="0.01" min="0" max="100" value="${s.tax_rate}"></label>
                <label>Low stock alert at <input name="low_stock_threshold" type="number" step="1" min="0" value="${s.low_stock_threshold}">
                    <span class="muted hint">Telegram alert when an order brings stock down to this</span></label>
            </div>

            <h2>Bank transfer / KHQR</h2>
            <label class="inline"><input type="checkbox" name="bank_enabled" ${s.bank_enabled ? 'checked' : ''}>
                Let customers pay by bank transfer</label>
            <div class="form-grid">
                <label>Bank <input name="bank_name" placeholder="e.g. ABA Bank" value="${esc(s.bank_name)}"></label>
                <label>Account name <input name="bank_account_name" value="${esc(s.bank_account_name)}"></label>
                <label>Account number <input name="bank_account_number" value="${esc(s.bank_account_number)}"></label>
                <label>QR code image <input id="qr-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
            </div>
            <input type="hidden" name="bank_qr_url" value="${esc(s.bank_qr_url)}">
            <div class="row">
                <img id="qr-preview" class="qr" alt="Bank QR code" ${s.bank_qr_url ? `src="${esc(s.bank_qr_url)}"` : 'hidden'}>
                <button type="button" id="qr-remove" class="btn small secondary" ${s.bank_qr_url ? '' : 'hidden'}>Remove QR</button>
            </div>
            <p class="muted">Customers see these details after ordering, then upload a screenshot of their transfer.
                You confirm it on Admin → Orders or with the Telegram button.</p>
            <button class="btn">Save settings</button>
        </form>`;

    const form = $('#settings-form');
    const setQr = url => {
        form.bank_qr_url.value = url;
        $('#qr-preview').hidden = !url;
        $('#qr-remove').hidden = !url;
        if (url) $('#qr-preview').src = url;
    };
    $('#qr-file').addEventListener('change', async e => {
        try {
            setQr((await uploadFile('/api/images', e.target.files[0])).url);
            toast('QR uploaded. Click Save to keep it.');
        } catch (err) { toast(err.message, true); }
        e.target.value = '';
    });
    $('#qr-remove').addEventListener('click', () => setQr(''));
    form.addEventListener('submit', async e => {
        e.preventDefault();
        try {
            shop = await api('/api/settings', {
                method: 'PUT', body: { ...Object.fromEntries(new FormData(form)), bank_enabled: form.bank_enabled.checked },
            });
            toast('Settings saved');
        } catch (err) { toast(err.message, true); }
    });
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

// Grey placeholder shapes shown while a page's data loads.
function skeleton(kind) {
    const lines = (...widths) => widths.map(w => `<div class="sk sk-line" style="width:${w}%"></div>`).join('');
    const card = `<div class="card"><div class="sk sk-media"></div>
        <div class="card-body">${lines(40, 80, 30)}<div class="sk sk-btn"></div></div></div>`;
    const block = `<div class="panel">${lines(35, 90, 70, 50)}</div>`;
    const html = {
        grid: `<div class="sk sk-title"></div><div class="grid">${card.repeat(8)}</div>`,
        detail: `<div class="panel detail"><div class="sk sk-media large"></div>
            <div>${lines(20)}<div class="sk sk-title"></div>${lines(25, 95, 90, 60)}<div class="sk sk-btn"></div></div></div>`,
        list: `<div class="sk sk-title"></div>${block.repeat(3)}`,
    }[kind];
    return `<div class="skeleton" aria-busy="true" aria-label="Loading">${html}</div>`;
}

// [path pattern, view, page title, skeleton shown while it loads]
const routes = [
    [/^\/$/, viewShop, 'Shop', 'grid'],
    [/^\/product\/(\d+)$/, viewProduct, 'Product', 'detail'],
    [/^\/cart$/, viewCart, 'Cart', 'list'],
    [/^\/wishlist$/, viewWishlist, 'Wishlist', 'grid'],
    [/^\/orders$/, viewMyOrders, 'My orders', 'list'],
    [/^\/orders\/(\d+)$/, viewOrder, 'Order', 'list'],
    [/^\/orders\/(\d+)\/invoice$/, viewInvoice, 'Invoice', 'list'],
    [/^\/signin$/, viewSignIn, 'Sign in'],
    [/^\/signup$/, viewSignUp, 'Create account'],
    [/^\/forgot$/, viewForgot, 'Forgot password'],
    [/^\/reset$/, viewReset, 'Reset password'],
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
    const [re, view, title, loading] = route;
    document.title = `${title} · WebShop`;
    if (loading) app.innerHTML = skeleton(loading);
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
    // The navbar is outside #app, so its sign-out button is handled here.
    if (e.target.closest('[data-signout]')) {
        signOut();
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

document.addEventListener('mouseover', e => {
    const link = e.target.closest('a[data-link]');
    if (link) prefetch(link.getAttribute('href'));
});

// Start loading the catalog right away, alongside the sign-in check.
prefetch(location.pathname);
const firstRoute = routes.find(([re]) => re.test(location.pathname));
if (firstRoute?.[3]) app.innerHTML = skeleton(firstRoute[3]);
Promise.all([loadMe().catch(() => drawNav()), loadShop()]).finally(render);
