// Wallet data access. Every function takes a connection that is ALREADY inside a transaction
// (connection.beginTransaction()), so the balance change and its ledger row commit or roll back together.

export class InsufficientFundsError extends Error {
    constructor(balance, needed) {
        const kes = (n) => `KES ${Number(n).toLocaleString('en-KE')}`;
        super(`Your wallet has ${kes(balance)}, but this order costs ${kes(needed)}. Top up to continue.`);
        this.name = 'InsufficientFundsError';
        this.balance = balance;
        this.needed = needed;
    }
}

// DECIMAL columns come back from mysql2 as strings ("650.00"); the API always speaks numbers.
const toNumber = (value) => Number(value);

export const formatTransaction = (row) => ({
    id: row.id,
    type: row.type,
    amount: toNumber(row.amount),
    balance_after: toNumber(row.balance_after),
    order_id: row.order_id,
    description: row.description,
    created_at: new Date(row.created_at).toISOString(),
});

// Creates the wallet row on first use, so users registered before the wallet existed just work.
// Call this with the POOL, before beginTransaction(): INSERT IGNORE on an existing row takes a shared
// lock, and upgrading that to FOR UPDATE inside a transaction deadlocks when two orders arrive at once.
export async function ensureWallet(poolOrConn, userId) {
    await poolOrConn.query('INSERT IGNORE INTO wallets (user_id, balance) VALUES (?, 0)', [userId]);
}

// Reads the balance and LOCKS the row until the transaction ends. A second order from the same
// user waits here until the first commits, then sees the already-reduced balance.
export async function lockBalance(conn, userId) {
    const [[row]] = await conn.query('SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE', [userId]);
    if (!row) throw new Error(`No wallet row for user ${userId}; call ensureWallet(pool, userId) before the transaction`);
    return toNumber(row.balance);
}

/**
 * Moves money and writes the matching ledger row. Call lockBalance() first in the same transaction.
 * @param {number} amount signed: + adds money, - takes it out
 * @returns the new ledger row, formatted for the API
 */
export async function applyEntry(conn, userId, { type, amount, orderId = null, description = null }) {
    const balanceBefore = await lockBalance(conn, userId); // cheap: we already hold the lock
    const balanceAfter = Math.round((balanceBefore + amount) * 100) / 100;
    if (balanceAfter < 0) {
        throw new InsufficientFundsError(balanceBefore, -amount);
    }

    await conn.query('UPDATE wallets SET balance = ? WHERE user_id = ?', [balanceAfter, userId]);
    const [result] = await conn.query(
        'INSERT INTO wallet_transactions (user_id, type, amount, balance_after, order_id, description) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, type, amount, balanceAfter, orderId, description]
    );
    const [[row]] = await conn.query('SELECT * FROM wallet_transactions WHERE id = ?', [result.insertId]);
    return { balanceBefore, balanceAfter, transaction: formatTransaction(row) };
}

export async function recentTransactions(conn, userId, limit = 25) {
    const [rows] = await conn.query(
        'SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
        [userId, limit]
    );
    return rows.map(formatTransaction);
}
