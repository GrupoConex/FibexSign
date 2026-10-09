import { persistSignature, pickAllFields, pickProvidedFields } from './signatureRecord.js';

describe('signatureRecord field selection', () => {
  const params = { signature: 'a', initials: 'b', stamp: 'c', title: 'd', id: 'x', userId: 'y' };

  it('maps every supported parameter to its column', () => {
    expect(pickProvidedFields(params)).toEqual({
      ImageURL: 'a',
      Initials: 'b',
      Stamp: 'c',
      SignatureName: 'd',
    });
  });

  it('ignores parameters that are not signature columns', () => {
    expect(Object.keys(pickProvidedFields(params))).not.toContain('UserId');
    expect(Object.keys(pickAllFields(params))).not.toContain('UserId');
  });

  it('skips the parameters that were not sent', () => {
    expect(pickProvidedFields({ stamp: 'c' })).toEqual({ Stamp: 'c' });
  });

  it('skips empty parameters when only provided fields are wanted', () => {
    expect(pickProvidedFields({ signature: '', initials: null })).toEqual({});
  });

  it('defaults every missing column to an empty string for full updates', () => {
    expect(pickAllFields({ signature: 'a' })).toEqual({
      ImageURL: 'a',
      Initials: '',
      Stamp: '',
      SignatureName: '',
    });
  });

  it('does not mutate the received parameters', () => {
    const received = Object.freeze({ ...params });

    expect(() => pickAllFields(received)).not.toThrow();
  });
});

describe('signatureRecord image url validation', () => {
  const TRUSTED_BASE = 'https://cdn.firma.example';
  const session = { user: { id: 'owner' }, params: {} };
  let restoreEnv;

  beforeEach(() => {
    const previous = process.env.DO_BASEURL;
    process.env.DO_BASEURL = TRUSTED_BASE;
    restoreEnv = () => {
      if (previous === undefined) delete process.env.DO_BASEURL;
      else process.env.DO_BASEURL = previous;
    };
    spyOn(Parse.Object.prototype, 'save').and.resolveTo({});
  });

  afterEach(() => restoreEnv());

  const attemptSave = imageUrl => persistSignature(session, { ImageURL: imageUrl });

  const accepted = {
    'an uppercase extension': `${TRUSTED_BASE}/files/app/abc.PNG`,
    'a mixed case jpeg extension': `${TRUSTED_BASE}/files/app/abc.JpEg`,
    'a query string after the extension': `${TRUSTED_BASE}/files/app/abc.png?x=1`,
  };
  Object.entries(accepted).forEach(([name, url]) => {
    it(`accepts ${name}`, async () => {
      await expectAsync(attemptSave(url)).toBeResolved();
    });
  });

  const rejected = {
    'a key ending in png without a dot': `${TRUSTED_BASE}/files/app/abcpng`,
    'a key ending in gif without a dot': `${TRUSTED_BASE}/files/app/filexgif`,
    'a non image extension with an image like query': `${TRUSTED_BASE}/files/app/abc.pdf?x=.png`,
    'an image like fragment on a non image key': `${TRUSTED_BASE}/files/app/abc.pdf#.png`,
  };
  Object.entries(rejected).forEach(([name, url]) => {
    it(`rejects ${name}`, async () => {
      await expectAsync(attemptSave(url)).toBeRejectedWithError(/Invalid ImageURL/);
    });
  });
});
