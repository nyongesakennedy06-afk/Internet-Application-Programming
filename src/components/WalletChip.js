import { Link } from 'react-router-dom';
import { useLive } from '../context/LiveContext.js';
import { formatKES } from '../api.js';

export const CONNECTION_LABEL = {
    live: 'Live',
    connecting: 'Connecting',
    reconnecting: 'Reconnecting',
    offline: 'Offline',
};

// The balance in the header. It changes the moment the database does, wherever you are in the app.
const WalletChip = () => {
    const { wallet, connection, lastChange } = useLive();

    return (
        <Link to="/wallet" className="wallet-chip" aria-label={`Wallet: ${wallet ? formatKES(wallet.balance) : 'loading'}, ${CONNECTION_LABEL[connection]}`}>
            <span className={`live-dot live-dot--${connection}`} aria-hidden="true" />
            {/* key forces the highlight animation to replay on every new transaction */}
            <span key={lastChange?.id ?? 'initial'} className={lastChange ? 'wallet-chip-amount wallet-chip-amount--changed' : 'wallet-chip-amount'}>
                {wallet ? formatKES(wallet.balance) : 'KES …'}
            </span>
        </Link>
    );
};

export default WalletChip;
