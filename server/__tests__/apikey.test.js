import { execFileSync } from 'node:child_process';
import request from 'supertest';
import app from '../app.js';
import { createTestUser, insertOrder, cleanup } from './helpers.js';
import { TEST_API_KEY } from './testKey.js';

const UNKNOWN_USER_ID = 999999999;
let user;

beforeAll(async () => {
    user = await createTestUser('apikey');
    await insertOrder(user.id, 'cafe-1');
});

afterAll(cleanup);

// The two endpoints Team 10 uses. Each has a URL that would work, a URL with bad input, and a URL for an unknown user.
const endpoints = {
    'GET /api/orders': {
        ok: () => `/api/orders?userId=${user.id}&fields=location`,
        badInput: () => '/api/orders',
        unknownUser: () => `/api/orders?userId=${UNKNOWN_USER_ID}&fields=location`,
    },
    'GET /api/users/:id/order-frequency': {
        ok: () => `/api/users/${user.id}/order-frequency?locationId=cafe-1`,
        badInput: () => `/api/users/${user.id}/order-frequency`,
        unknownUser: () => `/api/users/${UNKNOWN_USER_ID}/order-frequency?locationId=cafe-1`,
    },
};

describe.each(Object.keys(endpoints))('%s requires an API key', (name) => {
    const url = (kind = 'ok') => endpoints[name][kind]();

    it('401 when no key is sent', async () => {
        const res = await request(app).get(url());

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'API key is required' });
    });

    it('401 when the key header is empty', async () => {
        const res = await request(app).get(url()).set('X-API-Key', '');

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'API key is required' });
    });

    it('401 when the key is wrong', async () => {
        const res = await request(app).get(url()).set('X-API-Key', 'wrong-key');

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'Invalid API key' });
    });

    it('200 when the key is valid', async () => {
        const res = await request(app).get(url()).set('X-API-Key', TEST_API_KEY);

        expect(res.status).toBe(200);
        expect(res.body).not.toHaveProperty('error');
    });

    it('the header name is not case sensitive (x-api-key works too)', async () => {
        const res = await request(app).get(url()).set('x-api-key', TEST_API_KEY);

        expect(res.status).toBe(200);
    });

    it('the key is checked before anything else: bad input without a key is 401, not 400', async () => {
        const res = await request(app).get(url('badInput'));

        expect(res.status).toBe(401);
    });

    it('the key is checked before anything else: an unknown user without a key is 401, not 404 (does not reveal who exists)', async () => {
        const res = await request(app).get(url('unknownUser'));

        expect(res.status).toBe(401);
    });

    it('a logged-in user token is not an API key', async () => {
        const res = await request(app).get(url()).set('Authorization', `Bearer ${user.token}`);

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'API key is required' });
    });

    it('the key only counts in the X-API-Key header, not in the URL', async () => {
        const separator = url().includes('?') ? '&' : '?';
        const res = await request(app).get(`${url()}${separator}apiKey=${TEST_API_KEY}`);

        expect(res.status).toBe(401);
    });
});

describe('the rest of the API still works without a key (the website must keep working)', () => {
    it('GET /api/cafeterias needs no key', async () => {
        const res = await request(app).get('/api/cafeterias');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('login needs no key (a wrong password is rejected for the password, not for a missing key)', async () => {
        const res = await request(app).post('/api/auth/login').send({ email: 'nobody@test.local', password: 'wrong-password-1' });

        expect(res.status).toBe(401);
        expect(res.body.error).not.toMatch(/api key/i);
    });

    it('GET /api/orders/mine works with a login token and no key', async () => {
        const res = await request(app).get('/api/orders/mine').set('Authorization', `Bearer ${user.token}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('an API key does not log anyone in: /api/orders/mine with only a key is 401', async () => {
        const res = await request(app).get('/api/orders/mine').set('X-API-Key', TEST_API_KEY);

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'No token provided' });
    });

    it('an API key does not let you place orders: POST /api/orders with only a key is 401', async () => {
        const res = await request(app)
            .post('/api/orders')
            .set('X-API-Key', TEST_API_KEY)
            .send({ cafeteria_id: 'cafe-1', items: [{ menu_item_id: 'item-1' }] });

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'No token provided' });
    });
});

describe('fail closed: no keys configured means nothing gets in', () => {
    // Runs the real middleware in a separate Node process with no keys configured, because it reads its keys once at startup.
    const runMiddlewareWith = (apiKeysValue) => {
        const middlewareUrl = new URL('../middleware/apiKey.js', import.meta.url).href;
        const script = `
            import { requireApiKey } from ${JSON.stringify(middlewareUrl)};
            let nextCalled = false;
            const out = {};
            const res = { status(code) { out.status = code; return this; }, json(body) { out.body = body; return this; } };
            requireApiKey({ headers: { 'x-api-key': 'any-key-at-all' } }, res, () => { nextCalled = true; });
            console.log(JSON.stringify({ ...out, nextCalled }));
        `;
        const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            env: { ...process.env, API_KEYS: apiKeysValue },
            encoding: 'utf8',
        });
        return JSON.parse(stdout.trim().split('\n').pop());
    };

    it('API_KEYS empty: every request is rejected', () => {
        expect(runMiddlewareWith('')).toEqual({
            status: 401,
            body: { error: 'API key authentication is not configured' },
            nextCalled: false,
        });
    });

    it('API_KEYS badly formatted (no "name:" in front of the key): every request is rejected', () => {
        const result = runMiddlewareWith('just-a-key-without-a-name');

        expect(result.status).toBe(401);
        expect(result.nextCalled).toBe(false);
    });
});