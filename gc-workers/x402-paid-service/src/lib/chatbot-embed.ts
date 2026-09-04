/**
 * Public website chatbot widget. The ID is a client-side embed token
 * (it ships in HTML). Do not confuse with Worker secrets.
 *
 * Vendor: Chatbase website widget (https://www.chatbase.co/embed.min.js).
 * Chatling's setup API returned "Chatbot not found" for this id; Chatbase's
 * iframe host 404s until the agent is public / domain-allowlisted.
 */

export const CHATBOT_EMBED_DOMAIN = 'www.chatbase.co';

export function chatbotEmbedSnippet(widgetId?: string): string {
  const id = typeof widgetId === 'string' ? widgetId.trim() : '';
  if (!id) return '';
  const jsonId = JSON.stringify(id);
  return `<script data-gc-chatbot="1">
(function () {
  if (window.embeddedChatbotConfig) return;
  var id = ${jsonId};
  window.embeddedChatbotConfig = { chatbotId: id, domain: ${JSON.stringify(CHATBOT_EMBED_DOMAIN)} };
  var s = document.createElement('script');
  s.src = 'https://${CHATBOT_EMBED_DOMAIN}/embed.min.js';
  s.setAttribute('chatbotId', id);
  s.setAttribute('domain', ${JSON.stringify(CHATBOT_EMBED_DOMAIN)});
  s.defer = true;
  document.body.appendChild(s);
})();
</script>
<noscript>Chat widget requires JavaScript.</noscript>`;
}

/** Insert the widget once, immediately before </body>. */
export function withChatbotWidget(html: string, widgetId?: string): string {
  const snippet = chatbotEmbedSnippet(widgetId);
  if (!snippet) return html;
  if (html.includes('data-gc-chatbot="1"')) return html;
  const close = html.lastIndexOf('</body>');
  if (close === -1) return html + snippet;
  return html.slice(0, close) + snippet + html.slice(close);
}
