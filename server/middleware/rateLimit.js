/**
 * Rate-limiting middleware (Week 9).
 *
 * Each API consumer (team) gets its own allowance of requests per time window.
 * It is meant to run AFTER requireApiKey, which sets req.apiConsumer.
 *
 * Settings (environment variables, read on the first request):
 *   RATE_LIMIT_MAX         requests allowed per window per consumer   (default 100)
 *   RATE_LIMIT_WINDOW_MS   window length in milliseconds              (default 60000)
 *
 * Behaviour:
 *  - Within the limit   → calls next()
 *  - Over the limit     → 429, a Retry-After header (whole seconds) and
 *                         { "error": "Too many requests", "retryAfter": <seconds> }
 *  - The window starts at a consumer's first request and resets when it ends.
 *
 * Honest limits: counts live in this server's memory, so they reset when the
 * server restarts and are not shared between several server copies. Production
 * systems keep them in a shared store such as Redis.
 */

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 100;

const readPositiveInt = (value, fallback) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : fallback;
};

export const createRateLimiter = ({
    windowMs = DEFAULT_WINDOW_MS,
    max = DEFAULT_MAX,
    now = Date.now, // replaceable so tests can control the clock
} = {}) => {
    const hits = new Map(); // consumer -> { count, resetAt }
    let nextSweepAt = now() + windowMs;

    // Drop finished windows now and then so the map cannot grow forever.
    const sweep = (time) => {
        if (time < nextSweepAt) return;
        for (const [id, entry] of hits) {
            if (time >= entry.resetAt) hits.delete(id);
        }
        nextSweepAt = time + windowMs;
    };

    return (req, res, next) => {
        const time = now();
        sweep(time);

        // Normally the consumer name set by requireApiKey. The IP is only a fallback.
        const id = req.apiConsumer || req.ip;

        let entry = hits.get(id);
        if (!entry || time >= entry.resetAt) {
            entry = { count: 0, resetAt: time + windowMs };
            hits.set(id, entry);
        }

        entry.count += 1;

        if (entry.count > max) {
            const retryAfter = Math.max(1, Math.ceil((entry.resetAt - time) / 1000));
            res.set('Retry-After', String(retryAfter));
            return res.status(429).json({ error: 'Too many requests', retryAfter });
        }

        next();
    };
};

// One shared limiter for the Team 10 endpoints, so a team's allowance is counted
// across both of them. It is created on the first request, after .env is loaded.
let sharedLimiter;
export const rateLimit = (req, res, next) => {
    sharedLimiter ??= createRateLimiter({
        windowMs: readPositiveInt(process.env.RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
        max: readPositiveInt(process.env.RATE_LIMIT_MAX, DEFAULT_MAX),
    });
    return sharedLimiter(req, res, next);
};