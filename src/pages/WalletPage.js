import { Link } from 'react-router-dom';
import { useLive } from '../context/LiveContext.js';
import { CONNECTION_LABEL } from '../components/WalletChip.js';
import { formatKES, formatSignedKES } from '../api.js';

const dateTime = (iso) =>
    new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const timeOnly = (iso) =>
    new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

const STATUS_MESSAGE = {
    not_linked: 'Your Pesa Tracker account is not linked yet, so there is no food budget to show.',
    no_budget: 'You have not set a food budget on Pesa Tracker yet.',
    unavailable: 'Pesa Tracker is not reachable right now. Your remaining amount will show again when it is back.',
};

// The remaining food budget, read from Pesa Tracker. Nothing here can be typed in or changed.
const BalancePanel = () => {
    const { wallet, connection } = useLive();
    const ok = wallet?.status === 'ok';

    return (
        <section className="balance-panel" aria-labelledby="balance-heading">
            <div className="balance-panel-top">
                <h1 id="balance-heading" className="balance-panel-label">Food budget remaining</h1>
                <span className="balance-panel-status">
                    <span className={`live-dot live-dot--${connection}`} aria-hidden="true" />
                    {CONNECTION_LABEL[connection]}
                </span>
            </div>
            <div className="balance-panel-figure" aria-live="polite">
                <span className="balance-panel-amount">{!wallet ? 'KES …' : ok ? formatKES(wallet.remaining) : '—'}</span>
            </div>
            {wallet?.stale ? (
                <p className="stale-banner" role="status">
                    Showing your saved budget from {timeOnly(wallet.asOf)}. Pesa Tracker is not responding, so this amount may be out of date.
                </p>
            ) : (
                <p className="balance-panel-pesa">
                    {wallet && !ok ? STATUS_MESSAGE[wallet.status] : 'From your Pesa Tracker food budget. It goes down when you place an order.'}
                </p>
            )}
        </section>
    );
};

// The purchases we recorded on Pesa Tracker, newest first.
const Transactions = () => {
    const { wallet } = useLive();
    if (!wallet || wallet.status === 'not_linked') return null;

    return (
        <section className="wallet-section" aria-labelledby="transactions-heading">
            <h2 id="transactions-heading" className="wallet-section-title">Transactions</h2>
            {wallet.transactions.length === 0 ? (
                <p className="wallet-empty">No transactions yet. <Link to="/">Browse cafeterias</Link> to place an order.</p>
            ) : (
                <ul className="order-list">
                    {wallet.transactions.map((t) => (
                        <li key={t.id} className="order-row">
                            <div>
                                <p className="order-row-title">{t.description}</p>
                                <p className="order-row-items">{dateTime(t.created_at)} · {t.items.join(', ')}</p>
                            </div>
                            <div className="order-row-side">
                                <span className="order-row-total">{formatSignedKES(-t.amount)}</span>
                                <span className={`status status--${t.status}`}>{t.status}</span>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};

const WalletPage = () => {
    const { loadError, refresh } = useLive();

    return (
        <div className="wallet-page">
            {loadError && (
                <p className="auth-error" role="alert">
                    Could not load your wallet: {loadError}{' '}
                    <button type="button" className="link-button" onClick={refresh}>Try again</button>
                </p>
            )}
            <div className="wallet-main">
                <BalancePanel />
                <Transactions />
            </div>
        </div>
    );
};

export default WalletPage;