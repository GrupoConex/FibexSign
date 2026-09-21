import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Utils from '../Utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const filesWithoutSupportChannelLeaks = [
  '../cloud/parsefunction/sendMailv3.js',
  '../cloud/parsefunction/sendMailWithAttachment.js',
  '../cloud/parsefunction/sendSystemMail.js',
  '../cloud/parsefunction/pdf/PDF.js',
  '../cloud/parsefunction/generateCertificatebydocId.js',
];

describe('supportEmail is fully removed (no unauthorized support channel leaks)', () => {
  it('does not export supportEmail from Utils.js', () => {
    expect(Object.prototype.hasOwnProperty.call(Utils, 'supportEmail')).toBe(false);
    expect(Utils.supportEmail).toBeUndefined();
  });

  filesWithoutSupportChannelLeaks.forEach(relativePath => {
    it(`does not reference supportEmail or eSigncontact in ${relativePath}`, () => {
      const absolutePath = path.join(__dirname, relativePath);
      const content = fs.readFileSync(absolutePath, 'utf8');
      expect(content).not.toContain('supportEmail');
      expect(content).not.toContain('eSigncontact');
    });
  });
});
