import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLive } from '../context/LiveContext.js';
import { CONNECTION_LABEL } from '../components/WalletChip.js';
import { formatKES, formatSignedKES } from '../api.js';

const QUICK_AMOUNTS = [200, 500, 1000];
const MAX_TOPUP = 50000; // mirrors the server's limit; the server still checks

const time = (iso) => new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateTime = (iso) =>
    new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const describeEvent = (event) => {
    switch (event.type) {
        case 'wallet.updated': {
            const { amount, balance_after } = event.data.transaction;
            return amount > 0
                ? `Added ${formatKES(amount)} to your wallet. Balance ${formatKES(balance_after)}.`
                : `Paid ${formatKES(-amount)} from your wallet. Balance ${formatKES(balance_after)}.`;
        }
        case 'order.created':
            return `Order #${event.data.order.id} placed for ${formatKES(event.data.order.total_amount)}.`;
        case 'order.updated':
            return `Order #${event.data.id} is now ${event.data.status}.`;
        case 'order.rejected':
            return `Order not placed: ${event.data.error}`;
        default:
            return event.type;
    }
};

const BalancePanel = () => {
    const { wallet, connection, lastChange, topUp } = useLive();
    const [custom, setCustom] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const add = async (amount) => {
        setError('');
        if (!Number.isInteger(amount) || amount < 1 || amount > MAX_TOPUP) {
            setError(`Enter a whole amount between 1 and ${MAX_TOPUP.toLocaleString('en-KE')}.`);
            return;
        }
        setBusy(true);
        try {
            await topUp(amount);
            setCustom('');
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="balance-panel" aria-labelledby="balance-heading">
            <div className="balance-panel-top">
                <h1 id="balance-heading" className="balance-panel-label">Wallet balance</h1>
                <span className="balance-panel-status">
                    <span className={`live-dot live-dot--${connection}`} aria-hidden="true" />
                    {CONNECTION_LABEL[connection]}
                </span>
            </div>

            <div className="balance-panel-figure">
                <span className="balance-panel-amount">{wallet ? formatKES(wallet.balance) : 'KES …'}</span>
                <span className="balance-panel-delta-slot" aria-live="polite">
                    {lastChange && (
                        <span key={lastChange.id} className={lastChange.amount > 0 ? 'balance-delta balance-delta--in' : 'balance-delta'}>
                            {formatSignedKES(lastChange.amount)}
                        </span>
                    )}
                </span>
            </div>

            {wallet?.pesa && (
                <p className="balance-panel-pesa">
                    {!wallet.pesa.available && 'Pesa Tracker food budget: unavailable right now.'}
                    {wallet.pesa.available && wallet.pesa.budgetSet === false && 'Pesa Tracker: no food budget set.'}
                    {wallet.pesa.available && wallet.pesa.budgetSet !== false &&
                        `Pesa Tracker food budget: ${formatKES(wallet.pesa.remaining)} left of ${formatKES(wallet.pesa.monthlyLimit)}.`}
                </p>
            )}

            <div className="topup">
                <p className="topup-label">Add funds</p>
                <div className="topup-row">
                    {QUICK_AMOUNTS.map((amount) => (
                        <button key={amount} type="button" className="topup-quick" disabled={busy} onClick={() => add(amount)}>
                            +{amount.toLocaleString('en-KE')}
                        </button>
                    ))}
                </div>
                <form
                    className="topup-row"
                    onSubmit={(e) => { e.preventDefault(); add(Number(custom)); }}
                >
                    <label className="visually-hidden" htmlFor="topup-amount">Amount in KES</label>
                    <input
                        id="topup-amount"
                        className="topup-input"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max={MAX_TOPUP}
                        step="1"
                        placeholder="Other amount"
                        value={custom}
                        onChange={(e) => setCustom(e.target.value)}
                    />
                    <button type="submit" className="topup-submit" disabled={busy || custom === ''}>
                        {busy ? 'Adding…' : 'Add funds'}
                    </button>
                </form>
                {error && <p className="topup-error" role="alert">{error}</p>}
                <p className="topup-note">Top-ups are simulated in this build; no real money moves.</p>
            </div>
        </section>
    );
};

const Statement = () => {
    const { wallet } = useLive();
    const rows = wallet?.transactions ?? [];

    return (
        <section className="wallet-section" aria-labelledby="statement-heading">
            <h2 id="statement-heading" className="wallet-section-title">Statement</h2>
            {rows.length === 0 ? (
                <p className="wallet-empty">No transactions yet. Add funds above, then order from any cafeteria.</p>
            ) : (
                <div className="table-scroll">
                    <table className="statement">
                        <thead>
                            <tr>
                                <th scope="col">When</th>
                                <th scope="col">Details</th>
                                <th scope="col" className="num">Amount</th>
                                <th scope="col" className="num">Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((t) => (
                                <tr key={t.id}>
                                    <td>{dateTime(t.created_at)}</td>
                                    <td>{t.type === 'topup' ? 'Top-up' : t.description}</td>
                                    <td className={t.amount > 0 ? 'num amount-in' : 'num'}>{formatSignedKES(t.amount)}</td>
                                    <td className="num">{formatKES(t.balance_after)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
};

const Orders = () => {
    const { orders } = useLive();

    return (
        <section className="wallet-section" aria-labelledby="orders-heading">
            <h2 id="orders-heading" className="wallet-section-title">Your orders</h2>
            {orders.length === 0 ? (
                <p className="wallet-empty">No orders yet. <Link to="/">Browse cafeterias</Link> to place one.</p>
            ) : (
                <ul className="order-list">
                    {orders.map((o) => (
                        <li key={o.id} className="order-row">
                            <div>
                                <p className="order-row-title">#{o.id} at {o.cafeteria_name}</p>
                                <p className="order-row-items">
                                    {o.items.map((i) => (i.quantity > 1 ? `${i.item_name} ×${i.quantity}` : i.item_name)).join(', ')}
                                </p>
                            </div>
                            <div className="order-row-side">
                                <span className="order-row-total">{formatKES(o.total_amount)}</span>
                                <span className={`status status--${o.status}`}>{o.status}</span>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};

const ActivityFeed = () => {
    const { activity } = useLive();

    return (
        <aside className="activity" aria-labelledby="activity-heading">
            <h2 id="activity-heading" className="wallet-section-title">Live activity</h2>
            <p className="activity-intro">What the server and database did, as it happens. Kept for this visit only.</p>
            {activity.length === 0 ? (
                <p className="wallet-empty">Nothing yet. Place an order or add funds, in this tab or another, and each step shows up here.</p>
            ) : (
                <ol className="activity-list" aria-live="polite">
                    {activity.map((event, index) => (
                        <li key={event.id} className={`activity-item activity-item--${event.type.replace('.', '-')}`}>
                            <div className="activity-head">
                                <time dateTime={event.at}>{time(event.at)}</time>
                                <span>{describeEvent(event)}</span>
                            </div>
                            {event.trace.length > 0 && (
                                <details open={index === 0 || undefined}>
                                    <summary>{event.trace.length} backend {event.trace.length === 1 ? 'step' : 'steps'}</summary>
                                    <ol className="trace">
                                        {event.trace.map((step, i) => <li key={i}>{step}</li>)}
                                    </ol>
                                </details>
                            )}
                        </li>
                    ))}
                </ol>
            )}
        </aside>
    );
};

const WalletPage = () => {
    const { loadError, refresh } = useLive();

    return (
        <div className="wallet-page">
            {loadError && (
                <p className="auth-error">
                    Couldn't load your wallet: {loadError}{' '}
                    <button type="button" className="link-button" onClick={refresh}>Try again</button>
                </p>
            )}
            <div className="wallet-grid">
                <div className="wallet-main">
                    <BalancePanel />
                    <Statement />
                    <Orders />
                </div>
                <ActivityFeed />
            </div>
        </div>
    );
};

export default WalletPage;
