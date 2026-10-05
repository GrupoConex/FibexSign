import sendmailv3 from '../../cloud/parsefunction/sendMailv3.js';
import { resetCommsMailBreaker } from '../../cloud/parsefunction/shared/commsMailClient.js';

const COMMS_KEYS = ['COMMS_BASE_URL', 'COMMS_API_KEY'];
const PARAMS = { recipient: 'a@x.com', subject: 'S', html: '<p>h</p>', from: 'Sender' };

const captureRejection = async promise => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return undefined;
};

describe('sendmailv3 authorization', () => {
  let saved;
  let fetchSpy;

  beforeEach(() => {
    resetCommsMailBreaker();
    saved = Object.fromEntries(COMMS_KEYS.map(key => [key, process.env[key]]));
    process.env.COMMS_BASE_URL = 'https://comms.test';
    process.env.COMMS_API_KEY = 'test-key';
    spyOn(console, 'log');
    fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo({ status: 201 });
  });

  afterEach(() => {
    COMMS_KEYS.forEach(key => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
  });

  it('rejects callers without a session using INVALID_SESSION_TOKEN and sends nothing', async () => {
    const thrown = await captureRejection(sendmailv3({ params: PARAMS }));

    expect(thrown).toEqual(jasmine.any(Parse.Error));
    expect(thrown.code).toBe(Parse.Error.INVALID_SESSION_TOKEN);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects callers explicitly flagged as non master without a user', async () => {
    const thrown = await captureRejection(sendmailv3({ params: PARAMS, master: false }));

    expect(thrown.code).toBe(209);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends for an authenticated user', async () => {
    const result = await sendmailv3({ params: PARAMS, user: { id: 'user1' } });

    expect(result).toEqual({ status: 'success' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('sends when called with the master key', async () => {
    const result = await sendmailv3({ params: PARAMS, master: true });

    expect(result).toEqual({ status: 'success' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('answers 209 through the registered cloud function when no session is sent', async () => {
    Parse.User.logOut();

    const thrown = await captureRejection(Parse.Cloud.run('sendmailv3', PARAMS));

    expect(thrown.code).toBe(Parse.Error.INVALID_SESSION_TOKEN);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
