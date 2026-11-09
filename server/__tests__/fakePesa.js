import http from 'node:http';

// A tiny stand-in for Pesa Tracker (Team 8) that follows their openapi.yaml, so tests never contact the real
// service and never create fake purchases on your partner's system.
//
//   const fake = await startFakePesa();
//   process.env.PESA_TRACKER_URL = fake.url;
//   fake.state.remaining = 8500;      // what GET /users/{id}/budget reports (and POST /transactions deducts from)
//   fake.state.mode = 'server-error'; // 'ok' | 'reject-transactions' | 'server-error' | 'unknown-user'
//   fake.state.requests               // everything it received, in order
export async function startFakePesa() {
    const state = { remaining: 100000, mode: 'ok', requests: [] };
    let transactionNumber = 0;

    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', () => {
            const body = raw ? JSON.parse(raw) : undefined;
            state.requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
            const send = (status, payload) => {
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(payload));
            };

            if (state.mode === 'server-error') return send(500, { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' });
            if (state.mode === 'unknown-user') return send(404, { code: 'NOT_FOUND', message: 'No budget found for user.' });

            if (req.method === 'GET' && /^\/v1\/users\/[^/]+\/budget$/.test(req.url)) {
                return send(200, { userId: 'usr_test', monthlyLimit: 13000, remaining: state.remaining, currency: 'KES', updatedAt: '2026-09-07T14:32:00Z' });
            }
            if (req.method === 'POST' && /^\/v1\/users\/[^/]+\/transactions$/.test(req.url)) {
                if (state.mode === 'reject-transactions' || body.amount > state.remaining) {
                    return send(422, { code: 'BUDGET_EXCEEDED', message: "This transaction would put the user's budget below zero." });
                }
                state.remaining -= body.amount;
                transactionNumber += 1;
                return send(201, {
                    id: `txn_${String(transactionNumber).padStart(8, '0')}`,
                    userId: 'usr_test',
                    orderId: body.orderId,
                    amount: body.amount,
                    items: body.items,
                    currency: 'KES',
                    createdAt: '2026-09-07T13:05:02Z',
                });
            }
            send(404, { code: 'NOT_FOUND', message: 'No route.' });
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    return {
        url: `http://127.0.0.1:${server.address().port}/v1`,
        state,
        reset() {
            state.remaining = 100000;
            state.mode = 'ok';
            state.requests = [];
        },
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

// A URL where nothing is listening, for "Pesa Tracker is unreachable" tests.
export async function deadPesaUrl() {
    const dead = http.createServer();
    await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
    const port = dead.address().port;
    await new Promise((resolve) => dead.close(resolve));
    return `http://127.0.0.1:${port}/v1`;
}