import 'dotenv/config';
import { createBot } from './bot';

const bot = createBot();

bot.launch({ allowedUpdates: ['message'] });
console.log('Caterina is running...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
