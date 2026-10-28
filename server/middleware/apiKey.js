/**
 * API-key authentication middleware.
 *
 * Expects the caller to send:   X-API-Key: <key>
 * Keys are loaded from the API_KEYS env var (format: "name1:key1,name2:key2").
 *
 * Behaviour:
 *  - Missing header           → 401 "API key is required"
 *  - Key not recognised       → 401 "Invalid API key"
 *  - API_KEYS env var missing → every request is rejected (fail-closed)
 *  - Valid key                → sets req.apiConsumer to the consumer name, calls next()
 */

// ── Parse keys once at startup ──────────────────────────────────────────────
const apiKeys = new Map();

const raw = process.env.API_KEYS ?? '';
if (raw.trim()) {
    for (const entry of raw.split(',')) {
        const colonIndex = entry.indexOf(':');
        if (colonIndex > 0) {
            const name = entry.slice(0, colonIndex).trim();
            const key  = entry.slice(colonIndex + 1).trim();
            if (name && key) apiKeys.set(key, name);
        }
    }
}

// ── Middleware ───────────────────────────────────────────────────────────────
export const requireApiKey = (req, res, next) => {
    // Fail-closed: if no keys were loaded, reject everything.
    if (apiKeys.size === 0) {
        return res.status(401).json({ error: 'API key authentication is not configured' });
    }

    const provided = req.headers['x-api-key'];

    if (!provided) {
        return res.status(401).json({ error: 'API key is required' });
    }

    const consumer = apiKeys.get(provided);
    if (!consumer) {
        return res.status(401).json({ error: 'Invalid API key' });
    }

    // Attach the consumer name so later middleware / handlers can log it.
    req.apiConsumer = consumer;
    next();
};
