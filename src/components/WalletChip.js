import { Link } from 'react-router-dom';
import { useLive } from '../context/LiveContext.js';
import { formatKES } from '../api.js';

export const CONNECTION_LABEL = {
    live: 'Live',
    connecting: 'Connecting',
    reconnecting: 'Reconnecting',
    offline: 'Offline',
};

// What the header chip says for each state of the wallet.
const chipText = (wallet) => {
    if (!wallet) return 'KES …';
    switch (wallet.status) {
        case 'ok': return wallet.stale ? `${formatKES(wallet.remaining)} (saved)` : formatKES(wallet.remaining);
        case 'not_linked': return 'No budget linked';
        case 'no_budget': return 'No budget set';
        default: return 'Budget unavailable';
    }
};

// The remaining food budget in the header. It follows Pesa Tracker, wherever you are in the app.
const WalletChip = () => {
    const { wallet, connection, flashKey } = useLive();

    return (
        <Link to="/wallet" className="wallet-chip" aria-label={`Food budget: ${chipText(wallet)}, ${CONNECTION_LABEL[connection]}`}>
            <span className={`live-dot live-dot--${connection}`} aria-hidden="true" />
            {/* key forces the highlight animation to replay each time the amount changes */}
            <span key={flashKey} className={flashKey > 0 ? 'wallet-chip-amount wallet-chip-amount--changed' : 'wallet-chip-amount'}>
                {chipText(wallet)}
            </span>
        </Link>
    );
};

export default WalletChip;