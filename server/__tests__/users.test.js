import request from 'supertest';
import app from '../app.js';
import { createTestUser, insertOrder, cleanup } from './helpers.js';
import { TEST_API_KEY } from './testKey.js';

// These tests expect the seeded cafeterias from data.json (cafe-1, cafe-2, cafe-3 ...).
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const UNKNOWN_USER_ID = 999999999;

let repeater;   // 2 orders at cafe-1, 1 order at cafe-2, none at cafe-3
let newcomer;   // no orders anywhere

beforeAll(async () => {
    repeater = await createTestUser('repeater');
    newcomer = await createTestUser('newcomer');

    await insertOrder(repeater.id, 'cafe-1');
    await insertOrder(repeater.id, 'cafe-1');
    await insertOrder(repeater.id, 'cafe-2');
});

afterAll(cleanup);

const keysOf = (obj) => Object.keys(obj).sort();
const frequency = (userId, locationId) =>
    request(app).get(`/api/users/${userId}/order-frequency`).set('X-API-Key', TEST_API_KEY).query(locationId === undefined ? {} : { locationId });

describe('GET /api/users/:id/order-frequency?locationId=', () => {
    it('happy path: a repeat customer gets exactly the contract fields with the right values and types', async () => {
        const res = await frequency(repeater.id, 'cafe-1');

        expect(res.status).toBe(200);
        expect(keysOf(res.body)).toEqual(['isFirstTimeUser', 'lastOrderDate', 'locationId', 'orderCount', 'userId']);
        expect(res.body.userId).toBe(repeater.id);
        expect(res.body.locationId).toBe('cafe-1');
        expect(res.body.orderCount).toBe(2);
        expect(res.body.isFirstTimeUser).toBe(false);
        expect(typeof res.body.lastOrderDate).toBe('string');
        expect(res.body.lastOrderDate).toMatch(ISO_DATE);
    });

    it('counts orders per location, not across all cafeterias', async () => {
        const res = await frequency(repeater.id, 'cafe-2');

        expect(res.status).toBe(200);
        expect(res.body.orderCount).toBe(1);
        expect(res.body.isFirstTimeUser).toBe(false);
    });

    it('edge case: a user who never ordered at this location is a first-timer and has no lastOrderDate', async () => {
        const res = await frequency(repeater.id, 'cafe-3');

        expect(res.status).toBe(200);
        expect(keysOf(res.body)).toEqual(['isFirstTimeUser', 'locationId', 'orderCount', 'userId']);
        expect(res.body.orderCount).toBe(0);
        expect(res.body.isFirstTimeUser).toBe(true);
        expect(res.body).not.toHaveProperty('lastOrderDate');
    });

    it('edge case: a user with no orders at all is a first-timer everywhere', async () => {
        const res = await frequency(newcomer.id, 'cafe-1');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ userId: newcomer.id, locationId: 'cafe-1', orderCount: 0, isFirstTimeUser: true });
    });

    it.each([
        ['locationId is missing', undefined],
        ['locationId is empty', ''],
    ])('validation: 400 with an error message when %s', async (_label, locationId) => {
        const res = await frequency(repeater.id, locationId);

        expect(res.status).toBe(400);
        expect(keysOf(res.body)).toEqual(['error']);
        expect(typeof res.body.error).toBe('string');
    });

    it('not found: 404 for a user id that does not exist', async () => {
        const res = await frequency(UNKNOWN_USER_ID, 'cafe-1');

        expect(res.status).toBe(404);
        expect(keysOf(res.body)).toEqual(['error']);
        expect(res.body.error).toContain(String(UNKNOWN_USER_ID));
    });

    it('not found: 404 for a user id that is not a number', async () => {
        const res = await frequency('abc', 'cafe-1');

        expect(res.status).toBe(404);
        expect(typeof res.body.error).toBe('string');
    });

    it('not found: 404 for a location that does not exist', async () => {
        const res = await frequency(repeater.id, 'cafe-99');

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('cafe-99');
    });
});