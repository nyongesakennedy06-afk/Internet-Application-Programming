import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../app.js';
import { pool } from '../db.js';
import { createTestUser, cleanup } from './helpers.js';
import { startFakePesa, deadPesaUrl } from './fakePesa.js';

// Needs the schema from schema.sql (users.pesa_user_id and orders.pesa_transaction_id).
//
// These tests never call the real Pesa Tracker. A tiny stand-in server that follows their openapi.yaml
// (see fakePesa.js) answers instead, so the tests are fast, repeatable, and don't create fake orders
// on your partner's system.

let fake;

let linked;     // has a Pesa Tracker account
let unlinked;   // has no Pesa Tracker account
let total;      // price of the test order
let itemLines;  // how the test order's items should look on Pesa Tracker's side
let ORDER;

const place = (user, body = ORDER) =>
    request(app).post('/api/orders').set('Authorization', `Bearer ${user.token}`).send(body);

const orderCount = async (user) => {
    const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM orders WHERE user_id = ?', [user.id]);
    return row.n;
};

beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {}); // the 502 cases log on purpose; keep test output clean
    fake = await startFakePesa();

    linked = await createTestUser('budget-linked');
    unlinked = await createTestUser('budget-unlinked');
    await pool.query('UPDATE users SET pesa_user_id = ? WHERE id = ?', ['usr_test', linked.id]);

    const [rows] = await pool.query('SELECT id, name, price FROM menu_items WHERE id IN (?, ?)', ['item-11', 'item-12']);
    const menu = Object.fromEntries(rows.map((r) => [r.id, r]));
    total = menu['item-11'].price * 2 + menu['item-12'].price;
    itemLines = [`${menu['item-11'].name} x2`, menu['item-12'].name];
    ORDER = { cafeteria_id: 'cafe-2', items: [{ menu_item_id: 'item-11', quantity: 2 }, { menu_item_id: 'item-12' }] };
});

beforeEach(() => {
    fake.reset();
    process.env.PESA_TRACKER_URL = fake.url;
});

afterAll(async () => {
    delete process.env.PESA_TRACKER_URL;
    await fake.close();
    jest.restoreAllMocks();
    await cleanup();
});

describe('POST /api/orders with the Pesa Tracker budget check', () => {
    it('happy path: checks the budget, places the order, and records exactly this purchase', async () => {
        const res = await place(linked);

        expect(res.status).toBe(201);
        expect(Object.keys(res.body).sort()).toEqual(['cafeteria_id', 'id', 'items', 'status', 'total_amount']); // our own contract is unchanged

        expect(fake.state.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
            'GET /v1/users/usr_test/budget',
            'POST /v1/users/usr_test/transactions',
        ]);
        expect(fake.state.requests[1].body).toEqual({ orderId: `ord_${res.body.id}`, amount: total, items: itemLines, currency: 'KES' });
        expect(fake.state.requests.every((r) => r.authorization === 'Bearer test')).toBe(true);
        expect(fake.state.remaining).toBe(100000 - total);                       // deducted exactly once
        expect(fake.state.requests.some((r) => r.method === 'PATCH')).toBe(false); // never also PATCH "deduct" (double charge)
        expect(await orderCount(linked)).toBe(1);

        const [[saved]] = await pool.query('SELECT pesa_transaction_id FROM orders WHERE id = ?', [res.body.id]);
        expect(saved.pesa_transaction_id).toMatch(/^txn_\d{8}$/); // Pesa Tracker's id for this purchase is remembered
    });

    it('edge case: a budget that is exactly equal to the order total is enough', async () => {
        fake.state.remaining = total;

        const res = await place(linked);

        expect(res.status).toBe(201);
        expect(fake.state.remaining).toBe(0);
    });

    it('rejects with 422 when the order is more than the remaining budget, and never records a purchase', async () => {
        fake.state.remaining = total - 1;
        const before = await orderCount(linked);

        const res = await place(linked);

        expect(res.status).toBe(422);
        expect(typeof res.body.error).toBe('string');
        expect(res.body.error).toContain(String(total));
        expect(fake.state.requests.some((r) => r.method === 'POST')).toBe(false);
        expect(fake.state.remaining).toBe(total - 1);
        expect(await orderCount(linked)).toBe(before);
    });

    it('rolls the order back when Pesa Tracker refuses the purchase after the check passed (e.g. a second order got in first)', async () => {
        fake.state.mode = 'reject-transactions';
        const before = await orderCount(linked);

        const res = await place(linked);

        expect(res.status).toBe(422);
        expect(await orderCount(linked)).toBe(before);
    });

    // Matches commit 41c79bd ("no budget must be set to complete an order"): a linked user with no
    // Pesa Tracker budget can still order; we just skip the budget check and don't record it there.
    it('a linked user with no budget set on Pesa Tracker (404) can still order, and no purchase is recorded there', async () => {
        fake.state.mode = 'unknown-user';
        const before = await orderCount(linked);

        const res = await place(linked);

        expect(res.status).toBe(201);
        expect(await orderCount(linked)).toBe(before + 1);
        expect(fake.state.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
        const [[saved]] = await pool.query('SELECT pesa_transaction_id FROM orders WHERE id = ?', [res.body.id]);
        expect(saved.pesa_transaction_id).toBeNull(); // nothing was recorded on Pesa Tracker, so the wallet will not list it
    });

    it('returns 502 and saves nothing when Pesa Tracker has a server error', async () => {
        fake.state.mode = 'server-error';
        const before = await orderCount(linked);

        const res = await place(linked);

        expect(res.status).toBe(502);
        expect(typeof res.body.error).toBe('string');
        expect(await orderCount(linked)).toBe(before);
    });

    it('returns 502 and saves nothing when Pesa Tracker cannot be reached at all', async () => {
        process.env.PESA_TRACKER_URL = await deadPesaUrl(); // nothing is listening there
        const before = await orderCount(linked);

        const res = await place(linked);

        expect(res.status).toBe(502);
        expect(await orderCount(linked)).toBe(before);
    });

    it('a user without a Pesa Tracker account can still order, and Pesa Tracker is never contacted', async () => {
        const res = await place(unlinked);

        expect(res.status).toBe(201);
        expect(fake.state.requests).toHaveLength(0);
    });

    it('with the integration switched off (PESA_TRACKER_URL unset) orders still work and nothing is contacted', async () => {
        delete process.env.PESA_TRACKER_URL;

        const res = await place(linked);

        expect(res.status).toBe(201);
        expect(fake.state.requests).toHaveLength(0);
    });
});