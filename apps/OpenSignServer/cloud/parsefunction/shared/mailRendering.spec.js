import { replaceMailVaribles } from '../../../Utils.js';
import { escapeHtml, renderMailTemplate, toMailSubject } from './mailRendering.js';

describe('mailRendering', () => {
  describe('escapeHtml', () => {
    it('escapes markup characters and stringifies missing values', () => {
      expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
        '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
      );
      expect(escapeHtml(undefined)).toBe('');
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(7)).toBe('7');
    });

    it('keeps url and base64 characters intact', () => {
      expect(escapeHtml('https://app.test/login/ZG9j+/a=')).toBe('https://app.test/login/ZG9j+/a=');
    });
  });

  describe('toMailSubject', () => {
    it('removes line breaks and control characters', () => {
      expect(toMailSubject('Hello\r\nBcc: x@y.com\u0000 ')).toBe('Hello Bcc: x@y.com');
      expect(toMailSubject(undefined)).toBe('');
    });
  });

  describe('renderMailTemplate', () => {
    it('escapes variables in the body and keeps the subject as plain text', () => {
      const result = renderMailTemplate('Sign {{document_title}}', '<p>{{document_title}}</p>', {
        document_title: '<script>alert(1)</script> & $&',
      });

      expect(result.subject).toBe('Sign <script>alert(1)</script> & $&');
      expect(result.body).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; $&amp;</p>');
    });

    it('renders missing values as empty text', () => {
      expect(renderMailTemplate('{{note}}x', '<p>{{note}}</p>', { note: undefined })).toEqual({
        subject: 'x',
        body: '<p></p>',
      });
    });
  });

  describe('replaceMailVaribles', () => {
    it('inserts replacement patterns literally', () => {
      const result = replaceMailVaribles('{{name}}', '<b>{{name}}</b>', { name: "$& $1 $' $`" });

      expect(result).toEqual({ subject: "$& $1 $' $`", body: "<b>$& $1 $' $`</b>" });
    });
  });
});
