import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext.js';
import { apiFetch, streamEvents } from '../api.js';

// Keeps the logged-in user's wallet (remaining food budget + transactions) in sync with the server.
//
// The wallet is read-only. It always comes from GET /api/wallet, which reads the budget live from
// Pesa Tracker. It is reloaded:
//   - as soon as the user is logged in, and again when the live connection opens (and every reconnect),
//   - when the tab becomes visible again,
//   - when the server says 'wallet.updated' (a purchase was recorded) or 'order.updated' (a status
//     changed). The server only sends these AFTER the database commit,
//   - after you place an order (CheckoutPage calls refresh()).
// Every reload gets a number and only the most recently STARTED one may apply its result, so a slow
// response can never overwrite a newer one.

const LiveContext = createContext(null);

const MAX_RETRY_MS = 15000;

const sleep = (ms, signal) =>
    new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
    });

const LiveProvider = ({ children }) => {
    const { token } = useAuth();

    const [wallet, setWallet] = useState(null);       // { status, remaining, currency, transactions }
    const [connection, setConnection] = useState('offline'); // 'connecting' | 'live' | 'reconnecting' | 'offline'
    const [flashKey, setFlashKey] = useState(0);       // goes up whenever the remaining amount changes, to replay the highlight
    const [loadError, setLoadError] = useState('');

    const tokenRef = useRef(token);
    tokenRef.current = token;

    const walletSeq = useRef(0);
    const lastRemaining = useRef(null);

    // Reload the wallet from the server.
    const refresh = useCallback(async () => {
        const t = tokenRef.current;
        if (!t) return;
        const seq = ++walletSeq.current;
        try {
            const result = await apiFetch('/api/wallet', { token: t });
            if (seq !== walletSeq.current || tokenRef.current !== t) return; // a newer reload started, or logged out
            const previous = lastRemaining.current;
            lastRemaining.current = result.remaining;
            if (previous != null && result.remaining != null && result.remaining !== previous) {
                setFlashKey((k) => k + 1);
            }
            setWallet(result);
            setLoadError('');
        } catch (err) {
            if (seq === walletSeq.current && tokenRef.current === t) setLoadError(err.message);
        }
    }, []);

    useEffect(() => {
        if (!token) {
            walletSeq.current += 1; // ignore any reload still in flight
            lastRemaining.current = null;
            setWallet(null);
            setConnection('offline');
            setFlashKey(0);
            setLoadError('');
            return;
        }

        const controller = new AbortController();
        const { signal } = controller;

        // Load right away, so the wallet shows even if the live connection is slow or blocked.
        refresh();

        const handleEvent = (event) => {
            if (event.type === 'stream.ready') {
                setConnection('live');
                refresh();
            } else if (event.type === 'wallet.updated' || event.type === 'order.updated') {
                refresh();
            }
        };

        (async () => {
            let attempt = 0;
            while (!signal.aborted) {
                setConnection(attempt === 0 ? 'connecting' : 'reconnecting');
                try {
                    await streamEvents(token, {
                        signal,
                        onEvent: (e) => { attempt = 0; handleEvent(e); },
                    });
                } catch (err) {
                    if (signal.aborted) return;
                    if (err.status === 401) { setConnection('offline'); return; } // token expired; AuthContext handles it
                }
                if (signal.aborted) return;
                attempt += 1;
                setConnection('reconnecting');
                await sleep(Math.min(MAX_RETRY_MS, 1000 * 2 ** attempt), signal);
            }
        })();

        // Coming back to the tab after a while: reload in case the stream was paused by the browser.
        const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            controller.abort();
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [token, refresh]);

    return (
        <LiveContext.Provider value={{ wallet, connection, flashKey, loadError, refresh }}>
            {children}
        </LiveContext.Provider>
    );
};

const useLive = () => useContext(LiveContext);

export { LiveProvider, useLive };