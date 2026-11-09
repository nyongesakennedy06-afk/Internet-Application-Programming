import { EventEmitter } from 'node:events';

// Live updates for the website. Route handlers call publish() AFTER their DB transaction has
// committed, and every browser tab the user has open (connected to GET /api/events) receives it.
//
// Rule: never publish before COMMIT. If we did, the page could show an order or a balance that
// the database then rolled back, and the whole point of this is that the page matches the DB.
//
// Note: this lives in memory, so it only reaches clients connected to this same Node process.
// If you ever run more than one server instance, swap this for Redis pub/sub (same two functions).

const bus = new EventEmitter();
bus.setMaxListeners(0); // one listener per open tab; no artificial cap

let sequence = 0;

const channel = (userId) => `user:${userId}`;

/**
 * @param {number} userId  who should see it
 * @param {string} type    'wallet.updated' (a purchase was recorded) or 'order.updated' (an order's status changed)
 * @param {object} data    payload for the client
 */
export function publish(userId, type, data) {
    const event = { id: ++sequence, type, at: new Date().toISOString(), data };
    bus.emit(channel(userId), event);
    return event;
}

export function subscribe(userId, listener) {
    bus.on(channel(userId), listener);
    return () => bus.off(channel(userId), listener);
}

export function listenerCount(userId) {
    return bus.listenerCount(channel(userId));
}