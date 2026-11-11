// A fetch that survives a slow or flaky partner (Week 11).
//
//  - Every attempt has a timeout.
//  - Retries (default 2) happen for timeouts, connection failures and 429/500/502/503/504.
//  - Waits between attempts: delayMs, then double (200 ms, then 400 ms). A 429 with a
//    Retry-After header waits that long instead (at most 5 seconds).
//  - Never retries 4xx answers (the request is wrong, asking again changes nothing).
//  - Never retries anything but GET: a repeated POST could do the work twice.
//
// Worst case a caller waits:  (retries + 1) x timeoutMs + the waits
//   e.g. 3 x 1500 + 200 + 400 = 5100 ms

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A short, key-free reason for logs: "timeout", a network code such as ECONNREFUSED, or the error text.
export const describeFailure = (err) =>
    err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code || err?.message || 'unknown error');

export async function fetchWithRetry(url, options = {}, config = {}) {
    const { timeoutMs = 1500, retries = 2, delayMs = 200, label } = config;
    const method = (options.method || 'GET').toUpperCase();
    const maxRetries = method === 'GET' ? retries : 0; // never retry writes
    const name = label || method;

    for (let attempt = 0; ; attempt++) {
        let wait = delayMs * 2 ** attempt;
        let why;
        try {
            const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
            if (!RETRY_STATUSES.has(res.status) || attempt >= maxRetries) return res;

            why = `HTTP ${res.status}`;
            try { await res.body?.cancel(); } catch { /* nothing to free */ }
            const retryAfter = Number(res.headers.get('Retry-After'));
            if (res.status === 429 && retryAfter > 0) {
                wait = Math.min(retryAfter * 1000, 5000);
            }
        } catch (err) {
            if (attempt >= maxRetries) throw err; // out of retries
            why = describeFailure(err);
        }
        console.warn(`${name} failed (${why}), retrying in ${wait} ms (retry ${attempt + 1} of ${maxRetries})`);
        await sleep(wait);
    }
}