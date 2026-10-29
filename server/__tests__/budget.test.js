import http from 'node:http';
import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../app.js';
import { pool } from '../db.js';
import { createTestUser, cleanup } from './helpers.js';

// Needs the column added once with:  ALTER TABLE users ADD COLUMN pesa_user_id VARCHAR(50) NULL;
//
// These tests never call the real Pesa Tracker. A tiny stand-in server that follows their openapi.yaml
// answers instead, so the tests are fast, repeatable, and don't create fake orders on your partner's system.

let fake;
let fakeUrl;
let remaining;      // the stand-in's "remaining budget"
let mode;           // 'ok' | 'reject-transactions' | 'server-error' | 'unknown-user'
let requests;       // everything the stand-in received, in order

const startFake = () =>
    new Promise((resolve) => {
        fake = http.createServer((req, res) => {
            let raw = '';
            req.on('data', (chunk) => (raw += chunk));
            req.on('end', () => {
                const body = raw ? JSON.parse(raw) : undefined;
                requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
                const send = (status, payload) => {
                    res.writeHead(status, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(payload));
                };

                if (mode === 'server-error') return send(500, { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' });
                if (mode === 'unknown-user') return send(404, { code: 'NOT_FOUND', message: 'No budget found for user.' });

                if (req.method === 'GET' && /^\/v1\/users\/[^/]+\/budget$/.test(req.url)) {
                    return send(200, { userId: 'usr_test', monthlyLimit: 13000, remaining, currency: 'KES', updatedAt: '2026-09-07T14:32:00Z' });
                }
                if (req.method === 'POST' && /^\/v1\/users\/[^/]+\/transactions$/.test(req.url)) {
                    if (mode === 'reject-transactions' || body.amount > remaining) {
                        return send(422, { code: 'BUDGET_EXCEEDED', message: "This transaction would put the user's budget below zero." });
                    }
                    remaining -= body.amount;
                    return send(201, { id: 'txn_00000001', userId: 'usr_test', orderId: body.orderId, amount: body.amount, items: body.items, currency: 'KES', createdAt: '2026-09-07T13:05:02Z' });
                }
                send(404, { code: 'NOT_FOUND', message: 'No route.' });
            });
        });
        fake.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${fake.address().port}/v1`));
    });

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
    fakeUrl = await startFake();

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
    remaining = 100000;
    mode = 'ok';
    requests = [];
    process.env.PESA_TRACKER_URL = fakeUrl;
});

afterAll(async () => {
    delete process.env.PESA_TRACKER_URL;
    await new Promise((resolve) => fake.close(resolve));
    jest.restoreAllMocks();
    await cleanup();
});

describe('POST /api/orders with the Pesa Tracker budget check', () => {
    it('happy path: checks the budget, places the order, and records exactly this purchase', async () => {
        const res = await place(linked);

        expect(res.status).toBe(201);
        expect(Object.keys(res.body).sort()).toEqual(['cafeteria_id', 'id', 'items', 'status', 'total_amount']); // our own contract is unchanged

        expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
            'GET /v1/users/usr_test/budget',
            'POST /v1/users/usr_test/transactions',
        ]);
        expect(requests[1].body).toEqual({ orderId: `ord_${res.body.id}`, amount: total, items: itemLines, currency: 'KES' });
        expect(requests.every((r) => r.authorization === 'Bearer test')).toBe(true);
        expect(remaining).toBe(100000 - total);                       // deducted exactly once
        expect(requests.some((r) => r.method === 'PATCH')).toBe(false); // never also PATCH "deduct" (double charge)
        expect(await orderCount(linked)).toBe(1);
    });

    it('edge case: a budget that is exactly equal to the order total is enough', async () => {
        remaining = total;

        const res = await place(linked);

        expect(res.status).toBe(201);
        expect(remaining).toBe(0);
    });

    it('rejects with 422 when the order is more than the remaining budget, and never records a purchase', async () => {
        remaining = total - 1;
        const before = await orderCount(linked);

        const res = await place(linked);

        expect(res.status).toBe(422);
        expect(typeof res.body.error).toBe('string');
        expect(res.body.error).toContain(String(total));
        expect(requests.some((r) => r.method === 'POST')).toBe(false);
        expect(remaining).toBe(total - 1);
        expect(await orderCount(linked)).toBe(before);
    });

    it('rolls the order back when Pesa Tracker refuses the purchase after the check passed (e.g. a second order got in first)', async () => {
        mode = 'reject-transactions';
        const before = await orderCount(linked);

        const res = await place(linked);

        expect(res.status).toBe(422);
        expect(await orderCount(linked)).toBe(before);
    });

    it('returns 400 and saves nothing when the linked Pesa Tracker account does not exist', async () => {
        mode = 'unknown-user';
        const before = await orderCount(linked);

        const res = await place(linked);

        expect(res.status).toBe(400);
        expect(typeof res.body.error).toBe('string');
        expect(await orderCount(linked)).toBe(before);
    });

    it('returns 502 and saves nothing when Pesa Tracker has a server error', async () => {
        mode = 'server-error';
        const before = await orderCount(linked);

        const res = await place(linked);

        expect(res.status).toBe(502);
        expect(typeof res.body.error).toBe('string');
        expect(await orderCount(linked)).toBe(before);
    });

    it('returns 502 and saves nothing when Pesa Tracker cannot be reached at all', async () => {
        const dead = http.createServer();
        await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
        const port = dead.address().port;
        await new Promise((resolve) => dead.close(resolve));       // nothing is listening on this port any more
        process.env.PESA_TRACKER_URL = `http://127.0.0.1:${port}/v1`;
        const before = await orderCount(linked);

        const res = await place(linked);

        expect(res.status).toBe(502);
        expect(await orderCount(linked)).toBe(before);
    });

    it('a user without a Pesa Tracker account can still order, and Pesa Tracker is never contacted', async () => {
        const res = await place(unlinked);

        expect(res.status).toBe(201);
        expect(requests).toHaveLength(0);
    });

    it('with the integration switched off (PESA_TRACKER_URL unset) orders still work and nothing is contacted', async () => {
        delete process.env.PESA_TRACKER_URL;

        const res = await place(linked);

        expect(res.status).toBe(201);
        expect(requests).toHaveLength(0);
    });
});