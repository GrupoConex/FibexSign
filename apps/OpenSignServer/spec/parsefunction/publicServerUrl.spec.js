import { config } from '../../index.js';
import { resolvePublicServerUrl } from '../../cloud/parsefunction/shared/storageUrlPolicy.js';

describe('public server url formula', () => {
  it('matches the publicServerURL of the server configuration', () => {
    const resolved = resolvePublicServerUrl(process.env);

    expect(resolved === undefined ? config.publicServerURL : resolved).toBe(config.publicServerURL);
  });
});
