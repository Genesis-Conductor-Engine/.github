import { describe, expect, it } from 'vitest';
import { chatbotEmbedSnippet, withChatbotWidget } from './chatbot-embed';

describe('chatbotEmbedSnippet', () => {
  it('returns empty when the widget id is missing', () => {
    expect(chatbotEmbedSnippet()).toBe('');
    expect(chatbotEmbedSnippet('  ')).toBe('');
  });

  it('emits a Chatbase loader that does not interpolate the id into HTML attributes unsafely', () => {
    const html = chatbotEmbedSnippet('xcbot_test');
    expect(html).toContain('data-gc-chatbot="1"');
    expect(html).toContain('https://www.chatbase.co/embed.min.js');
    expect(html).toContain('"xcbot_test"');
    expect(html).toContain('embeddedChatbotConfig');
  });
});

describe('withChatbotWidget', () => {
  it('injects once before </body>', () => {
    const page = '<!DOCTYPE html><html><body><h1>x</h1></body></html>';
    const once = withChatbotWidget(page, 'xcbot_test');
    expect(once).toContain('data-gc-chatbot="1"');
    expect(once.indexOf('</body>')).toBeGreaterThan(once.indexOf('data-gc-chatbot="1"'));
    const twice = withChatbotWidget(once, 'xcbot_test');
    expect(twice.split('data-gc-chatbot="1"').length).toBe(2);
  });

  it('leaves HTML unchanged without an id', () => {
    const page = '<html><body>ok</body></html>';
    expect(withChatbotWidget(page)).toBe(page);
  });
});
