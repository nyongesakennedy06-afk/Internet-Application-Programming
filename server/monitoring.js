import crypto from 'node:crypto';

// Week 12: request logging and running totals.
//
//  monitor      writes ONE line of JSON per finished request and updates the totals.
//               It must be registered FIRST in app.js, so rejected requests (401, 429) are logged too.
//  statsHandler answers GET /api/stats with the totals (behind the API key).
//
// What is logged: time, method, path only (no query string), status, milliseconds, and a short
// fingerprint of the API key. Never keys, tokens, passwords, query strings or request bodies.
//
// Honest limit: the totals live in this server's memory, so they reset on restart and are not
// shared between several server copies.

const round = (n) => Math.round(n * 10) / 10;

const stats = {
    startedAt: new Date().toISOString(),
    total: 0,
    clientErrors: 0, // 4xx: usually the caller's mistake
    serverErrors: 0, // 5xx: our fault
    totalMs: 0,
    routes: {},
};

const newRoute = () => ({ count: 0, clientErrors: 0, serverErrors: 0, totalMs: 0, maxMs: 0 });

// A label for who called, without ever writing the key itself.
// requireApiKey sets req.apiKey only for a valid key, so wrong or missing keys show as "none".
function who(req) {
    if (!req.apiKey) return 'none';
    const hash = crypto.createHash('sha256').update(req.apiKey).digest('hex');
    return 'key-' + hash.slice(0, 6);
}

export function monitor(req, res, next) {
    const start = process.hrtime.bigint();
    // Read the path now: inside a mounted router Express shortens req.url, which would log "/" later.
    const path = req.path; // path only: never req.originalUrl, which includes the query string

    res.on('finish', () => { // after the response has gone out
        const ms = Number(process.hrtime.bigint() - start) / 1e6;

        // Jest runs many requests: keep the test output clean.
        if (process.env.NODE_ENV !== 'test') {
            console.log(JSON.stringify({
                time: new Date().toISOString(),
                method: req.method,
                path,
                status: res.statusCode,
                ms: round(ms),
                caller: who(req),
            }));
        }

        // Group by route pattern: /api/orders/1 and /api/orders/2 both become GET /api/orders/:id
        const pattern = req.route ? (req.baseUrl + req.route.path).replace(/(.)\/$/, '$1') : '(no route)';
        const label = `${req.method} ${pattern}`;
        const r = stats.routes[label] || newRoute();
        stats.routes[label] = r;

        stats.total += 1;
        stats.totalMs += ms;
        r.count += 1;
        r.totalMs += ms;
        r.maxMs = Math.max(r.maxMs, ms);
        if (res.statusCode >= 500) {
            stats.serverErrors += 1;
            r.serverErrors += 1;
        } else if (res.statusCode >= 400) {
            stats.clientErrors += 1;
            r.clientErrors += 1;
        }
    });

    next();
}

export function statsHandler(req, res) {
    const routes = {};
    for (const [label, r] of Object.entries(stats.routes)) {
        routes[label] = {
            count: r.count,
            clientErrors: r.clientErrors,
            serverErrors: r.serverErrors,
            avgMs: round(r.totalMs / r.count),
            maxMs: round(r.maxMs),
        };
    }
    const rate = stats.total ? (stats.serverErrors / stats.total) * 100 : 0;
    const avg = stats.total ? stats.totalMs / stats.total : 0;

    res.json({
        startedAt: stats.startedAt,
        uptimeSeconds: Math.round(process.uptime()),
        total: stats.total,
        clientErrors: stats.clientErrors,
        serverErrors: stats.serverErrors,
        errorRatePercent: round(rate),
        avgMs: round(avg),
        routes,
    });
}