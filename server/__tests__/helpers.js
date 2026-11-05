import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

// Every user created by a test file is remembered here so cleanup() can remove them.
// (Each test file gets its own copy of this module, so files never delete each other's data.)
const createdUserIds = [];

// Arrange helper: inserts a throwaway user straight into the DB and signs a login token for it.
// Direct DB inserts keep the tests independent of the auth routes and of whatever data you already have.
// Orders are paid from the wallet, so by default the user gets a well-funded one; pass
// { walletBalance: null } for a user who has never had a wallet, or a number for an exact balance.
export async function createTestUser(label = 'user', { walletBalance = 1000000, role = 'user' } = {}) {
    const email = `jest-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
    const name = `Jest ${label}`;

    const [result] = await pool.query(
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [name, email, 'not-a-real-hash', role]
    );
    createdUserIds.push(result.insertId);

    if (walletBalance !== null) {
        await pool.query('INSERT INTO wallets (user_id, balance) VALUES (?, ?)', [result.insertId, walletBalance]);
    }

    const token = jwt.sign(
        { id: result.insertId, name, email, role },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    return { id: result.insertId, email, token };
}

// Arrange helper: inserts one order for a user at a cafeteria and returns the new order id.
export async function insertOrder(userId, cafeteriaId, status = 'completed') {
    const [result] = await pool.query(
        'INSERT INTO orders (user_id, cafeteria_id, status, total_amount) VALUES (?, ?, ?, ?)',
        [userId, cafeteriaId, status, 100]
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
        await pool.query('DELETE FROM wallet_transactions WHERE user_id IN (?)', [createdUserIds]);
        await pool.query('DELETE FROM wallets WHERE user_id IN (?)', [createdUserIds]);
        await pool.query('DELETE FROM orders WHERE user_id IN (?)', [createdUserIds]);
        await pool.query('DELETE FROM users WHERE id IN (?)', [createdUserIds]);
    }
    await pool.end();
}

// Reads a user's wallet straight from the DB (not through the API), for "really changed?" checks.
export async function walletState(userId) {
    const [[w]] = await pool.query('SELECT balance FROM wallets WHERE user_id = ?', [userId]);
    const [[t]] = await pool.query('SELECT COUNT(*) AS n FROM wallet_transactions WHERE user_id = ?', [userId]);
    return { balance: w ? Number(w.balance) : null, ledgerRows: Number(t.n) };
}