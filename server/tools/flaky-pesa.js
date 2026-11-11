// A stand-in for Pesa Tracker that you can make slow, flaky or broken while it runs (Week 11 drill).
// It is a separate little program, not part of the app. Run it from the server folder:
//
//     node tools/flaky-pesa.js
//
// Then set  PESA_TRACKER_URL=http://localhost:4100/v1  in server/.env and restart the server.
// Switch behaviour without restarting (PowerShell: use curl.exe):
//
//     curl.exe http://localhost:4100/__mode/ok      answers normally
//     curl.exe http://localhost:4100/__mode/slow    answers after 10 seconds
//     curl.exe http://localhost:4100/__mode/flaky   fails twice (503), then works, repeating
//     curl.exe http://localhost:4100/__mode/error   always answers 500
//
// Every call is printed here, so you can count how often the app calls it.
import http from 'node:http';

const PORT = 4100;
let mode = 'ok';
let calls = 0;
let remaining = 8500;

const send = (res, status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
};

http.createServer(async (req, res) => {
    const modeSwitch = req.url.match(/^\/__mode\/(ok|slow|flaky|error)$/);
    if (modeSwitch) {
        mode = modeSwitch[1];
        calls = 0;
        console.log(`--- mode is now ${mode}`);
        return send(res, 200, { mode });
    }

    calls += 1;
    console.log(`${new Date().toLocaleTimeString()}  ${req.method} ${req.url}  (call ${calls}, mode ${mode})`);

    if (mode === 'slow') await new Promise((r) => setTimeout(r, 10000));
    if (mode === 'flaky' && calls % 3 !== 0) return send(res, 503, { code: 'UNAVAILABLE', message: 'Try again' });
    if (mode === 'error') return send(res, 500, { code: 'INTERNAL_ERROR', message: 'Internal error' });

    if (req.method === 'GET' && /^\/v1\/users\/[^/]+\/budget$/.test(req.url)) {
        return send(res, 200, { userId: 'usr_stand_in', monthlyLimit: 13000, remaining, currency: 'KES', updatedAt: new Date().toISOString() });
    }
    if (req.method === 'POST' && /^\/v1\/users\/[^/]+\/transactions$/.test(req.url)) {
        let raw = '';
        req.on('data', (c) => (raw += c));
        await new Promise((r) => req.on('end', r));
        const body = raw ? JSON.parse(raw) : {};
        remaining -= Number(body.amount) || 0;
        return send(res, 201, { id: `txn_${Date.now()}`, userId: 'usr_stand_in', orderId: body.orderId, amount: body.amount, items: body.items, currency: 'KES', createdAt: new Date().toISOString() });
    }
    send(res, 404, { code: 'NOT_FOUND', message: 'No route.' });
}).listen(PORT, () => console.log(`Stand-in Pesa Tracker on http://localhost:${PORT}/v1  (mode ${mode})`));