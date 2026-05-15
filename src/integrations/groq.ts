import Groq from 'groq-sdk';
import axios from 'axios';
import { createReadStream, createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function transcribeVoice(fileId: string): Promise<string> {
  const tmpPath = join(tmpdir(), `voice-${Date.now()}.ogg`);
  try {
    await downloadTelegramFile(fileId, tmpPath);
    const result = await groq.audio.transcriptions.create({
      file: createReadStream(tmpPath),
      model: 'whisper-large-v3-turbo',
    });
    return result.text.trim();
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

async function downloadTelegramFile(fileId: string, destPath: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN!;

  const infoRes = await axios.get(
    `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`
  );
  const filePath: string = infoRes.data.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

  const fileRes = await axios.get<NodeJS.ReadableStream>(fileUrl, { responseType: 'stream' });
  const writer = createWriteStream(destPath);

  await new Promise<void>((resolve, reject) => {
    fileRes.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}
