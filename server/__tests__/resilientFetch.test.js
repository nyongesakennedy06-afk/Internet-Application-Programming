import { jest } from '@jest/globals';
import http from 'node:http';
import { fetchWithRetry, describeFailure } from '../resilientFetch.js';

// Each test starts a tiny stand-in partner whose answers it controls, so nothing real is contacted.
const servers = [];
async function startPartner(handler) {
    const state = { calls: 0 };
    const server = http.createServer((req, res) => {
        state.calls += 1;
        handler(state.calls, req, res);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    state.url = `http://127.0.0.1:${server.address().port}/thing`;
    return state;
}
const json = (res, status, body = {}, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
};

// Short waits so the tests are fast. The rules are the same as with the real 200 ms / 400 ms.
const FAST = { timeoutMs: 1000, retries: 2, delayMs: 1 };

let warn;
beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });
afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise((resolve) => { s.closeAllConnections(); s.close(resolve); })));
});

describe('fetchWithRetry', () => {
    it('retries a flaky partner (503, 503, then 200) and the caller sees success', async () => {
        const partner = await startPartner((n, req, res) => (n < 3 ? json(res, 503) : json(res, 200, { ok: true })));

        const res = await fetchWithRetry(partner.url, {}, FAST);

        expect(res.status).toBe(200);
        expect(partner.calls).toBe(3);
        expect(warn).toHaveBeenCalledTimes(2); // one "retrying" line per retry
    });

    it('stops after exactly 2 retries when the partner always fails, and hands back the last answer', async () => {
        const partner = await startPartner((n, req, res) => json(res, 500));

        const res = await fetchWithRetry(partner.url, {}, FAST);

        expect(res.status).toBe(500);
        expect(partner.calls).toBe(3); // 1 attempt + 2 retries, never more
    });

    it.each([400, 401, 403, 404])('does not retry a %i (the request itself is wrong)', async (status) => {
        const partner = await startPartner((n, req, res) => json(res, status));

        const res = await fetchWithRetry(partner.url, {}, FAST);

        expect(res.status).toBe(status);
        expect(partner.calls).toBe(1);
    });

    it('never retries a write (POST), even when the partner answers 503', async () => {
        const partner = await startPartner((n, req, res) => json(res, 503));

        const res = await fetchWithRetry(partner.url, { method: 'POST', body: '{}' }, FAST);

        expect(res.status).toBe(503);
        expect(partner.calls).toBe(1);
    });

    it('cuts off a slow partner at the timeout, retries, then throws a TimeoutError', async () => {
        const partner = await startPartner(() => { /* never answers */ });

        const started = Date.now();
        await expect(fetchWithRetry(partner.url, {}, { timeoutMs: 100, retries: 1, delayMs: 1 }))
            .rejects.toMatchObject({ name: 'TimeoutError' });

        expect(partner.calls).toBe(2); // 1 attempt + 1 retry
        expect(Date.now() - started).toBeLessThan(2000); // nowhere near "wait for the partner forever"
    });

    it('retries a connection failure, then throws', async () => {
        const dead = http.createServer();
        await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
        const url = `http://127.0.0.1:${dead.address().port}/thing`;
        await new Promise((resolve) => dead.close(resolve)); // now nothing is listening

        await expect(fetchWithRetry(url, {}, FAST)).rejects.toBeDefined();
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it('waits for Retry-After on a 429, then succeeds', async () => {
        const partner = await startPartner((n, req, res) =>
            (n === 1 ? json(res, 429, {}, { 'Retry-After': '1' }) : json(res, 200)));

        const started = Date.now();
        const res = await fetchWithRetry(partner.url, {}, FAST);

        expect(res.status).toBe(200);
        expect(partner.calls).toBe(2);
        expect(Date.now() - started).toBeGreaterThanOrEqual(900); // waited the ~1 s it was asked to
    });

    it('does not retry at all when retries is 0', async () => {
        const partner = await startPartner((n, req, res) => json(res, 503));

        const res = await fetchWithRetry(partner.url, {}, { ...FAST, retries: 0 });

        expect(res.status).toBe(503);
        expect(partner.calls).toBe(1);
    });
});

describe('describeFailure', () => {
    it('says "timeout" for a timeout and uses the network code otherwise', () => {
        expect(describeFailure(new DOMException('timed out', 'TimeoutError'))).toBe('timeout');
        expect(describeFailure(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))).toBe('ECONNREFUSED');
        expect(describeFailure(new Error('boom'))).toBe('boom');
    });
});