import express from 'express';
import { pool } from '../db.js';
import { requireApiKey } from '../middleware/apiKey.js';

const router = express.Router();

// Contract: GET /users/{id}/order-frequency?locationId={cafeteria id}  (Team 10)
router.get('/:id/order-frequency', requireApiKey, async (req, res) => {
    const { locationId } = req.query;
    if (typeof locationId !== 'string' || locationId === '') {
        return res.status(400).json({ error: 'locationId is required' });
    }

    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId < 1) {
        return res.status(404).json({ error: `User ${req.params.id} not found` });
    }

    try {
        const [[user]] = await pool.query('SELECT id FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: `User ${userId} not found` });
        }

        const [[cafeteria]] = await pool.query('SELECT id FROM cafeterias WHERE id = ?', [locationId]);
        if (!cafeteria) {
            return res.status(404).json({ error: `Location ${locationId} not found` });
        }

        const [[stats]] = await pool.query(
            'SELECT COUNT(*) AS order_count, MAX(created_at) AS last_order FROM orders WHERE user_id = ? AND cafeteria_id = ?',
            [userId, locationId]
        );

        
        const orderCount = Number(stats.order_count);
        const body = {
            userId,
            locationId,
            orderCount,
            isFirstTimeUser: orderCount === 0,
        };
        
        if (stats.last_order) {
            body.lastOrderDate = new Date(stats.last_order).toISOString().replace(/\.\d{3}Z$/, 'Z');
        }

        res.json(body);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch order frequency' });
    }
});

export default router;