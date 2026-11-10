import express from 'express';
import request from 'supertest';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { requireApiKey } from '../middleware/apiKey.js';
import { TEST_API_KEY } from './testKey.js';

// These tests use small stand-in apps, so they need no database and no real keys.

const WINDOW_MS = 60_000;

// A clock the tests control, so no test has to wait for real time to pass.
const makeClock = () => {
    let t = 1_000_000;
    return { now: () => t, advance: (ms) => { t += ms; } };
};

// App where the caller names itself with a header (to test several consumers).
const appWithConsumers = ({ max, clock }) => {
    const app = express();
    app.use((req, res, next) => {
        req.apiConsumer = req.get('x-test-consumer');
        next();
    });
    app.get('/ping', createRateLimiter({ windowMs: WINDOW_MS, max, now: clock.now }), (req, res) => {
        res.json({ ok: true });
    });
    return app;
};

const ping = (app, consumer = 'team10') => request(app).get('/ping').set('x-test-consumer', consumer);

describe('rate limiter', () => {
    it('allows requests up to the limit, then answers 429 with a JSON body', async () => {
        const app = appWithConsumers({ max: 3, clock: makeClock() });

        const statuses = [];
        for (let i = 0; i < 5; i++) statuses.push((await ping(app)).status);
        expect(statuses).toEqual([200, 200, 200, 429, 429]);

        const blocked = await ping(app);
        expect(blocked.status).toBe(429);
        expect(blocked.body.error).toBe('Too many requests');
        expect(Number.isInteger(blocked.body.retryAfter)).toBe(true);
    });

    it('sends a Retry-After header that matches the body and the time left in the window', async () => {
        const clock = makeClock();
        const app = appWithConsumers({ max: 1, clock });

        await ping(app); // uses the allowance and starts the window
        clock.advance(10_000); // 10 s into a 60 s window

        const blocked = await ping(app);
        expect(blocked.status).toBe(429);
        expect(blocked.headers['retry-after']).toBe('50');
        expect(blocked.body.retryAfter).toBe(50);
    });

    it('gives each consumer its own allowance', async () => {
        const app = appWithConsumers({ max: 2, clock: makeClock() });

        await ping(app, 'team10');
        await ping(app, 'team10');
        expect((await ping(app, 'team10')).status).toBe(429);

        expect((await ping(app, 'team7')).status).toBe(200);
    });

    it('gives the allowance back once the window has passed', async () => {
        const clock = makeClock();
        const app = appWithConsumers({ max: 1, clock });

        expect((await ping(app)).status).toBe(200);
        expect((await ping(app)).status).toBe(429);

        clock.advance(WINDOW_MS);
        expect((await ping(app)).status).toBe(200);
    });
});

describe('rate limiter placed after requireApiKey', () => {
    const appWithKeyCheck = () => {
        const app = express();
        app.get(
            '/ping',
            requireApiKey,
            createRateLimiter({ windowMs: WINDOW_MS, max: 3, now: makeClock().now }),
            (req, res) => res.json({ ok: true }),
        );
        return app;
    };

    it('does not count requests that were rejected for a missing or wrong key', async () => {
        const app = appWithKeyCheck();

        // Ten rejected requests must not use up the team's allowance of 3.
        for (let i = 0; i < 5; i++) expect((await request(app).get('/ping')).status).toBe(401);
        for (let i = 0; i < 5; i++) {
            expect((await request(app).get('/ping').set('X-API-Key', 'wrong')).status).toBe(401);
        }

        const withKey = () => request(app).get('/ping').set('X-API-Key', TEST_API_KEY);
        expect((await withKey()).status).toBe(200);
        expect((await withKey()).status).toBe(200);
        expect((await withKey()).status).toBe(200);
        expect((await withKey()).status).toBe(429);
    });
});