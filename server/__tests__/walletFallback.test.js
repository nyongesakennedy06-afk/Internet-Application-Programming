import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../app.js';
import { createTestUser, insertOrder, cleanup } from './helpers.js';
import { startFakePesa, deadPesaUrl } from './fakePesa.js';

// Week 11: what GET /api/wallet shows when Pesa Tracker cannot be reached.
// Pesa Tracker is replaced by a stand-in server (fakePesa.js); the real one is never contacted.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
let fake;
let consoleError;

const linkedUser = (label) => createTestUser(label, { pesaUserId: 'usr_test' });
const getWallet = (user) => request(app).get('/api/wallet').set('Authorization', `Bearer ${user.token}`);
const getBudgetCalls = () => fake.state.requests.filter((r) => r.method === 'GET').length;

beforeAll(async () => { fake = await startFakePesa(); });
beforeEach(() => {
    fake.reset();
    process.env.PESA_TRACKER_URL = fake.url;
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {}); // failures are logged on purpose
    jest.spyOn(console, 'warn').mockImplementation(() => {});                 // so are the "retrying" lines
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
    delete process.env.PESA_TRACKER_URL;
    await fake.close();
    await cleanup();
});

describe('GET /api/wallet when Pesa Tracker fails', () => {
    it('shows the saved amount, flagged stale with the time it was saved, after a good read', async () => {
        const user = await linkedUser('fb-stale');
        fake.state.remaining = 8500;

        const live = await getWallet(user);
        expect(live.body).toMatchObject({ status: 'ok', remaining: 8500 });
        expect(live.body).not.toHaveProperty('stale'); // a live answer carries no stale flag

        fake.state.mode = 'server-error';
        fake.state.requests = [];
        const saved = await getWallet(user);

        expect(saved.status).toBe(200);
        expect(saved.body).toMatchObject({ status: 'ok', remaining: 8500, stale: true, currency: 'KES' });
        expect(saved.body.asOf).toMatch(ISO_DATE);
        expect(getBudgetCalls()).toBe(3); // tried 1 + 2 retries before giving up
        expect(consoleError).toHaveBeenCalled(); // the failure is still logged
    });

    it('also falls back when Pesa Tracker cannot be reached at all', async () => {
        const user = await linkedUser('fb-dead');
        await getWallet(user);

        process.env.PESA_TRACKER_URL = await deadPesaUrl();
        const res = await getWallet(user);

        expect(res.body).toMatchObject({ status: 'ok', remaining: 100000, stale: true });
    });

    it('says unavailable (no crash) when nothing was ever saved for this user', async () => {
        const user = await linkedUser('fb-nosave');
        fake.state.mode = 'server-error';

        const res = await getWallet(user);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'unavailable', remaining: null });
        expect(res.body).not.toHaveProperty('stale');
    });

    it('never shows one user the saved budget of another', async () => {
        const first = await linkedUser('fb-first');
        const second = await linkedUser('fb-second');
        fake.state.remaining = 4200;
        await getWallet(first); // only the first user has a saved copy

        fake.state.mode = 'server-error';
        const res = await getWallet(second);

        expect(res.body).toMatchObject({ status: 'unavailable', remaining: null });
    });

    it('goes back to live data, with no stale flag, once Pesa Tracker recovers', async () => {
        const user = await linkedUser('fb-recover');
        fake.state.remaining = 8500;
        await getWallet(user);

        fake.state.mode = 'server-error';
        expect((await getWallet(user)).body.stale).toBe(true);

        fake.state.mode = 'ok';
        fake.state.remaining = 7000;
        const res = await getWallet(user);

        expect(res.body).toMatchObject({ status: 'ok', remaining: 7000 });
        expect(res.body).not.toHaveProperty('stale');
    });

    it('treats 404 (no budget set up) as a real answer and forgets the saved amount', async () => {
        const user = await linkedUser('fb-404');
        await getWallet(user);

        fake.state.mode = 'unknown-user';
        expect((await getWallet(user)).body).toMatchObject({ status: 'no_budget', remaining: null });

        fake.state.mode = 'server-error';
        expect((await getWallet(user)).body).toMatchObject({ status: 'unavailable', remaining: null });
    });

    it('still lists past transactions while showing saved data', async () => {
        const user = await linkedUser('fb-tx');
        await insertOrder(user.id, 'cafe-1', 'completed', { pesaTransactionId: 'txn_1' });
        await getWallet(user);

        fake.state.mode = 'server-error';
        const res = await getWallet(user);

        expect(res.body.stale).toBe(true);
        expect(res.body.transactions).toHaveLength(1);
    });
});