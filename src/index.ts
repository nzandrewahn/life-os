import 'dotenv/config';
import express from 'express';
import { createBot } from './bot';

const PORT = process.env.PORT ?? 3000;

console.log('[env] NODE_ENV:', process.env.NODE_ENV);
console.log('[env] RAILWAY_URL:', process.env.RAILWAY_URL);
console.log('[env] RAILWAY_PUBLIC_DOMAIN:', process.env.RAILWAY_PUBLIC_DOMAIN);
console.log('[env] PORT:', process.env.PORT);

const webhookBase =
  process.env.RAILWAY_URL
  ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);

const bot = createBot();
const app = express();

// Middleware — must be before routes
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.send('ok'));

// Webhook endpoint
app.post('/webhook', (req, res) => {
  console.log('[webhook] received update');
  bot.handleUpdate(req.body, res);
});

// Start Express first, then configure bot mode
app.listen(PORT, async () => {
  console.log(`[startup] express listening on port ${PORT}`);

  if (webhookBase) {
    const webhookUrl = `${webhookBase}/webhook`;
    console.log(`[startup] webhook mode — registering ${webhookUrl}`);
    await bot.telegram.setWebhook(webhookUrl);
    console.log('[startup] webhook registered');
  } else {
    console.log('[startup] polling mode — clearing any existing webhook');
    await bot.telegram.deleteWebhook();
    console.log('[startup] starting polling');
    await bot.launch({ allowedUpdates: ['message'] });
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
