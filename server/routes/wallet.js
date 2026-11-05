import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { publish } from '../events.js';
import * as wallet from '../wallet.js';
import * as pesaTracker from '../pesaTracker.js';

const router = express.Router();

// Largest single top-up. Keeps balances far inside DECIMAL(10,2) and catches typos like 50000000.
export const MAX_TOPUP = 50000;

// Pesa Tracker is optional extra info on the wallet page. If it is slow or down, the wallet still loads.
async function pesaSummary(userId) {
    if (!pesaTracker.isEnabled()) return null;
    const [[account]] = await pool.query('SELECT pesa_user_id FROM users WHERE id = ?', [userId]);
    if (!account?.pesa_user_id) return null;
    try {
        const budget = await pesaTracker.getBudget(account.pesa_user_id);
        return { linked: true, available: true, monthlyLimit: budget.monthlyLimit, remaining: budget.remaining };
    } catch (err) {
        if (err.status === 404) return { linked: true, available: true, budgetSet: false };
        return { linked: true, available: false };
    }
}

// The single source of truth the page loads from (and reloads after any reconnect).
router.get('/', requireAuth, async (req, res) => {
    try {
        await wallet.ensureWallet(pool, req.user.id);
        const [[row]] = await pool.query('SELECT balance, updated_at FROM wallets WHERE user_id = ?', [req.user.id]);
        const transactions = await wallet.recentTransactions(pool, req.user.id);
        res.json({
            balance: Number(row.balance),
            currency: 'KES',
            updated_at: new Date(row.updated_at).toISOString(),
            transactions,
            pesa: await pesaSummary(req.user.id),
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load your wallet' });
    }
});

// Simulated top-up. In production this is where an M-Pesa STK push callback would land instead.
router.post('/topup', requireAuth, async (req, res) => {
    const { amount } = req.body ?? {};
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_TOPUP) {
        return res.status(400).json({ error: `amount must be a whole number of shillings between 1 and ${MAX_TOPUP}` });
    }

    let connection;
    try {
        await wallet.ensureWallet(pool, req.user.id); // outside the transaction on purpose, see wallet.js
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const entry = await wallet.applyEntry(connection, req.user.id, {
            type: 'topup',
            amount,
            description: 'Wallet top-up',
        });
        await connection.commit();

        publish(req.user.id, 'wallet.updated', { balance: entry.balanceAfter, transaction: entry.transaction }, [
            'BEGIN transaction',
            `SELECT wallet FOR UPDATE: balance KES ${entry.balanceBefore}`,
            `UPDATE wallets: KES ${entry.balanceBefore} to KES ${entry.balanceAfter}`,
            `INSERT wallet_transactions #${entry.transaction.id} (topup +${amount})`,
            'COMMIT',
        ]);

        res.status(201).json({ balance: entry.balanceAfter, transaction: entry.transaction });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error(err);
        res.status(500).json({ error: 'Top-up failed; your balance was not changed' });
    } finally {
        if (connection) connection.release();
    }
});

export default router;
