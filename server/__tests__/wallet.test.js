import request from 'supertest';
import app from '../app.js';
import { pool } from '../db.js';
import { createTestUser, cleanup, walletState } from './helpers.js';
import { MAX_TOPUP } from '../routes/wallet.js';

// Needs the wallet tables:  mysql -u root -p strathsbites < server/migrations/001_wallet.sql

let server;
let baseUrl;
let price11; // price of item-11 (cafe-2), read from the DB so the tests follow the seed data

const ORDER_ONE = { cafeteria_id: 'cafe-2', items: [{ menu_item_id: 'item-11' }] };

const placeOrder = (user, body = ORDER_ONE) =>
    request(app).post('/api/orders').set('Authorization', `Bearer ${user.token}`).send(body);
const topUp = (user, amount) =>
    request(app).post('/api/wallet/topup').set('Authorization', `Bearer ${user.token}`).send({ amount });
const getWallet = (user) => request(app).get('/api/wallet').set('Authorization', `Bearer ${user.token}`);

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
    const [[row]] = await pool.query("SELECT price FROM menu_items WHERE id = 'item-11'");
    price11 = row.price;
});

afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await cleanup();
});

// ---------------------------------------------------------------------------
describe('GET /api/wallet', () => {
    it('401 without a login token', async () => {
        const res = await request(app).get('/api/wallet');
        expect(res.status).toBe(401);
    });

    it('a user who never had a wallet gets one created at KES 0 with an empty statement', async () => {
        const user = await createTestUser('wallet-new', { walletBalance: null });

        const res = await getWallet(user);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ balance: 0, currency: 'KES', transactions: [], pesa: null });
        expect((await walletState(user.id)).balance).toBe(0); // the row really exists now
    });
});

// ---------------------------------------------------------------------------
describe('POST /api/wallet/topup', () => {
    it.each([
        ['amount is missing', undefined],
        ['amount is a string', '500'],
        ['amount is zero', 0],
        ['amount is negative', -100],
        ['amount has cents', 10.5],
        ['amount is above the maximum', MAX_TOPUP + 1],
    ])('400 and nothing changes when %s', async (_label, amount) => {
        const user = await createTestUser('topup-bad', { walletBalance: 200 });

        const res = await topUp(user, amount);

        expect(res.status).toBe(400);
        expect(await walletState(user.id)).toEqual({ balance: 200, ledgerRows: 0 });
    });

    it('adds the money and writes one ledger row with the right balance_after', async () => {
        const user = await createTestUser('topup-ok', { walletBalance: 200 });

        const res = await topUp(user, 500);

        expect(res.status).toBe(201);
        expect(res.body.balance).toBe(700);
        expect(res.body.transaction).toMatchObject({ type: 'topup', amount: 500, balance_after: 700, order_id: null });
        expect(await walletState(user.id)).toEqual({ balance: 700, ledgerRows: 1 });
    });
});

// ---------------------------------------------------------------------------
describe('paying for orders from the wallet', () => {
    it('deducts exactly the order total and links the ledger row to the order', async () => {
        const user = await createTestUser('pay-ok', { walletBalance: price11 + 1000 });

        const res = await placeOrder(user);

        expect(res.status).toBe(201);
        const wallet = await getWallet(user);
        expect(wallet.body.balance).toBe(1000);
        expect(wallet.body.transactions).toHaveLength(1);
        expect(wallet.body.transactions[0]).toMatchObject({
            type: 'order_payment', amount: -price11, balance_after: 1000, order_id: res.body.id,
        });
    });

    it('edge case: a balance exactly equal to the total is enough, and leaves KES 0', async () => {
        const user = await createTestUser('pay-exact', { walletBalance: price11 });

        const res = await placeOrder(user);

        expect(res.status).toBe(201);
        expect((await walletState(user.id)).balance).toBe(0);
    });

    it('422 when the wallet is short: no order, no deduction, no ledger row', async () => {
        const user = await createTestUser('pay-short', { walletBalance: price11 - 1 });

        const res = await placeOrder(user);

        expect(res.status).toBe(422);
        expect(res.body.error).toMatch(/top up/i);
        const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM orders WHERE user_id = ?', [user.id]);
        expect(n).toBe(0);
        expect(await walletState(user.id)).toEqual({ balance: price11 - 1, ledgerRows: 0 });
    });

    it('two orders at the same instant with money for only one: exactly one succeeds, balance never negative', async () => {
        const user = await createTestUser('pay-race', { walletBalance: price11 });

        const results = await Promise.all([placeOrder(user), placeOrder(user), placeOrder(user)]);

        expect(results.map((r) => r.status).sort()).toEqual([201, 422, 422]);
        expect(await walletState(user.id)).toEqual({ balance: 0, ledgerRows: 1 });
    });

    it('the ledger always adds up: starting balance + sum of ledger amounts = current balance', async () => {
        const user = await createTestUser('pay-sum', { walletBalance: 0 });
        await topUp(user, 1000);
        await placeOrder(user);
        await topUp(user, 250);
        await placeOrder(user);

        const [[{ total }]] = await pool.query('SELECT SUM(amount) AS total FROM wallet_transactions WHERE user_id = ?', [user.id]);
        const { balance } = await walletState(user.id);
        expect(Number(total)).toBe(balance);
        expect(balance).toBe(1250 - 2 * price11);
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

    it('a placed order pushes wallet.updated (the committed balance) and order.created with the DB trace', async () => {
        const user = await createTestUser('live-order', { walletBalance: price11 + 50 });
        const stream = await openStream(user);
        try {
            const res = await placeOrder(user);
            expect(res.status).toBe(201);

            const walletEvent = await stream.waitFor('wallet.updated');
            expect(walletEvent.data.balance).toBe(50);
            expect(walletEvent.data.balance).toBe((await walletState(user.id)).balance); // UI value == DB value

            const orderEvent = await stream.waitFor('order.created');
            expect(orderEvent.data.order.id).toBe(res.body.id);
            expect(orderEvent.trace[0]).toBe('BEGIN transaction');
            expect(orderEvent.trace.at(-1)).toBe('COMMIT');
        } finally {
            stream.close();
        }
    });

    it('a refused order pushes order.rejected ending in ROLLBACK, and no wallet.updated', async () => {
        const user = await createTestUser('live-reject', { walletBalance: 1 });
        const stream = await openStream(user);
        try {
            const res = await placeOrder(user);
            expect(res.status).toBe(422);

            const event = await stream.waitFor('order.rejected');
            expect(event.data).toEqual({ status: 422, error: res.body.error });
            expect(event.trace.at(-1)).toMatch(/^ROLLBACK/);
            expect(stream.events.some((e) => e.type === 'wallet.updated')).toBe(false);
        } finally {
            stream.close();
        }
    });

    it('events are private: another user\'s stream sees nothing', async () => {
        const alice = await createTestUser('live-alice');
        const bob = await createTestUser('live-bob');
        const bobStream = await openStream(bob);
        try {
            await topUp(alice, 100);
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
