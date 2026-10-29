import request from 'supertest';
import app from '../app.js';
import { pool } from '../db.js';
import { createTestUser, insertOrder, cleanup } from './helpers.js';
import { TEST_API_KEY } from './testKey.js';

// These tests expect the seeded cafeterias/menu items from data.json (cafe-1, cafe-2, item-1, item-11, item-12 ...).
// Contract dates look like 2026-08-13T10:00:00Z (no milliseconds).
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const UNKNOWN_USER_ID = 999999999;

let reader;     // has 3 orders: two at cafe-1, then one at cafe-2
let newcomer;   // has no orders at all
let writer;     // used by the POST tests
let readerOrderIds;

beforeAll(async () => {
    reader = await createTestUser('reader');
    newcomer = await createTestUser('newcomer');
    writer = await createTestUser('writer');

    readerOrderIds = [];
    readerOrderIds.push(await insertOrder(reader.id, 'cafe-1'));
    readerOrderIds.push(await insertOrder(reader.id, 'cafe-1'));
    readerOrderIds.push(await insertOrder(reader.id, 'cafe-2'));
});

afterAll(cleanup);

const keysOf = (obj) => Object.keys(obj).sort();

// ---------------------------------------------------------------------------
describe('GET /api/orders?userId=&fields=', () => {
    it('fields=timestamp returns every order as exactly { id, timestamp }, newest first', async () => {
        const res = await request(app).get('/api/orders').set('X-API-Key', TEST_API_KEY).query({ userId: reader.id, fields: 'timestamp' });

        expect(res.status).toBe(200);
        expect(keysOf(res.body)).toEqual(['orders']);
        expect(res.body.orders).toHaveLength(3);
        for (const order of res.body.orders) {
            expect(keysOf(order)).toEqual(['id', 'timestamp']); // no extra / DB-only fields
            expect(Number.isInteger(order.id)).toBe(true);
            expect(typeof order.timestamp).toBe('string');
            expect(order.timestamp).toMatch(ISO_DATE);
        }
        expect(res.body.orders.map((o) => o.id)).toEqual([...readerOrderIds].reverse());
    });

    it('fields=location returns every order as exactly { id, location }', async () => {
        const res = await request(app).get('/api/orders').set('X-API-Key', TEST_API_KEY).query({ userId: reader.id, fields: 'location' });

        expect(res.status).toBe(200);
        expect(res.body.orders).toHaveLength(3);
        for (const order of res.body.orders) {
            expect(keysOf(order)).toEqual(['id', 'location']);
            expect(typeof order.location).toBe('string');
        }
        expect(res.body.orders.map((o) => o.location)).toEqual(['cafe-2', 'cafe-1', 'cafe-1']);
    });

    it('edge case: a user with no orders gets 200 and an empty list, not an error', async () => {
        const res = await request(app).get('/api/orders').set('X-API-Key', TEST_API_KEY).query({ userId: newcomer.id, fields: 'timestamp' });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ orders: [] });
    });

    it.each([
        ['userId is missing', { fields: 'timestamp' }],
        ['userId is not a number', { userId: 'abc', fields: 'timestamp' }],
        ['userId is not a whole number', { userId: '1.5', fields: 'timestamp' }],
        ['userId is zero', { userId: '0', fields: 'timestamp' }],
        ['fields is missing', { userId: '1' }],
        ['fields is not an allowed value', { userId: '1', fields: 'price' }],
    ])('validation: 400 with an error message when %s', async (_label, query) => {
        const res = await request(app).get('/api/orders').set('X-API-Key', TEST_API_KEY).query(query);

        expect(res.status).toBe(400);
        expect(keysOf(res.body)).toEqual(['error']);
        expect(typeof res.body.error).toBe('string');
        expect(res.body.error.length).toBeGreaterThan(0);
    });

    it('not found: 404 for a user id that does not exist', async () => {
        const res = await request(app).get('/api/orders').set('X-API-Key', TEST_API_KEY).query({ userId: UNKNOWN_USER_ID, fields: 'timestamp' });

        expect(res.status).toBe(404);
        expect(keysOf(res.body)).toEqual(['error']);
        expect(res.body.error).toContain(String(UNKNOWN_USER_ID));
    });
});

// ---------------------------------------------------------------------------
describe('POST /api/orders', () => {
    const placeOrder = (body, token = writer.token) =>
        request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send(body);

    // Re-fetches through the contract GET endpoint so we can prove data really changed (or did not).
    const writerOrders = async () => {
        const res = await request(app).get('/api/orders').set('X-API-Key', TEST_API_KEY).query({ userId: writer.id, fields: 'location' });
        return res.body.orders;
    };

    it('happy path: 201 with the new order shaped exactly like the contract, prices taken from the DB', async () => {
        const [menuRows] = await pool.query('SELECT id, name, price FROM menu_items WHERE id IN (?, ?)', ['item-11', 'item-12']);
        const menu = Object.fromEntries(menuRows.map((r) => [r.id, r]));

        const res = await placeOrder({
            cafeteria_id: 'cafe-2',
            items: [{ menu_item_id: 'item-11', quantity: 2 }, { menu_item_id: 'item-12' }],
        });

        expect(res.status).toBe(201);
        expect(keysOf(res.body)).toEqual(['cafeteria_id', 'id', 'items', 'status', 'total_amount']);
        expect(Number.isInteger(res.body.id)).toBe(true);
        expect(res.body.cafeteria_id).toBe('cafe-2');
        expect(res.body.status).toBe('pending');
        expect(typeof res.body.total_amount).toBe('number');
        expect(res.body.total_amount).toBe(menu['item-11'].price * 2 + menu['item-12'].price * 1);

        expect(res.body.items).toHaveLength(2);
        for (const item of res.body.items) {
            expect(keysOf(item)).toEqual(['item_name', 'item_price', 'menu_item_id', 'quantity']);
            expect(Number.isInteger(item.quantity)).toBe(true);
            expect(item.item_name).toBe(menu[item.menu_item_id].name);
            expect(item.item_price).toBe(menu[item.menu_item_id].price);
        }
        const byId = Object.fromEntries(res.body.items.map((i) => [i.menu_item_id, i]));
        expect(byId['item-11'].quantity).toBe(2);
        expect(byId['item-12'].quantity).toBe(1); // omitted quantity defaults to 1
    });

    it('the order is really saved: it shows up in GET /orders and has its order_items rows', async () => {
        const res = await placeOrder({ cafeteria_id: 'cafe-1', items: [{ menu_item_id: 'item-1' }, { menu_item_id: 'item-2', quantity: 3 }] });
        expect(res.status).toBe(201);

        const orders = await writerOrders();
        expect(orders).toContainEqual({ id: res.body.id, location: 'cafe-1' });

        const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?', [res.body.id]);
        expect(row.n).toBe(2);
    });

    const rejected = [
        ['there is no body at all', undefined],
        ['cafeteria_id is missing', { items: [{ menu_item_id: 'item-11' }] }],
        ['cafeteria_id is a number', { cafeteria_id: 2, items: [{ menu_item_id: 'item-11' }] }],
        ['cafeteria_id is blank', { cafeteria_id: '  ', items: [{ menu_item_id: 'item-11' }] }],
        ['items is missing', { cafeteria_id: 'cafe-2' }],
        ['items is not an array', { cafeteria_id: 'cafe-2', items: 'item-11' }],
        ['items is empty', { cafeteria_id: 'cafe-2', items: [] }],
        ['an item is null', { cafeteria_id: 'cafe-2', items: [null] }],
        ['menu_item_id is missing', { cafeteria_id: 'cafe-2', items: [{ quantity: 1 }] }],
        ['menu_item_id is a number', { cafeteria_id: 'cafe-2', items: [{ menu_item_id: 11 }] }],
        ['quantity is a string', { cafeteria_id: 'cafe-2', items: [{ menu_item_id: 'item-11', quantity: '5' }] }],
        ['quantity is zero', { cafeteria_id: 'cafe-2', items: [{ menu_item_id: 'item-11', quantity: 0 }] }],
        ['quantity is negative', { cafeteria_id: 'cafe-2', items: [{ menu_item_id: 'item-11', quantity: -3 }] }],
        ['quantity is not a whole number', { cafeteria_id: 'cafe-2', items: [{ menu_item_id: 'item-11', quantity: 0.5 }] }],
        ['quantity is above the maximum of 100', { cafeteria_id: 'cafe-2', items: [{ menu_item_id: 'item-11', quantity: 101 }] }],
        ['the same menu item appears twice', { cafeteria_id: 'cafe-2', items: [{ menu_item_id: 'item-11' }, { menu_item_id: 'item-11' }] }],
    ];

    it.each(rejected)('validation: 400 and nothing written when %s', async (_label, body) => {
        const before = (await writerOrders()).length;

        const res = await placeOrder(body);

        expect(res.status).toBe(400);
        expect(keysOf(res.body)).toEqual(['error']);
        expect(typeof res.body.error).toBe('string');
        expect((await writerOrders()).length).toBe(before);
    });

    it('not found: a menu item that does not exist is rejected with 400 and nothing is written', async () => {
        const before = (await writerOrders()).length;

        const res = await placeOrder({ cafeteria_id: 'cafe-2', items: [{ menu_item_id: 'item-999' }] });

        expect(res.status).toBe(400);
        expect(typeof res.body.error).toBe('string');
        expect((await writerOrders()).length).toBe(before);
    });

    it('not found: a cafeteria that does not exist is rejected with 400 and nothing is written', async () => {
        const before = (await writerOrders()).length;

        const res = await placeOrder({ cafeteria_id: 'cafe-99', items: [{ menu_item_id: 'item-11' }] });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('cafe-99');
        expect((await writerOrders()).length).toBe(before);
    });

    it('rejects items that belong to a different cafeteria than cafeteria_id', async () => {
        const before = (await writerOrders()).length;

        const res = await placeOrder({ cafeteria_id: 'cafe-2', items: [{ menu_item_id: 'item-11' }, { menu_item_id: 'item-1' }] });

        expect(res.status).toBe(400);
        expect(typeof res.body.error).toBe('string');
        expect((await writerOrders()).length).toBe(before);
    });

    it.each([1, 100])('edge case: quantity %i (the boundary values) is accepted', async (quantity) => {
        const res = await placeOrder({ cafeteria_id: 'cafe-2', items: [{ menu_item_id: 'item-11', quantity }] });

        expect(res.status).toBe(201);
        expect(res.body.items[0].quantity).toBe(quantity);
    });

    it('auth: 401 when no token is sent, and nothing is written', async () => {
        const before = (await writerOrders()).length;

        const res = await request(app).post('/api/orders').send({ cafeteria_id: 'cafe-2', items: [{ menu_item_id: 'item-11' }] });

        expect(res.status).toBe(401);
        expect(keysOf(res.body)).toEqual(['error']);
        expect((await writerOrders()).length).toBe(before);
    });

    it('auth: 401 when the token is invalid, and nothing is written', async () => {
        const before = (await writerOrders()).length;

        const res = await placeOrder({ cafeteria_id: 'cafe-2', items: [{ menu_item_id: 'item-11' }] }, 'not-a-real-token');

        expect(res.status).toBe(401);
        expect((await writerOrders()).length).toBe(before);
    });
});