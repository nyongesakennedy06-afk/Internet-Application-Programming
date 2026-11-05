// One place for the backend address. Override it with VITE_API_URL in a .env file if needed.
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

// fetch() wrapper: adds JSON + auth headers, and throws ApiError with the server's message on failure.
export async function apiFetch(path, { token, method = 'GET', body, signal } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        throw new ApiError(data?.error ?? `Request failed (HTTP ${res.status})`, res.status);
    }
    return data;
}

// Reads the server's live event stream (GET /api/events) and calls onEvent for each event.
// Uses fetch rather than EventSource so the login token goes in a header, not the URL.
// Resolves when the server closes the stream; rejects on network errors or a non-200 answer.
export async function streamEvents(token, { signal, onEvent }) {
    const res = await fetch(`${API_URL}/api/events`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal,
    });
    if (!res.ok || !res.body) {
        throw new ApiError(`Live updates unavailable (HTTP ${res.status})`, res.status);
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value;

        // SSE messages are separated by a blank line; a message may span several "data:" lines.
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = block
                .split('\n')
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trimStart())
                .join('\n');
            if (data) onEvent(JSON.parse(data));
        }
    }
}

const kes = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 2 });
export const formatKES = (amount) => `KES ${kes.format(amount)}`;
export const formatSignedKES = (amount) => `${amount > 0 ? '+' : amount < 0 ? '−' : ''}KES ${kes.format(Math.abs(amount))}`;
