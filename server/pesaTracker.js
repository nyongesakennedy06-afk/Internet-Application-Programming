import { fetchWithRetry, describeFailure } from './resilientFetch.js';

// Settings are read on each call, so a change in .env only needs a server restart.
//   PESA_TIMEOUT_MS         how long a read (GET) may take per attempt           (default 1500)
//   PESA_WRITE_TIMEOUT_MS   how long a write (POST) may take. Longer, because a write that is
//                           cut off early may already have gone through, and it is never retried (default 5000)
//   PESA_RETRIES            retries for reads after a timeout or 5xx/429          (default 2)
//   PESA_RETRY_DELAY_MS     first wait between attempts, doubled each time        (default 200)
const intFrom = (value, fallback, min) => {
    if (value === undefined || value === '') return fallback;
    const n = Number(value);
    return Number.isInteger(n) && n >= min ? n : fallback;
};
const settings = () => ({
    timeoutMs: intFrom(process.env.PESA_TIMEOUT_MS, 1500, 1),
    writeTimeoutMs: intFrom(process.env.PESA_WRITE_TIMEOUT_MS, 5000, 1),
    retries: intFrom(process.env.PESA_RETRIES, 2, 0),
    delayMs: intFrom(process.env.PESA_RETRY_DELAY_MS, 200, 0),
});

export class PesaTrackerError extends Error {
    constructor(message, { status = null, code = null } = {}) {
        super(message);
        this.name = 'PesaTrackerError';
        this.status = status;
        this.code = code;
    }
}

export const isEnabled = () => Boolean(process.env.PESA_TRACKER_URL);

// label is a key-free description for the log, e.g. "GET /users/{id}/budget".
async function call(method, path, body, label) {
    const baseUrl = process.env.PESA_TRACKER_URL.replace(/\/+$/, '');
    const { timeoutMs, writeTimeoutMs, retries, delayMs } = settings();

    let res;
    try {
        res = await fetchWithRetry(`${baseUrl}${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.PESA_TRACKER_TOKEN || 'test'}`,
                'X-API-Key': process.env.PESA_TRACKER_API_KEY || '',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        }, {
            timeoutMs: method === 'GET' ? timeoutMs : writeTimeoutMs,
            retries,
            delayMs,
            label: `Pesa Tracker ${label}`,
        });
    } catch (err) {
        const reason = describeFailure(err);
        console.error(`Pesa Tracker ${label} failed: ${reason}`);
        throw new PesaTrackerError(
            reason === 'timeout' ? 'Pesa Tracker did not answer in time' : 'Pesa Tracker could not be reached',
            { code: reason === 'timeout' ? 'TIMEOUT' : 'UNREACHABLE' }
        );
    }

    let data = null;
    try {
        data = await res.json();
    } catch {
    }

    if (!res.ok) {
        // 404 (no budget) and 422 (budget exceeded) are normal answers, not failures. Log everything else.
        if (res.status !== 404 && res.status !== 422) {
            console.error(`Pesa Tracker ${label} failed: HTTP ${res.status}`);
        }
        throw new PesaTrackerError(data?.message ?? `Pesa Tracker returned HTTP ${res.status}`, {
            status: res.status,
            code: data?.code ?? null,
        });
    }
    return data;
}

export async function getBudget(pesaUserId) {
    const budget = await call('GET', `/users/${encodeURIComponent(pesaUserId)}/budget`, undefined, 'GET /users/{id}/budget');
    return { ...budget, monthlyLimit: Number(budget.monthlyLimit), remaining: Number(budget.remaining) };
}


export async function recordTransaction(pesaUserId, { orderId, amount, items }) {
    return call('POST', `/users/${encodeURIComponent(pesaUserId)}/transactions`, {
        orderId,
        amount,
        items,
        currency: 'KES',
    }, 'POST /users/{id}/transactions');
}