import express from 'express';
import { pool } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireApiKey } from '../middleware/apiKey.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as pesaTracker from '../pesaTracker.js';
import { publish } from '../events.js';

const router = express.Router();

// Biggest quantity allowed per line item (keeps totals inside the DECIMAL(10,2) column)
const MAX_QUANTITY = 100;

// Validation first: returns an error message if the body breaks the contract, otherwise null.
// Nothing here touches the database.
const validateOrderBody = (body) => {
    const { cafeteria_id, items } = body ?? {};

    if (typeof cafeteria_id !== 'string' || cafeteria_id.trim() === '') {
        return 'cafeteria_id is required and must be a non-empty string';
    }
    if (!Array.isArray(items) || items.length === 0) {
        return 'items is required and must be a non-empty array';
    }

    const seen = new Set();
    for (const [index, item] of items.entries()) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            return `items[${index}] must be an object`;
        }
        if (typeof item.menu_item_id !== 'string' || item.menu_item_id.trim() === '') {
            return `items[${index}].menu_item_id is required and must be a non-empty string`;
        }
        if (item.quantity !== undefined &&
            (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY)) {
            return `items[${index}].quantity must be a whole number between 1 and ${MAX_QUANTITY}`;
        }
        if (seen.has(item.menu_item_id)) {
            return `menu_item_id ${item.menu_item_id} appears more than once`;
        }
        seen.add(item.menu_item_id);
    }
    return null;
};

// Turns a Pesa Tracker failure into an answer for our own client. The order has NOT been placed.
const pesaTrackerErrorReply = (err) => {
    if (err.status === 422) {
        return [422, 'Your remaining food budget is too low for this order'];
    }
    if (err.status === 404) {
        return [400, 'No Pesa Tracker budget was found for your linked account'];
    }
    console.error('Pesa Tracker error:', err.status, err.code, err.message);
    return [502, 'Pesa Tracker is unavailable, so the order was not placed'];
};

router.post('/', requireAuth, async (req, res) => {
    const validationError = validateOrderBody(req.body);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    const { cafeteria_id, items } = req.body;
    const userId = req.user.id;
    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Ends the request without placing anything.
        const fail = async (status, error) => {
            await connection.rollback();
            return res.status(status).json({ error });
        };

        const [[cafeteria]] = await connection.query('SELECT id FROM cafeterias WHERE id = ?', [cafeteria_id]);
        if (!cafeteria) {
            return fail(400, `cafeteria_id ${cafeteria_id} does not exist`);
        }

        const menuItemIds = items.map(item => item.menu_item_id);
        const placeholders = menuItemIds.map(() => '?').join(',');
        const [menuItems] = await connection.query(`SELECT id, name, price, cafeteria_id FROM menu_items WHERE id IN (${placeholders})`, menuItemIds);

        if (menuItems.length !== menuItemIds.length) {
            return fail(400, 'One or more menu items do not exist');
        }

        const wrongCafeteria = menuItems.some(mi => mi.cafeteria_id !== cafeteria_id);
        if (wrongCafeteria) {
            return fail(400, 'All items must be from the same cafeteria');
        }

        // Mapping step: request items + DB menu rows -> order lines (price and name come from the DB)
        let total_amount = 0;
        const orderItemsToInsert = items.map(item => {
            const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
            const quantity = item.quantity ?? 1;
            total_amount += menuItem.price * quantity;
            return {
                menu_item_id: menuItem.id,
                item_name: menuItem.name,
                item_price: menuItem.price,
                quantity
            };
        });

        // Budget check (Pesa Tracker). Only for users linked to a Pesa Tracker account (users.pesa_user_id).
        let pesaUserId = null;
        if (pesaTracker.isEnabled()) {
            const [[account]] = await connection.query('SELECT pesa_user_id FROM users WHERE id = ?', [userId]);
            pesaUserId = account?.pesa_user_id ?? null;
        }
        if (pesaUserId) {
            try {
                const budget = await pesaTracker.getBudget(pesaUserId);
                if (total_amount > budget.remaining) {
                    return fail(422, `Order total KES ${total_amount} is more than your remaining food budget of KES ${budget.remaining}`);
                }
            } catch (budgetErr) {
                if (budgetErr instanceof pesaTracker.PesaTrackerError && budgetErr.status === 404) {
                    // No budget set up on Pesa Tracker: the order goes ahead without budget enforcement.
                    pesaUserId = null;
                } else {
                    throw budgetErr;
                }
            }
        }

        const [orderResult] = await connection.query(
            'INSERT INTO orders (user_id, cafeteria_id, status, total_amount) VALUES (?, ?, ?, ?)',
            [userId, cafeteria_id, 'pending', total_amount]
        );
        const orderId = orderResult.insertId;

        for (const item of orderItemsToInsert) {
            await connection.query(
                'INSERT INTO order_items (order_id, menu_item_id, item_name, item_price, quantity) VALUES (?, ?, ?, ?, ?)',
                [orderId, item.menu_item_id, item.item_name, item.item_price, item.quantity]
            );
        }

        // Record the purchase on Pesa Tracker BEFORE committing: it deducts the budget itself, and if it
        // refuses (or is down) the throw below rolls our order back, so nothing is left half-done.
        // Never also call their PATCH "deduct" for the same order - that would charge the student twice.
        if (pesaUserId) {
            const transaction = await pesaTracker.recordTransaction(pesaUserId, {
                orderId: `ord_${orderId}`,
                amount: total_amount,
                items: orderItemsToInsert.map(i => (i.quantity > 1 ? `${i.item_name} x${i.quantity}` : i.item_name))
            });
            // Remember Pesa Tracker's id for this purchase: the wallet lists the orders that have one.
            // (Their contract promises an id; the fallback only guards against losing the order after money moved.)
            await connection.query('UPDATE orders SET pesa_transaction_id = ? WHERE id = ?', [transaction?.id ?? 'unknown', orderId]);
        }

        await connection.commit();

        // Only after COMMIT: tell the user's open tabs to reload their wallet.
        if (pesaUserId) {
            publish(userId, 'wallet.updated', { orderId });
        }

        res.status(201).json({
            id: orderId,
            cafeteria_id,
            status: 'pending',
            total_amount,
            items: orderItemsToInsert
        });
    } catch (err) {
        if (connection) {
            await connection.rollback();
        }
        if (err instanceof pesaTracker.PesaTrackerError) {
            const [status, error] = pesaTrackerErrorReply(err);
            return res.status(status).json({ error });
        }
        console.error(err);
        res.status(500).json({ error: 'Failed to place order' });
    } finally {
        if (connection) connection.release();
    }
});

// Contract: GET /orders?userId={id}&fields=timestamp|location  (Team 10)
// Turns a DB date into "2026-08-13T10:00:00Z" (no milliseconds), as the contract promises.
const toIsoDate = (value) => new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');

router.get('/', requireApiKey, rateLimit, async (req, res) => {
    const userId = Number(req.query.userId);
    const { fields } = req.query;

    if (!Number.isInteger(userId) || userId < 1) {
        return res.status(400).json({ error: 'userId is required and must be a positive integer' });
    }
    if (fields !== 'timestamp' && fields !== 'location') {
        return res.status(400).json({ error: 'fields must be one of: timestamp, location' });
    }

    try {
        const [[user]] = await pool.query('SELECT id FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: `User ${userId} not found` });
        }

        const [rows] = await pool.query(
            'SELECT id, cafeteria_id, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC',
            [userId]
        );

        // Mapping step: DB columns -> contract fields (only the one that was asked for)
        const orders = rows.map(row =>
            fields === 'timestamp'
                ? { id: row.id, timestamp: toIsoDate(row.created_at) }
                : { id: row.id, location: row.cafeteria_id }
        );

        res.json({ orders });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// Not part of the Team 10 contract: the logged-in user's own orders with their line items,
// for the wallet / order history page. Must stay above '/:id' so "mine" isn't read as an id.
router.get('/mine', requireAuth, async (req, res) => {
    try {
        const [orders] = await pool.query(
            `SELECT o.*, c.name AS cafeteria_name
               FROM orders o JOIN cafeterias c ON c.id = o.cafeteria_id
              WHERE o.user_id = ? ORDER BY o.created_at DESC, o.id DESC LIMIT 50`,
            [req.user.id]
        );
        const ids = orders.map((o) => o.id);
        const [items] = ids.length
            ? await pool.query('SELECT order_id, menu_item_id, item_name, item_price, quantity FROM order_items WHERE order_id IN (?)', [ids])
            : [[]];

        res.json(orders.map((o) => ({
            ...o,
            total_amount: Number(o.total_amount),
            items: items.filter((i) => i.order_id === o.id),
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch your orders' });
    }
});

// Admin: move an order along (pending -> confirmed -> completed). The customer's open tabs update live.
const STATUSES = ['pending', 'confirmed', 'completed'];

router.patch('/:id/status', requireAuth, requireAdmin, async (req, res) => {
    const { status } = req.body ?? {};
    if (!STATUSES.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
    }
    try {
        const [[order]] = await pool.query('SELECT id, user_id, status FROM orders WHERE id = ?', [req.params.id]);
        if (!order) {
            return res.status(404).json({ error: 'Order does not exist' });
        }
        await pool.query('UPDATE orders SET status = ? WHERE id = ?', [status, order.id]);

        publish(order.user_id, 'order.updated', { id: order.id, status, previous: order.status });
        res.json({ id: order.id, status });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update order status' });
    }
});

router.get('/:id', requireAuth, async (req, res) => {
    const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);

    if (!order) {
        return res.status(401).json({ error: 'Order does not exist '});
    }
    if (order.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Not authorized to view this order '});
    }

    const [items] = await pool.query('SELECT * FROM order_items where order_id = ?', [req.params.id]);
    res.json({ ...order, items });
});

export default router;