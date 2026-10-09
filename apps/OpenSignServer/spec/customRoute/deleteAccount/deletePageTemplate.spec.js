import {
  escapeHtml,
  isValidUserId,
  renderDeletePage,
  toScriptString,
} from '../../../cloud/customRoute/deleteAccount/deletePageTemplate.js';

const HOSTILE_ID = `"><script>alert(1)</script>'`;

describe('delete account page template', () => {
  it('accepts only ten character alphanumeric ids', () => {
    expect(isValidUserId('aB3dE6gH9j')).toBeTrue();
    expect(isValidUserId('aB3dE6gH9')).toBeFalse();
    expect(isValidUserId('aB3dE6gH9j1')).toBeFalse();
    expect(isValidUserId('aB3dE6gH9-')).toBeFalse();
    expect(isValidUserId(undefined)).toBeFalse();
  });

  it('escapes the characters that break out of html attributes', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('serializes script strings without a closing tag', () => {
    expect(toScriptString('a</script>b')).not.toContain('</script>');
    expect(JSON.parse(toScriptString("it's"))).toBe("it's");
  });

  it('does not let a hostile id break out of the form action or the script', () => {
    const page = renderDeletePage({ routePath: '', userId: HOSTILE_ID, nonce: 'n0nce' });

    expect(page).not.toContain(HOSTILE_ID);
    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).toContain('action="/delete-account/&quot;&gt;&lt;script&gt;');
  });

  it('puts the nonce on the only script element', () => {
    const page = renderDeletePage({ routePath: '', userId: 'aB3dE6gH9j', nonce: 'n0nce' });

    expect(page.match(/<script/g).length).toBe(1);
    expect(page).toContain('<script nonce="n0nce">');
  });
});
