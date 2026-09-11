import { describe, expect, it } from 'vitest';
import { chatbotEmbedSnippet, withChatbotWidget } from './chatbot-embed';

describe('chatbotEmbedSnippet', () => {
  it('returns empty when the widget id is missing or not an Intercom app_id', () => {
    expect(chatbotEmbedSnippet()).toBe('');
    expect(chatbotEmbedSnippet('  ')).toBe('');
    expect(chatbotEmbedSnippet('xcbot_test')).toBe('');
    expect(chatbotEmbedSnippet('https://evil.example/x')).toBe('');
  });

  it('emits an Intercom Messenger loader that JSON-encodes the app_id', () => {
    const html = chatbotEmbedSnippet('oe3n0lo3');
    expect(html).toContain('data-gc-chatbot="1"');
    expect(html).toContain('https://widget.intercom.io/widget/');
    expect(html).toContain('"oe3n0lo3"');
    expect(html).toContain('window.intercomSettings');
    expect(html).not.toContain('chatbase.co');
  });
});

describe('withChatbotWidget', () => {
  it('injects once before </body>', () => {
    const page = '<!DOCTYPE html><html><body><h1>x</h1></body></html>';
    const once = withChatbotWidget(page, 'oe3n0lo3');
    expect(once).toContain('data-gc-chatbot="1"');
    expect(once.indexOf('</body>')).toBeGreaterThan(once.indexOf('data-gc-chatbot="1"'));
    const twice = withChatbotWidget(once, 'oe3n0lo3');
    expect(twice.split('data-gc-chatbot="1"').length).toBe(2);
  });

  it('leaves HTML unchanged without an id', () => {
    const page = '<html><body>ok</body></html>';
    expect(withChatbotWidget(page)).toBe(page);
  });
});
