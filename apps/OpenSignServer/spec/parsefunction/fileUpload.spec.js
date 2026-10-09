import jwt from 'jsonwebtoken';
import { captureRejection, createPlainUser, purgeCreatedAccounts } from '../utils/auth-fixtures.js';

const INVALID_SESSION_TOKEN = 209;
const VALIDATION_ERROR = 142;
const FOREIGN_FILE_URL = 'https://attacker.example/files/test/private-contract.pdf';

const ownFileUrl = () => `${process.env.SERVER_URL}/files/test/upload.png`;

describe('fileupload cloud function', () => {
  let signer;

  beforeEach(async () => {
    signer = await createPlainUser();
  });

  afterEach(() => purgeCreatedAccounts());

  it('signs a local file of this server for a signed in caller', async () => {
    const result = await Parse.Cloud.run(
      'fileupload',
      { url: ownFileUrl() },
      { sessionToken: signer.sessionToken }
    );

    expect(jwt.decode(new URL(result.url).searchParams.get('token')).fileUrl).toBe(ownFileUrl());
  });

  it('signs the url without its query string', async () => {
    const result = await Parse.Cloud.run(
      'fileupload',
      { url: `${ownFileUrl()}?x=1` },
      { sessionToken: signer.sessionToken }
    );

    const signedUrl = new URL(result.url);
    expect(jwt.decode(signedUrl.searchParams.get('token')).fileUrl).toBe(ownFileUrl());
    expect(signedUrl.searchParams.has('x')).toBeFalse();
    expect(result.url.startsWith(`${ownFileUrl()}?token=`)).toBeTrue();
  });

  it('refuses an anonymous caller', async () => {
    const failure = await captureRejection(Parse.Cloud.run('fileupload', { url: ownFileUrl() }));

    expect(failure.code).toBe(INVALID_SESSION_TOKEN);
  });

  it('refuses a foreign host url for a signed in caller', async () => {
    const failure = await captureRejection(
      Parse.Cloud.run(
        'fileupload',
        { url: FOREIGN_FILE_URL },
        { sessionToken: signer.sessionToken }
      )
    );

    expect(failure.code).toBe(VALIDATION_ERROR);
  });

  it('refuses a url outside the files path of this server', async () => {
    const failure = await captureRejection(
      Parse.Cloud.run(
        'fileupload',
        { url: `${process.env.SERVER_URL}/users/me` },
        { sessionToken: signer.sessionToken }
      )
    );

    expect(failure.code).toBe(VALIDATION_ERROR);
  });

  it('refuses a missing or non string url', async () => {
    for (const url of [undefined, null, 42, { $ne: '' }]) {
      const failure = await captureRejection(
        Parse.Cloud.run('fileupload', { url }, { sessionToken: signer.sessionToken })
      );

      expect(failure.code).toBe(VALIDATION_ERROR);
    }
  });
});
