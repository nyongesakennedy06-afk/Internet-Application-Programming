import { pool } from './db.js';
import data from '../src/data/data.json' with { type: 'json' };

for (const cafe of data.cafeterias) {
    await pool.query(
        'INSERT INTO cafeterias (id, name, description, image, rating, delivery_time) VALUES(?, ?, ?, ?, ?, ?)',
        [cafe.id, cafe.name, cafe.description, cafe.image, cafe.rating, cafe.deliveryTime]
    );
    for (const item of cafe.menu) {
        await pool.query(
            'INSERT INTO menu_items (id, cafeteria_id, name, description, price, image, category) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [item.id, cafe.id, item.name, item.description, item.price, item.image, item.category]
        );
    }
}
console.log('Seeded!');
process.exit()