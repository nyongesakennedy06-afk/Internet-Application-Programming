import express from 'express';
import cors from 'cors';
import cafeteriaRoutes from './routes/cafeterias.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/cafeterias', cafeteriaRoutes);

app.listen(4000, () => console.log('API is running on :4000'));