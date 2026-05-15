import 'dotenv/config';
import express from 'express';
import { createBot } from './bot';

const PORT = process.env.PORT ?? 3000;
const RAILWAY_URL = process.env.RAILWAY_URL;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const bot = createBot();
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

async function start() {
  if (IS_PRODUCTION) {
    if (!RAILWAY_URL) throw new Error('RAILWAY_URL is required in production');
    const webhookUrl = `https://${RAILWAY_URL}/webhook`;
    await bot.telegram.setWebhook(webhookUrl);
    app.post('/webhook', (req, res) => bot.handleUpdate(req.body, res));
    app.listen(PORT, () => console.log(`Caterina running on port ${PORT} (webhook → ${webhookUrl})`));
  } else {
    app.listen(PORT, () => console.log(`Caterina running on port ${PORT} (polling)`));
    await bot.launch({ allowedUpdates: ['message'] });
  }
}

start().catch(console.error);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
