import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { subscribe } from '../events.js';

const router = express.Router();

const HEARTBEAT_MS = 25000;

// GET /api/events  — Server-Sent Events stream of everything that happens to the logged-in user.
// Auth is the normal "Authorization: Bearer <token>" header. (The browser's built-in EventSource
// can't send headers, so the frontend reads this stream with fetch() instead; that keeps the JWT
// out of URLs and server logs.)
router.get('/', requireAuth, (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // stop nginx-style proxies from buffering the stream
    });
    res.flushHeaders();

    const send = (event) => res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);

    // Tells the client the stream is open; it then reloads /api/wallet to catch anything it missed.
    send({ id: 0, type: 'stream.ready', at: new Date().toISOString(), data: {}, trace: [] });

    const unsubscribe = subscribe(req.user.id, send);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);

    req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
    });
});

export default router;
