import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

// Every user created by a test file is remembered here so cleanup() can remove them.
// (Each test file gets its own copy of this module, so files never delete each other's data.)
const createdUserIds = [];

// Arrange helper: inserts a throwaway user straight into the DB and signs a login token for it.
// Direct DB inserts keep the tests independent of the auth routes and of whatever data you already have.
// Pass { pesaUserId: 'usr_test' } to link the user to a Pesa Tracker account, { role: 'admin' } for an admin.
export async function createTestUser(label = 'user', { role = 'user', pesaUserId = null } = {}) {
    const email = `jest-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
    const name = `Jest ${label}`;

    const [result] = await pool.query(
        'INSERT INTO users (name, email, password_hash, role, pesa_user_id) VALUES (?, ?, ?, ?, ?)',
        [name, email, 'not-a-real-hash', role, pesaUserId]
    );
    createdUserIds.push(result.insertId);

    const token = jwt.sign(
        { id: result.insertId, name, email, role },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    return { id: result.insertId, email, token };
}

// Arrange helper: inserts one order for a user at a cafeteria and returns the new order id.
// Give { pesaTransactionId } to make it look like a purchase Pesa Tracker accepted (the wallet lists those).
export async function insertOrder(userId, cafeteriaId, status = 'completed', { pesaTransactionId = null, total = 100 } = {}) {
    const [result] = await pool.query(
        'INSERT INTO orders (user_id, cafeteria_id, status, total_amount, pesa_transaction_id) VALUES (?, ?, ?, ?, ?)',
        [userId, cafeteriaId, status, total, pesaTransactionId]
    );
    return result.insertId;
}

// Call from afterAll: removes everything the tests created, then closes the DB pool
// (otherwise Jest never exits because the pool keeps the connection open).
export async function cleanup() {
    if (createdUserIds.length > 0) {
        await pool.query(
            'DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (?))',
            [createdUserIds]
        );
        await pool.query('DELETE FROM orders WHERE user_id IN (?)', [createdUserIds]);
        await pool.query('DELETE FROM users WHERE id IN (?)', [createdUserIds]);
    }
    await pool.end();
}