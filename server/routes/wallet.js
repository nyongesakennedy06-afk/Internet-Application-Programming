import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import * as pesaTracker from '../pesaTracker.js';

const router = express.Router();

const TRANSACTION_LIMIT = 25;

// The wallet is read-only. It shows two things and nothing else:
//   remaining     the user's food budget left, read live from Pesa Tracker (GET /users/{id}/budget)
//   transactions  the purchases we recorded on Pesa Tracker (POST /users/{id}/transactions), newest first
//
// status tells the page what to show:
//   ok           remaining is the live number
//   not_linked   this user has no Pesa Tracker account linked (users.pesa_user_id is empty)
//   no_budget    linked, but Pesa Tracker says no budget is set up yet
//   unavailable  Pesa Tracker could not be reached or returned an error
router.get('/', requireAuth, async (req, res) => {
    try {
        const [[account]] = await pool.query('SELECT pesa_user_id FROM users WHERE id = ?', [req.user.id]);
        const pesaUserId = account?.pesa_user_id ?? null;

        let status = 'not_linked';
        let remaining = null;

        if (pesaTracker.isEnabled() && pesaUserId) {
            try {
                const budget = await pesaTracker.getBudget(pesaUserId);
                status = 'ok';
                remaining = budget.remaining;
            } catch (err) {
                status = err.status === 404 ? 'no_budget' : 'unavailable';
            }
        }

        // Only orders that Pesa Tracker accepted (they have its transaction id). Orders placed before the
        // account was linked, or while Pesa Tracker was switched off, were never charged to the budget.
        const [orders] = await pool.query(
            `SELECT o.id, o.total_amount, o.status, o.created_at, c.name AS cafeteria_name
               FROM orders o JOIN cafeterias c ON c.id = o.cafeteria_id
              WHERE o.user_id = ? AND o.pesa_transaction_id IS NOT NULL
              ORDER BY o.created_at DESC, o.id DESC LIMIT ?`,
            [req.user.id, TRANSACTION_LIMIT]
        );
        const ids = orders.map((o) => o.id);
        const [items] = ids.length
            ? await pool.query('SELECT order_id, item_name, quantity FROM order_items WHERE order_id IN (?)', [ids])
            : [[]];

        res.json({
            status,
            remaining,
            currency: 'KES',
            transactions: orders.map((o) => ({
                id: o.id,
                description: `Order #${o.id} at ${o.cafeteria_name}`,
                items: items
                    .filter((i) => i.order_id === o.id)
                    .map((i) => (i.quantity > 1 ? `${i.item_name} x${i.quantity}` : i.item_name)),
                amount: Number(o.total_amount),
                status: o.status,
                created_at: new Date(o.created_at).toISOString(),
            })),
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load your wallet' });
    }
});

export default router;