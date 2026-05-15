export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Strip markdown and escape for Telegram HTML parse mode.
// Claude output uses standard markdown; Telegram requires HTML or plain text.
export function formatForTelegram(text: string): string {
  const stripped = text
    // Code blocks — keep content, strip fences
    .replace(/```[\w]*\n?([\s\S]+?)```/g, (_, code) => code.trim())
    // Strip headers entirely
    .replace(/^#{1,6}\s+/gm, '')
    // Strip bold/italic markers, keep text
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/\*(.+?)\*/gs, '$1')
    .replace(/__(.+?)__/gs, '$1')
    .replace(/_(.+?)_/gs, '$1')
    // Strip inline code backticks
    .replace(/`([^`\n]+)`/g, '$1')
    // Strip links — keep display text, drop URL
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    // Clean bullet markers
    .replace(/^[ \t]*[-*+] /gm, '— ')
    // Collapse 3+ blank lines to 2
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return escapeHtml(stripped);
}
