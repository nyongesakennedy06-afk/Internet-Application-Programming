import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
    const { cafeteria_id, items } = req.body;

    if (!cafeteria_id || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'cafeteria_id and a non empty items array needed'});
    }

    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();

        const menuItemIds = items.map(item => item.menu_item_id);
        const placeholders = menuItemIds.map(() => '?').join(',');
        const [menuItems] = await connection.query(`SELECT id, name, price, cafeteria_id FROM menu_items WHERE id IN (${placeholders})`, menuItemIds);

        if (menuItems.length !== menuItemIds.length) {
            await connection.rollback();
            return res.status(400).json({ error: 'One or more menu items do not exist '});
        }

        const wrongCafeteria = menuItems.some(mi => mi.cafeteria_id !== cafeteria_id);
        if (wrongCafeteria) {
            await connection.rollback();
            return res.status(400).json({ error: 'All items must be from same cafeteria '});
        }

        let total_amount = 0;
        const orderItemsToInsert = items.map(item => {
            const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
            const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;
            total_amount += menuItem.price * quantity;
            return {
                menu_item_id: menuItem.id,
                item_name: menuItem.name,
                item_price: menuItem.price,
                quantity
            };
        });

        const [orderResult] = await connection.query(
            'INSERT INTO orders (user_id, cafeteria_id, status, total_amount) VALUES (?, ?, ?, ?)',
            [req.user.id, cafeteria_id, 'pending', total_amount]
        );

        const orderId = orderResult.insertId;

        for (const item of orderItemsToInsert) {
            await connection.query(
                'INSERT INTO order_items (order_id, menu_item_id, item_name, item_price, quantity) VALUES (?, ?, ?, ?, ?)',
                [orderId, item.menu_item_id, item.item_name, item.item_price, item.quantity]
            );
        }

        await connection.commit();

        res.status(201).json({
            id: orderId,
            cafeteria_id,
            status: 'pending',
            total_amount,
            items: orderItemsToInsert
        });
    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ error: 'Failed to place order' });
    } finally {
        connection.release();
    }
});

router.get('/', requireAuth, async (req, res) => {
    const [orders] = await pool.query(
        'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]
    );
    res.json(orders);
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