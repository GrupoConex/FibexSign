import { CommsMailError } from '../../../cloud/parsefunction/shared/commsMailClient.js';
import {
  deliverViaComms,
  toCommsMessage,
} from '../../../cloud/parsefunction/shared/commsMailDelivery.js';

const MESSAGE = { to: 'a@x.com', subject: 'S', text: 'secret-body' };

describe('commsMailDelivery', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = spyOn(console, 'log');
  });

  describe('deliverViaComms', () => {
    it('returns success and counts the mail for the external user', async () => {
      const sendMail = jasmine.createSpy('sendMail').and.resolveTo([]);
      const countMail = jasmine.createSpy('countMail').and.resolveTo();

      const result = await deliverViaComms(MESSAGE, {
        extUserId: 'ext1',
        label: 'lbl',
        sendMail,
        countMail,
      });

      expect(result).toEqual({ status: 'success' });
      expect(sendMail).toHaveBeenCalledWith(MESSAGE, { lane: 'system' });
      expect(countMail).toHaveBeenCalledOnceWith('ext1');
    });

    it('sends through the requested lane', async () => {
      const sendMail = jasmine.createSpy('sendMail').and.resolveTo([]);

      await deliverViaComms(MESSAGE, {
        label: 'lbl',
        lane: 'bulk',
        sendMail,
        countMail: async () => {},
      });

      expect(sendMail).toHaveBeenCalledWith(MESSAGE, { lane: 'bulk' });
    });

    it('does not count when there is no external user', async () => {
      const countMail = jasmine.createSpy('countMail');

      await deliverViaComms(MESSAGE, {
        label: 'lbl',
        sendMail: async () => [],
        countMail,
      });

      expect(countMail).not.toHaveBeenCalled();
    });

    it('returns error and does not count when sending fails', async () => {
      const countMail = jasmine.createSpy('countMail');
      const sendMail = async () => {
        throw new CommsMailError('rate_limited', 429);
      };

      const result = await deliverViaComms(MESSAGE, {
        extUserId: 'ext1',
        label: 'lbl',
        sendMail,
        countMail,
      });

      expect(result).toEqual({ status: 'error' });
      expect(countMail).not.toHaveBeenCalled();
    });

    it('logs only the fixed reason and status for comms errors', async () => {
      const sendMail = async () => {
        throw new CommsMailError('rate_limited', 429);
      };

      await deliverViaComms(MESSAGE, { label: 'lbl', sendMail, countMail: async () => {} });

      expect(logSpy).toHaveBeenCalledOnceWith(
        'lbl Error: Comms mail failed: rate_limited (status 429)'
      );
    });

    it('logs a generic reason for unexpected errors without their message', async () => {
      const sendMail = async () => {
        throw new Error('secret-body a@x.com');
      };

      const result = await deliverViaComms(MESSAGE, {
        label: 'lbl',
        sendMail,
        countMail: async () => {},
      });

      expect(result).toEqual({ status: 'error' });
      expect(logSpy).toHaveBeenCalledOnceWith('lbl Error: unexpected_error');
    });
  });

  describe('toCommsMessage', () => {
    it('maps legacy params and defaults text', () => {
      expect(
        toCommsMessage({ recipient: 'a@x.com', cc: 'c', bcc: 'b', subject: 'S', html: 'h' })
      ).toEqual({ to: 'a@x.com', cc: 'c', bcc: 'b', subject: 'S', text: 'mail', html: 'h' });
    });
  });
});
