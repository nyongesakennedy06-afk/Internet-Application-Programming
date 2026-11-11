// traffic.js: sends a mix of requests to the API, to give the log and /stats some data (Week 12).
//
// Run from the server folder:
//   API=http://localhost:4000 KEY=<your-key> node tools/traffic.js
//   N=200 ... for more requests (you may then see 429s from the rate limit: that is data too)
//
// Uses an existing user id (USER_ID, default 1) and a real cafeteria id (CAFE_ID, default cafe-1).
// Only GET requests: it never places orders.
const API = process.env.API || 'http://localhost:4000';
const KEY = process.env.KEY;
const N = Number(process.env.N || 60);
const USER_ID = process.env.USER_ID || 1;
const CAFE_ID = process.env.CAFE_ID || 'cafe-1';

if (!KEY) {
    console.error('Set KEY=<your-api-key> first.');
    process.exit(1);
}

const mix = [
    { path: '/api/cafeterias', key: false },                                           // public, no key needed
    { path: '/api/cafeterias', key: false },
    { path: `/api/cafeterias/${CAFE_ID}`, key: false },
    { path: `/api/orders?userId=${USER_ID}&fields=timestamp`, key: true },
    { path: `/api/orders?userId=${USER_ID}&fields=location`, key: true },
    { path: `/api/users/${USER_ID}/order-frequency?locationId=${CAFE_ID}`, key: true },
    { path: '/api/orders?userId=999999&fields=timestamp', key: true },                // no such user: 404
    { path: '/api/orders?userId=1&fields=oops', key: true },                          // bad fields: 400
    { path: `/api/orders?userId=${USER_ID}&fields=timestamp`, key: false },           // no key: 401
    { path: '/api/not-a-route', key: true },                                          // no such path: 404
];

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const counts = {};
for (let i = 0; i < N; i++) {
    const r = mix[Math.floor(Math.random() * mix.length)];
    try {
        const res = await fetch(API + r.path, { headers: r.key ? { 'X-API-Key': KEY } : {} });
        counts[res.status] = (counts[res.status] || 0) + 1;
    } catch {
        counts.failed = (counts.failed || 0) + 1;
    }
    await pause(50);
}
console.log('Status codes received:', counts);