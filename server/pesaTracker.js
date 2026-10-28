const TIMEOUT_MS = 5000;
 
export class PesaTrackerError extends Error {
    constructor(message, { status = null, code = null } = {}) {
        super(message);
        this.name = 'PesaTrackerError';
        this.status = status;
        this.code = code;
    }
}
 
export const isEnabled = () => Boolean(process.env.PESA_TRACKER_URL);
 
async function call(method, path, body) {
    const baseUrl = process.env.PESA_TRACKER_URL.replace(/\/+$/, '');
 
    let res;
    try {
        res = await fetch(`${baseUrl}${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.PESA_TRACKER_TOKEN || 'test'}`,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch {
        throw new PesaTrackerError('Pesa Tracker could not be reached', { code: 'UNREACHABLE' });
    }
 
    let data = null;
    try {
        data = await res.json();
    } catch {
    }
 
    if (!res.ok) {
        throw new PesaTrackerError(data?.message ?? `Pesa Tracker returned HTTP ${res.status}`, {
            status: res.status,
            code: data?.code ?? null,
        });
    }
    return data;
}
 
export async function getBudget(pesaUserId) {
    const budget = await call('GET', `/users/${encodeURIComponent(pesaUserId)}/budget`);
    return { ...budget, monthlyLimit: Number(budget.monthlyLimit), remaining: Number(budget.remaining) };
}
 

export async function recordTransaction(pesaUserId, { orderId, amount, items }) {
    return call('POST', `/users/${encodeURIComponent(pesaUserId)}/transactions`, {
        orderId,
        amount,
        items,
        currency: 'KES',
    });
}
