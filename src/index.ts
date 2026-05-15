import 'dotenv/config';
import express from 'express';
import { createBot } from './bot';

const PORT = process.env.PORT ?? 3000;
const RAILWAY_URL = process.env.RAILWAY_URL;

const bot = createBot();
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

async function start() {
  if (RAILWAY_URL) {
    const webhookUrl = `https://${RAILWAY_URL}/webhook`;
    console.log(`[startup] webhook mode — setting webhook to ${webhookUrl}`);
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`[startup] webhook set`);
    app.post('/webhook', (req, res) => bot.handleUpdate(req.body, res));
    app.listen(PORT, () => console.log(`[startup] express listening on port ${PORT}`));
  } else {
    console.log('[startup] polling mode — clearing any existing webhook');
    await bot.telegram.deleteWebhook();
    console.log('[startup] webhook cleared, starting polling');
    app.listen(PORT, () => console.log(`[startup] express listening on port ${PORT}`));
    await bot.launch({ allowedUpdates: ['message'] });
  }
}

start().catch(console.error);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
