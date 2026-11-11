import express from 'express';
import cors from 'cors';
import cafeteriaRoutes from './routes/cafeterias.js';
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';
import userRoutes from './routes/users.js';
import walletRoutes from './routes/wallet.js';
import eventRoutes from './routes/events.js';
import { monitor, statsHandler } from './monitoring.js';
import { requireApiKey } from './middleware/apiKey.js';

const app = express();
app.use(monitor); // FIRST, so rejected requests (401, 429) are logged too
app.use(cors());
app.use(express.json());
app.use('/api/cafeterias', cafeteriaRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/users', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/events', eventRoutes);
app.get('/api/stats', requireApiKey, statsHandler);

export default app;