import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext.js';
import { apiFetch, streamEvents } from '../api.js';

// Keeps the logged-in user's wallet, orders and a feed of backend activity in sync with the server.
//
// How it stays correct:
//  1. On connect (and every reconnect, and whenever the tab becomes visible again) it reloads
//     GET /api/wallet and GET /api/orders/mine. That is the database's current state, full stop.
//  2. In between, the server pushes events over GET /api/events, but only AFTER each DB COMMIT,
//     so applying them can never show something the database rolled back.
//  3. Wallet updates are applied only if they're newer than what's on screen (ledger ids only grow
//     per user), so a late HTTP response can't overwrite a newer pushed balance.

const LiveContext = createContext(null);

const MAX_ACTIVITY = 30;
const MAX_RETRY_MS = 15000;

const sleep = (ms, signal) =>
    new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
    });

const LiveProvider = ({ children }) => {
    const { token } = useAuth();

    const [wallet, setWallet] = useState(null);       // { balance, currency, transactions, pesa }
    const [orders, setOrders] = useState([]);
    const [activity, setActivity] = useState([]);     // newest first
    const [connection, setConnection] = useState('offline'); // 'connecting' | 'live' | 'reconnecting' | 'offline'
    const [lastChange, setLastChange] = useState(null); // { amount, id } of the newest wallet movement, for the flash
    const [loadError, setLoadError] = useState('');

    const tokenRef = useRef(token);
    tokenRef.current = token;

    // Orders: every fetch gets a number and only the most recently STARTED one may apply its result.
    // An order event triggers a new fetch, which reads the DB after that event's COMMIT, so the
    // latest-started fetch is always at least as fresh as anything we've been told about.
    const ordersSeq = useRef(0);
    const loadOrders = useCallback(async () => {
        const t = tokenRef.current;
        if (!t) return;
        const seq = ++ordersSeq.current;
        const result = await apiFetch('/api/orders/mine', { token: t });
        if (seq === ordersSeq.current && tokenRef.current === t) setOrders(result);
    }, []);

    // Wallet snapshots from GET /api/wallet: never replace a newer state already on screen
    // (an event can arrive while the snapshot request is in flight). Ledger ids only grow per user.
    const applyWalletSnapshot = useCallback((snapshot) => {
        setWallet((current) => {
            const newestOnScreen = current?.transactions[0]?.id ?? 0;
            const newestInSnapshot = snapshot.transactions[0]?.id ?? 0;
            if (current && newestOnScreen > newestInSnapshot) {
                return { ...snapshot, balance: current.balance, transactions: current.transactions };
            }
            return snapshot;
        });
    }, []);

    // Reload everything from the database.
    const refresh = useCallback(async () => {
        const t = tokenRef.current;
        if (!t) return;
        try {
            const [w] = await Promise.all([apiFetch('/api/wallet', { token: t }), loadOrders()]);
            if (tokenRef.current !== t) return; // logged out meanwhile
            applyWalletSnapshot(w);
            setLoadError('');
        } catch (err) {
            setLoadError(err.message);
        }
    }, [loadOrders, applyWalletSnapshot]);

    // Applies a committed wallet change (from a pushed event or an HTTP response; whichever lands first).
    const applyWalletUpdate = useCallback(({ balance, transaction }) => {
        setWallet((current) => {
            if (!current) return current; // refresh() will load it
            const newest = current.transactions[0]?.id ?? 0;
            if (current.transactions.some((t) => t.id === transaction.id)) return current; // already shown
            if (transaction.id < newest) {
                // Older than what's on screen: keep it in the statement, but don't roll the balance back.
                const transactions = [...current.transactions, transaction].sort((a, b) => b.id - a.id);
                return { ...current, transactions };
            }
            return { ...current, balance, transactions: [transaction, ...current.transactions].slice(0, 50) };
        });
        setLastChange({ amount: transaction.amount, id: transaction.id });
    }, []);

    useEffect(() => {
        if (!token) {
            setWallet(null);
            setOrders([]);
            setActivity([]);
            setConnection('offline');
            setLastChange(null);
            return;
        }

        const controller = new AbortController();
        const { signal } = controller;

        const handleEvent = (event) => {
            if (event.type === 'stream.ready') {
                setConnection('live');
                refresh();
                return;
            }
            setActivity((prev) => [event, ...prev].slice(0, MAX_ACTIVITY));

            if (event.type === 'wallet.updated') {
                applyWalletUpdate(event.data);
            } else if (event.type === 'order.created') {
                loadOrders().catch(() => {});
            } else if (event.type === 'order.updated') {
                // Show it instantly, then confirm from the DB (also covers an order we haven't loaded yet).
                setOrders((prev) => prev.map((o) => (o.id === event.data.id ? { ...o, status: event.data.status } : o)));
                loadOrders().catch(() => {});
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

        // Coming back to the tab after a while: resync in case the stream was paused by the browser.
        const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            controller.abort();
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [token, refresh, loadOrders, applyWalletUpdate]);

    const topUp = useCallback(async (amount) => {
        const result = await apiFetch('/api/wallet/topup', { token: tokenRef.current, method: 'POST', body: { amount } });
        applyWalletUpdate(result);
        return result;
    }, [applyWalletUpdate]);

    return (
        <LiveContext.Provider value={{ wallet, orders, activity, connection, lastChange, loadError, refresh, topUp }}>
            {children}
        </LiveContext.Provider>
    );
};

const useLive = () => useContext(LiveContext);

export { LiveProvider, useLive };
