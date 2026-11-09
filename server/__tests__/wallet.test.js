import request from 'supertest';
import app from '../app.js';
import { pool } from '../db.js';
import { createTestUser, insertOrder, cleanup } from './helpers.js';
import { startFakePesa, deadPesaUrl } from './fakePesa.js';

// Needs the schema from schema.sql (users.pesa_user_id and orders.pesa_transaction_id).
// Pesa Tracker is replaced by a stand-in server (fakePesa.js); the real one is never contacted.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let server;
let baseUrl;
let fake;
let price11;    // price of item-11 (cafe-2), read from the DB so the tests follow the seed data

const ORDER_ONE = { cafeteria_id: 'cafe-2', items: [{ menu_item_id: 'item-11' }] };

const placeOrder = (user, body = ORDER_ONE) =>
    request(app).post('/api/orders').set('Authorization', `Bearer ${user.token}`).send(body);
const getWallet = (user) => request(app).get('/api/wallet').set('Authorization', `Bearer ${user.token}`);
const linkedUser = (label) => createTestUser(label, { pesaUserId: 'usr_test' });
const keysOf = (obj) => Object.keys(obj).sort();

// Opens GET /api/events the same way the website does (fetch + Authorization header) and
// collects every event. waitFor(type) resolves with the first event of that type.
async function openStream(user) {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/events`, {
        headers: { Authorization: `Bearer ${user.token}` },
        signal: controller.signal,
    });
    const events = [];
    const waiters = [];
    const notify = () => {
        for (const w of [...waiters]) {
            const hit = events.find(w.match);
            if (hit) { waiters.splice(waiters.indexOf(w), 1); w.resolve(hit); }
        }
    };
    (async () => {
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += value;
                let cut;
                while ((cut = buffer.indexOf('\n\n')) !== -1) {
                    const block = buffer.slice(0, cut);
                    buffer = buffer.slice(cut + 2);
                    const data = block.split('\n').find((l) => l.startsWith('data: '));
                    if (data) { events.push(JSON.parse(data.slice(6))); notify(); }
                }
            }
        } catch { /* aborted */ }
    })();
    const waitFor = (type, timeoutMs = 3000) =>
        new Promise((resolve, reject) => {
            const match = (e) => e.type === type;
            const existing = events.find(match);
            if (existing) return resolve(existing);
            const timer = setTimeout(() => reject(new Error(`no ${type} event within ${timeoutMs}ms; got ${events.map((e) => e.type)}`)), timeoutMs);
            waiters.push({ match, resolve: (e) => { clearTimeout(timer); resolve(e); } });
        });
    await waitFor('stream.ready');
    return { res, events, waitFor, close: () => controller.abort() };
}

beforeAll(async () => {
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    fake = await startFakePesa();
    const [[row]] = await pool.query("SELECT price FROM menu_items WHERE id = 'item-11'");
    price11 = row.price;
});

beforeEach(() => {
    fake.reset();
    process.env.PESA_TRACKER_URL = fake.url;
});

afterAll(async () => {
    delete process.env.PESA_TRACKER_URL;
    await fake.close();
    await new Promise((resolve) => server.close(resolve));
    await cleanup();
});

// ---------------------------------------------------------------------------
describe('GET /api/wallet', () => {
    it('401 without a login token', async () => {
        const res = await request(app).get('/api/wallet');
        expect(res.status).toBe(401);
    });

    it('shows the remaining budget read from Pesa Tracker, and only reads (never writes) there', async () => {
        const user = await linkedUser('wallet-ok');
        fake.state.remaining = 8500;

        const res = await getWallet(user);

        expect(res.status).toBe(200);
        expect(keysOf(res.body)).toEqual(['currency', 'remaining', 'status', 'transactions']);
        expect(res.body).toEqual({ status: 'ok', remaining: 8500, currency: 'KES', transactions: [] });
        expect(fake.state.requests.map((r) => `${r.method} ${r.url}`)).toEqual(['GET /v1/users/usr_test/budget']);
    });

    it('a user who is not linked to Pesa Tracker gets status not_linked, and Pesa Tracker is never contacted', async () => {
        const user = await createTestUser('wallet-unlinked');

        const res = await getWallet(user);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'not_linked', remaining: null, currency: 'KES', transactions: [] });
        expect(fake.state.requests).toHaveLength(0);
    });

    it('with the integration switched off (PESA_TRACKER_URL unset) a linked user also gets not_linked', async () => {
        const user = await linkedUser('wallet-off');
        delete process.env.PESA_TRACKER_URL;

        const res = await getWallet(user);

        expect(res.body.status).toBe('not_linked');
        expect(res.body.remaining).toBeNull();
    });

    it('status no_budget when Pesa Tracker has no budget for the linked user', async () => {
        const user = await linkedUser('wallet-nobudget');
        fake.state.mode = 'unknown-user';

        const res = await getWallet(user);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'no_budget', remaining: null });
    });

    it('status unavailable (not an error page) when Pesa Tracker has a server error', async () => {
        const user = await linkedUser('wallet-down');
        fake.state.mode = 'server-error';

        const res = await getWallet(user);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'unavailable', remaining: null });
    });

    it('status unavailable when Pesa Tracker cannot be reached at all, and past transactions still show', async () => {
        const user = await linkedUser('wallet-unreachable');
        await insertOrder(user.id, 'cafe-2', 'completed', { pesaTransactionId: 'txn_00000042' });
        process.env.PESA_TRACKER_URL = await deadPesaUrl();

        const res = await getWallet(user);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'unavailable', remaining: null });
        expect(res.body.transactions).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
describe('the wallet follows the user\'s orders', () => {
    it('after an order the remaining amount drops by exactly the order total and the order is listed as a transaction', async () => {
        const user = await linkedUser('wallet-flow');
        fake.state.remaining = 8500;

        const before = await getWallet(user);
        expect(before.body.remaining).toBe(8500);
        expect(before.body.transactions).toHaveLength(0);

        const order = await placeOrder(user);
        expect(order.status).toBe(201);

        const after = await getWallet(user);
        expect(after.body.status).toBe('ok');
        expect(after.body.remaining).toBe(8500 - price11);

        expect(after.body.transactions).toHaveLength(1);
        const [tx] = after.body.transactions;
        expect(keysOf(tx)).toEqual(['amount', 'created_at', 'description', 'id', 'items', 'status']);
        expect(tx.id).toBe(order.body.id);
        expect(tx.description).toMatch(new RegExp(`^Order #${order.body.id} at .+`));
        expect(tx.items).toEqual([order.body.items[0].item_name]);
        expect(tx.amount).toBe(price11);
        expect(tx.status).toBe('pending');
        expect(tx.created_at).toMatch(ISO_DATE);
    });

    it('an order with quantity 2 reads "name x2" and costs twice the price', async () => {
        const user = await linkedUser('wallet-qty');
        fake.state.remaining = 8500;

        const order = await placeOrder(user, { cafeteria_id: 'cafe-2', items: [{ menu_item_id: 'item-11', quantity: 2 }] });
        const res = await getWallet(user);

        expect(res.body.remaining).toBe(8500 - price11 * 2);
        expect(res.body.transactions[0].items).toEqual([`${order.body.items[0].item_name} x2`]);
        expect(res.body.transactions[0].amount).toBe(price11 * 2);
    });

    it('only purchases Pesa Tracker accepted are transactions (an order that was never recorded there is not)', async () => {
        const user = await linkedUser('wallet-recorded');
        const recorded = await insertOrder(user.id, 'cafe-1', 'completed', { pesaTransactionId: 'txn_00000007' });
        await insertOrder(user.id, 'cafe-1', 'completed'); // no pesa_transaction_id

        const res = await getWallet(user);

        expect(res.body.transactions.map((t) => t.id)).toEqual([recorded]);
    });

    it('transactions are newest first', async () => {
        const user = await linkedUser('wallet-order');
        const first = await insertOrder(user.id, 'cafe-1', 'completed', { pesaTransactionId: 'txn_00000011' });
        const second = await insertOrder(user.id, 'cafe-1', 'completed', { pesaTransactionId: 'txn_00000012' });
        const third = await insertOrder(user.id, 'cafe-2', 'completed', { pesaTransactionId: 'txn_00000013' });

        const res = await getWallet(user);

        expect(res.body.transactions.map((t) => t.id)).toEqual([third, second, first]);
    });

    it('you only ever see your own transactions', async () => {
        const alice = await linkedUser('wallet-alice');
        const bob = await linkedUser('wallet-bob');
        const bobsOrder = await insertOrder(bob.id, 'cafe-1', 'completed', { pesaTransactionId: 'txn_00000021' });

        const res = await getWallet(alice);

        expect(res.body.transactions).toEqual([]);
        expect(JSON.stringify(res.body)).not.toContain(`#${bobsOrder} `);
    });

    it('an order refused for being over budget is not a transaction and the remaining amount does not move', async () => {
        const user = await linkedUser('wallet-refused');
        fake.state.remaining = price11 - 1;

        const order = await placeOrder(user);
        const res = await getWallet(user);

        expect(order.status).toBe(422);
        expect(res.body.remaining).toBe(price11 - 1);
        expect(res.body.transactions).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
describe('no manual input: the wallet cannot be changed from our side', () => {
    it.each([
        ['POST', '/api/wallet/topup'],
        ['POST', '/api/wallet'],
        ['PUT', '/api/wallet'],
        ['PATCH', '/api/wallet'],
        ['DELETE', '/api/wallet'],
    ])('%s %s does not exist', async (method, path) => {
        const user = await linkedUser('wallet-nowrite');
        const before = fake.state.remaining;

        const res = await request(app)[method.toLowerCase()](path).set('Authorization', `Bearer ${user.token}`).send({ amount: 5000, remaining: 99999 });

        expect(res.status).toBe(404);
        expect(fake.state.remaining).toBe(before);
        expect(fake.state.requests.filter((r) => r.method !== 'GET')).toHaveLength(0);
    });

    it('the remaining amount cannot be set from the URL either: it always comes from Pesa Tracker', async () => {
        const user = await linkedUser('wallet-query');
        fake.state.remaining = 8500;

        const res = await request(app).get('/api/wallet?remaining=999999&balance=999999').set('Authorization', `Bearer ${user.token}`);

        expect(res.body.remaining).toBe(8500);
    });
});

// ---------------------------------------------------------------------------
describe('GET /api/orders/mine', () => {
    it('returns the user\'s orders with cafeteria name and line items', async () => {
        const user = await createTestUser('mine');
        const placed = await placeOrder(user, { cafeteria_id: 'cafe-2', items: [{ menu_item_id: 'item-11', quantity: 2 }] });

        const res = await request(app).get('/api/orders/mine').set('Authorization', `Bearer ${user.token}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0]).toMatchObject({ id: placed.body.id, status: 'pending', total_amount: price11 * 2 });
        expect(typeof res.body[0].cafeteria_name).toBe('string');
        expect(res.body[0].items).toEqual([expect.objectContaining({ menu_item_id: 'item-11', quantity: 2 })]);
    });
});

// ---------------------------------------------------------------------------
describe('live updates: GET /api/events', () => {
    it('401 without a login token', async () => {
        const res = await fetch(`${baseUrl}/api/events`);
        expect(res.status).toBe(401);
    });

    it('a purchase recorded on Pesa Tracker pushes wallet.updated, only after the order is saved', async () => {
        const user = await linkedUser('live-order');
        const stream = await openStream(user);
        try {
            const res = await placeOrder(user);
            expect(res.status).toBe(201);

            const event = await stream.waitFor('wallet.updated');
            expect(event.data).toEqual({ orderId: res.body.id });
            const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM orders WHERE id = ?', [res.body.id]);
            expect(row.n).toBe(1); // by the time the page hears about it, the order is committed
        } finally {
            stream.close();
        }
    });

    it('an order that was not recorded on Pesa Tracker (user not linked) pushes nothing', async () => {
        const user = await createTestUser('live-unlinked');
        const stream = await openStream(user);
        try {
            const res = await placeOrder(user);
            expect(res.status).toBe(201);
            await new Promise((r) => setTimeout(r, 150));
            expect(stream.events.map((e) => e.type)).toEqual(['stream.ready']);
        } finally {
            stream.close();
        }
    });

    it('a refused order pushes nothing', async () => {
        const user = await linkedUser('live-reject');
        fake.state.remaining = 1;
        const stream = await openStream(user);
        try {
            const res = await placeOrder(user);
            expect(res.status).toBe(422);
            await new Promise((r) => setTimeout(r, 150));
            expect(stream.events.map((e) => e.type)).toEqual(['stream.ready']);
        } finally {
            stream.close();
        }
    });

    it('events are private: another user\'s stream sees nothing', async () => {
        const alice = await linkedUser('live-alice');
        const bob = await linkedUser('live-bob');
        const bobStream = await openStream(bob);
        try {
            const res = await placeOrder(alice);
            expect(res.status).toBe(201);
            await new Promise((r) => setTimeout(r, 150));
            expect(bobStream.events.map((e) => e.type)).toEqual(['stream.ready']);
        } finally {
            bobStream.close();
        }
    });

    it('an admin status change reaches the customer live; non-admins get 403', async () => {
        const customer = await createTestUser('live-customer');
        const admin = await createTestUser('live-admin', { role: 'admin' });
        const placed = await placeOrder(customer);
        const stream = await openStream(customer);
        try {
            const denied = await request(app).patch(`/api/orders/${placed.body.id}/status`)
                .set('Authorization', `Bearer ${customer.token}`).send({ status: 'completed' });
            expect(denied.status).toBe(403);

            const bad = await request(app).patch(`/api/orders/${placed.body.id}/status`)
                .set('Authorization', `Bearer ${admin.token}`).send({ status: 'eaten' });
            expect(bad.status).toBe(400);

            const ok = await request(app).patch(`/api/orders/${placed.body.id}/status`)
                .set('Authorization', `Bearer ${admin.token}`).send({ status: 'confirmed' });
            expect(ok.status).toBe(200);

            const event = await stream.waitFor('order.updated');
            expect(event.data).toEqual({ id: placed.body.id, status: 'confirmed', previous: 'pending' });
        } finally {
            stream.close();
        }
    });
});