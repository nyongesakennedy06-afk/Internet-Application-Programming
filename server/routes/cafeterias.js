import express from 'express';
import { pool } from '../db.js';
const router = express.Router();

router.get('/', async (req, res) => {
    const [cafeterias] = await pool.query('SELECT * FROM cafeterias');
    res.json(cafeterias);
});


router.get('/:id', async (req, res) => {
    const [[cafeteria]] = await pool.query('SELECT * FROM cafeterias WHERE id = ?', [req.params.id]);
    const [menu] = await pool.query('SELECT * FROM menu_items WHERE cafeteria_id = ?', [req.params.id]);
    res.json({ ...cafeteria, menu});
});

export default router;