import 'dotenv/config';
import express from 'express';
import { createBot } from './bot';
import { startCrons } from './crons';

console.log('[env] NODE_ENV:', process.env.NODE_ENV);
console.log('[env] RAILWAY_URL:', process.env.RAILWAY_URL);
console.log('[env] RAILWAY_PUBLIC_DOMAIN:', process.env.RAILWAY_PUBLIC_DOMAIN);
console.log('[env] PORT:', process.env.PORT);

const PORT = process.env.PORT;
if (!PORT) throw new Error('PORT environment variable is not set');

const webhookBase =
  process.env.RAILWAY_URL
  ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);

const bot = createBot();
const app = express();

app.use(express.json());

app.get('/health', (_req, res) => res.send('ok'));

app.post('/webhook', (req, res) => {
  console.log('[webhook] received update');
  bot.handleUpdate(req.body, res);
});

app.listen(Number(PORT), '0.0.0.0', async () => {
  console.log(`[startup] express listening on port ${PORT} (0.0.0.0)`);
  startCrons(bot.telegram);

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
