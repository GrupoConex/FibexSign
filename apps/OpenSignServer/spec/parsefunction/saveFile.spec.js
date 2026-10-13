import axios from 'axios';
import {
  captureRejection,
  cloudRunAs,
  createCaller,
  createPlainUser,
  purgeCreatedAccounts,
  silenceConsole,
} from '../utils/auth-fixtures.js';

const INVALID_SESSION_TOKEN = 209;
const OBJECT_NOT_FOUND = 101;
const INVALID_QUERY = 102;
const INVALID_FILE_NAME = 122;
const FILE_TOO_LARGE = 129;
const FILE_SAVE_ERROR = 130;
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const saveFile = (params, account) => cloudRunAs('savefile', params, account?.sessionToken);

describe('savefile cloud function', () => {
  beforeEach(() => {
    silenceConsole();
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  it('returns the url of the uploaded file for a caller with a profile', async () => {
    const caller = await createCaller('contracts_Admin');

    const result = await saveFile(
      { fileBase64: TINY_PNG_BASE64, fileName: 'a.png' },
      caller.account
    );

    expect(typeof result.url).toBe('string');
    expect(result.url.length).toBeGreaterThan(0);
    expect(new URL(result.url).pathname).toContain('/files/');
  });

  it('refuses an unauthenticated call', async () => {
    const failure = await captureRejection(
      saveFile({ fileBase64: TINY_PNG_BASE64, fileName: 'a.png' })
    );

    expect(failure.code).toBe(INVALID_SESSION_TOKEN);
  });

  it('refuses a call without file content', async () => {
    const caller = await createCaller('contracts_Admin');

    const failure = await captureRejection(saveFile({ fileName: 'a.png' }, caller.account));

    expect(failure.code).toBe(INVALID_QUERY);
  });

  it('refuses a caller without a profile', async () => {
    const account = await createPlainUser();

    const failure = await captureRejection(
      saveFile({ fileBase64: TINY_PNG_BASE64, fileName: 'a.png' }, account)
    );

    expect(failure.code).toBe(OBJECT_NOT_FOUND);
  });

  it('refuses an unsupported extension without uploading anything', async () => {
    const caller = await createCaller('contracts_Admin');
    const upload = spyOn(axios, 'post').and.callThrough();

    const failure = await captureRejection(
      saveFile({ fileBase64: TINY_PNG_BASE64, fileName: 'a.exe' }, caller.account)
    );

    expect(failure.code).toBe(INVALID_FILE_NAME);
    expect(upload.calls.allArgs().some(([url]) => String(url).includes('/files/'))).toBeFalse();
  });

  describe('file validation', () => {
    let caller;
    let upload;
    let savedMaxBytes;

    beforeEach(async () => {
      savedMaxBytes = process.env.SAVEFILE_MAX_BYTES;
      caller = await createCaller('contracts_Admin');
      upload = spyOn(axios, 'post').and.callThrough();
    });

    afterEach(() => {
      if (savedMaxBytes === undefined) delete process.env.SAVEFILE_MAX_BYTES;
      else process.env.SAVEFILE_MAX_BYTES = savedMaxBytes;
    });

    const uploadedFiles = () =>
      upload.calls.allArgs().filter(([url]) => String(url).includes('/files/'));

    const rejectionFor = params => captureRejection(saveFile(params, caller.account));

    ['../a.png', 'a/b.png', '.hidden.png', 'a<b>.png', 'a\u0000.png', ''].forEach(fileName => {
      it(`refuses the file name ${JSON.stringify(fileName)}`, async () => {
        const failure = await rejectionFor({ fileBase64: TINY_PNG_BASE64, fileName });

        expect(failure.code).toBe(INVALID_FILE_NAME);
        expect(uploadedFiles()).toEqual([]);
      });
    });

    it('accepts names with spaces, dashes, tildes and at signs', async () => {
      const result = await saveFile(
        { fileBase64: TINY_PNG_BASE64, fileName: 'My file_v2 ~final@x-1.PNG' },
        caller.account
      );

      expect(result.url.length).toBeGreaterThan(0);
    });

    it('refuses a file larger than the configured limit', async () => {
      process.env.SAVEFILE_MAX_BYTES = '10';

      const failure = await rejectionFor({ fileBase64: TINY_PNG_BASE64, fileName: 'a.png' });

      expect(failure.code).toBe(FILE_TOO_LARGE);
      expect(uploadedFiles()).toEqual([]);
    });

    it('refuses content that does not match its extension', async () => {
      const pdfAsPng = Buffer.from('%PDF-1.7 fake').toString('base64');
      const pngAsPdf = TINY_PNG_BASE64;

      const asPng = await rejectionFor({ fileBase64: pdfAsPng, fileName: 'a.png' });
      const asPdf = await rejectionFor({ fileBase64: pngAsPdf, fileName: 'a.pdf' });
      const asJpg = await rejectionFor({ fileBase64: TINY_PNG_BASE64, fileName: 'a.jpg' });

      [asPng, asPdf, asJpg].forEach(failure => expect(failure.code).toBe(INVALID_FILE_NAME));
      expect(uploadedFiles()).toEqual([]);
    });

    it('hides the storage error behind a generic message', async () => {
      upload.and.callFake(async url => {
        if (String(url).includes('/files/')) {
          throw { response: { status: 500, data: { error: 'bucket secret-internal-name' } } };
        }
        throw new Error(`unexpected post ${url}`);
      });

      const failure = await rejectionFor({ fileBase64: TINY_PNG_BASE64, fileName: 'a.png' });

      expect(failure.code).toBe(FILE_SAVE_ERROR);
      expect(failure.message).toBe('File upload failed.');
    });
  });
});
