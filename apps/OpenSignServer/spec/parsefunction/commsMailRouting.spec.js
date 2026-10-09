import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CommsLane,
  resetCommsMailBreaker,
  sendCommsMail,
} from '../../cloud/parsefunction/shared/commsMailClient.js';
import sendmailv3, { deliverMailv3 } from '../../cloud/parsefunction/sendMailv3.js';
import sendSystemMail from '../../cloud/parsefunction/sendSystemMail.js';
import sendMailWithAttachment from '../../cloud/parsefunction/sendMailWithAttachment.js';

const COMMS_KEYS = ['COMMS_BASE_URL', 'COMMS_API_KEY'];
const SECRET_HTML = '<p>secret-body</p>';

const okResponse = () => ({ status: 201, json: async () => ({ status: 'SENT' }) });
const failResponse = () => ({ status: 502, json: async () => ({ error: 'Provider down' }) });

const sentBodies = fetchSpy => fetchSpy.calls.allArgs().map(args => JSON.parse(args[1].body));

const baseParams = {
  recipient: 'A@x.com',
  cc: 'c@x.com',
  bcc: 'b@x.com',
  subject: 'Subject',
  text: 'plain',
  html: SECRET_HTML,
  from: 'Sender',
};

const enableComms = () => {
  process.env.COMMS_BASE_URL = 'https://comms.test';
  process.env.COMMS_API_KEY = 'test-key';
};

describe('comms mail routing', () => {
  let saved;
  let fetchSpy;

  beforeEach(() => {
    resetCommsMailBreaker();
    saved = Object.fromEntries(COMMS_KEYS.map(key => [key, process.env[key]]));
    enableComms();
    spyOn(console, 'log');
    fetchSpy = spyOn(globalThis, 'fetch').and.callFake(async () => okResponse());
  });

  afterEach(() => {
    COMMS_KEYS.forEach(key => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
  });

  [
    [
      'sendMailv3',
      sendmailv3,
      params => ({ params, master: true }),
      ['a@x.com', 'c@x.com', 'b@x.com'],
    ],
    ['sendSystemMail', sendSystemMail, params => ({ params }), ['a@x.com', 'b@x.com']],
  ].forEach(([name, fn, wrap, expectedRecipients]) => {
    describe(name, () => {
      it('sends through comms to every recipient and returns success', async () => {
        const result = await fn(wrap(baseParams));

        expect(result).toEqual({ status: 'success' });
        expect(sentBodies(fetchSpy).map(body => body.to)).toEqual(expectedRecipients);
        expect(sentBodies(fetchSpy)[0]).toEqual({
          to: 'a@x.com',
          subject: 'Subject',
          text: 'plain',
          html: SECRET_HTML,
        });
      });

      it('returns error without any request when there are no recipients', async () => {
        const result = await fn(
          wrap({ ...baseParams, recipient: ' ', cc: undefined, bcc: undefined })
        );

        expect(result).toEqual({ status: 'error' });
        expect(fetchSpy).not.toHaveBeenCalled();
      });

      it('returns error without any request above the recipient cap', async () => {
        const recipient = Array.from({ length: 21 }, (_, index) => `u${index}@x.com`);

        const result = await fn(wrap({ ...baseParams, recipient, cc: undefined, bcc: undefined }));

        expect(result).toEqual({ status: 'error' });
        expect(fetchSpy).not.toHaveBeenCalled();
      });

      it('defaults text to mail when omitted', async () => {
        await fn(wrap({ ...baseParams, text: undefined, cc: undefined, bcc: undefined }));

        expect(sentBodies(fetchSpy)[0].text).toBe('mail');
      });

      it('returns error without leaking content when comms fails', async () => {
        fetchSpy.and.callFake(async () => failResponse());

        const result = await fn(wrap(baseParams));

        expect(result).toEqual({ status: 'error' });
        const logged = console.log.calls.allArgs().flat().join(' ');
        expect(logged).toContain('provider_error (status 502)');
        expect(logged).not.toContain(SECRET_HTML);
      });
    });
  });

  describe('sendMailWithAttachment', () => {
    let tempDir;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comms-attach-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns error without any request when there are no recipients', async () => {
      const result = await sendMailWithAttachment({
        ...baseParams,
        recipient: '',
        cc: '',
        bcc: '',
      });

      expect(result).toEqual({ status: 'error' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sends without url through comms and returns success', async () => {
      const result = await sendMailWithAttachment(baseParams);

      expect(result).toEqual({ status: 'success' });
      expect(sentBodies(fetchSpy).length).toBe(3);
    });

    it('drops attachments and removes the certificate file when url is provided', async () => {
      const certificatePath = path.join(tempDir, 'certificate.pdf');
      fs.writeFileSync(certificatePath, 'pdf');

      const result = await sendMailWithAttachment({
        ...baseParams,
        url: 'http://localhost:1/file.pdf',
        certificatePath,
      });

      expect(result).toEqual({ status: 'success' });
      expect(fs.existsSync(certificatePath)).toBe(false);
      sentBodies(fetchSpy).forEach(body => {
        expect(Object.keys(body)).not.toContain('attachments');
        expect(Object.keys(body)).not.toContain('attachment');
      });
    });

    it('keeps the certificate file when comms fails', async () => {
      fetchSpy.and.callFake(async () => failResponse());
      const certificatePath = path.join(tempDir, 'certificate.pdf');
      fs.writeFileSync(certificatePath, 'pdf');

      const result = await sendMailWithAttachment({
        ...baseParams,
        url: 'http://localhost:1/file.pdf',
        certificatePath,
      });

      expect(result).toEqual({ status: 'error' });
      expect(fs.existsSync(certificatePath)).toBe(true);
    });
  });

  describe('lanes', () => {
    const tripBulkLane = () =>
      sendCommsMail(
        { to: 'trip@x.com', subject: 'S' },
        {
          env: process.env,
          lane: CommsLane.BULK,
          fetchImpl: async () => ({ status: 429, json: async () => ({}) }),
        }
      ).catch(() => undefined);

    const mailParams = { recipient: 'a@x.com', subject: 'S', html: '<p>h</p>' };

    it('sends the sendmailv3 wrapper through the bulk lane', async () => {
      await tripBulkLane();

      const result = await sendmailv3({ params: mailParams, master: true });

      expect(result).toEqual({ status: 'error' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sends in-process deliverMailv3 through the system lane', async () => {
      await tripBulkLane();

      const result = await deliverMailv3({ params: mailParams });

      expect(result).toEqual({ status: 'success' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('sends sendSystemMail through the system lane', async () => {
      await tripBulkLane();

      const result = await sendSystemMail({ params: mailParams });

      expect(result).toEqual({ status: 'success' });
    });

    it('sends sendMailWithAttachment through the system lane', async () => {
      await tripBulkLane();

      const result = await sendMailWithAttachment(mailParams);

      expect(result).toEqual({ status: 'success' });
    });
  });
});
