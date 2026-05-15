const URL_RE = /https?:\/\/[^\s]+/g;

export interface ContentAnalysis {
  hasUrl: boolean;
  url?: string;
  text?: string;       // message text with URL stripped, if any
  isSplit: boolean;    // URL + meaningful surrounding text → route both separately
}

export function detectContent(message: string): ContentAnalysis {
  const urls = message.match(URL_RE);
  if (!urls) {
    return { hasUrl: false, text: message, isSplit: false };
  }

  const url = urls[0];
  const textWithoutUrl = message.replace(URL_RE, '').trim();
  const isSplit = textWithoutUrl.length > 15; // meaningful text alongside URL

  return {
    hasUrl: true,
    url,
    text: textWithoutUrl || undefined,
    isSplit,
  };
}
