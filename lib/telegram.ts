// lib/telegram.ts
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';

export interface SendOptions {
  chatId?: string;
  parseMode?: 'Markdown' | 'HTML';
  disablePreview?: boolean;
}

export async function sendTelegram(text: string, opts: SendOptions = {}): Promise<void> {
  if (!BOT_TOKEN) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN env var is not set. Copy .env.example → .env and fill in your bot token.'
    );
  }
  const chatId = opts.chatId ?? DEFAULT_CHAT_ID;
  if (!chatId) {
    throw new Error(
      'No chat_id provided and TELEGRAM_CHAT_ID env var is not set.'
    );
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: opts.parseMode ?? 'Markdown',
    disable_web_page_preview: opts.disablePreview ?? true,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Telegram send failed (${res.status}): ${errText}`);
  }
}
