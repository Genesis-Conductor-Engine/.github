import { describe, expect, it } from 'vitest';
import { buildVerificationLedgerHtml } from './verification-ledger';

describe('buildVerificationLedgerHtml', () => {
  it('is a full document with the three unverified Base contracts', () => {
    const html = buildVerificationLedgerHtml();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('lang="en"');
    expect(html).toContain('name="color-scheme"');
    expect(html).toContain('id="lcp"');
    expect(html).toContain('Skip to ledger');
    expect(html).toContain('0x69262A2D7c92c074729823B654fE7E4Cdb749747');
    expect(html).toContain('0xa8F5e136aa74803B8DB377a14f79F6c8Dd3959c7');
    expect(html).toContain('0x851936cA8874c05f1eDc2f5Fc2e6A3Cd97c7205E');
    expect(html).toContain('0x9545e2439c5c75d3aA723AcaC1AA6B0fa1DB6956');
    expect(html).toContain('EIP7702StatelessDeleGator');
    expect(html).toContain('0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B');
    expect(html).toContain('HLZNTuvJ84qhJXEMx8UWGsfxRVDVxESc3sVecAxqjqFi');
    expect(html).toContain('ImplicitWrapArbiter');
    expect(html).toContain('TREASURY_SINK');
    expect(html).toContain('0xb42f812a44c22cc6b861478900401ee759ebead6');
    expect(html).toContain('content-visibility: auto');
    expect(html).not.toContain('data-gc-chatbot="1"');
  });

  it('embeds the chatbot widget when an id is provided', () => {
    const html = buildVerificationLedgerHtml('oe3n0lo3');
    expect(html).toContain('data-gc-chatbot="1"');
    expect(html).toContain('https://widget.intercom.io/widget/');
    expect(html).toContain('"oe3n0lo3"');
    expect(html.indexOf('data-gc-chatbot="1"')).toBeLessThan(html.lastIndexOf('</body>'));
  });
});
