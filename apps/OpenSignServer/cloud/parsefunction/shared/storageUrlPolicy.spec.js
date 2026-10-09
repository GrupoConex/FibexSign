import {
  isTrustedLocalFileUrl,
  isTrustedS3Url,
  isTrustedStorageUrl,
  parseTrustedLocalFileUrl,
  reportInvalidLegacyHosts,
  resolvePublicServerUrl,
  reportUntrustedStorageHost,
  resetUntrustedHostReportsForTesting,
} from './storageUrlPolicy.js';

const ENV = {
  DO_SPACE: 'vault',
  DO_ENDPOINT: 'ams3.digitaloceanspaces.com',
  DO_BASEURL: 'https://cdn.firma.example',
  SERVER_URL: 'https://api.firma.example/app',
  PUBLIC_URL: 'https://public.firma.example/app',
};

describe('storageUrlPolicy', () => {
  describe('isTrustedS3Url', () => {
    const trusted = {
      'the configured base url': 'https://cdn.firma.example/abc_sign.png',
      'the virtual hosted bucket': 'https://vault.ams3.digitaloceanspaces.com/abc_sign.png',
      'the path style bucket': 'https://ams3.digitaloceanspaces.com/vault/abc_sign.png',
      'a presigned url of the bucket': 'https://cdn.firma.example/abc.png?X-Amz-Signature=1',
    };
    Object.entries(trusted).forEach(([name, url]) => {
      it(`accepts ${name}`, () => {
        expect(isTrustedS3Url(url, ENV)).toBeTrue();
      });
    });

    const rejected = {
      'a foreign host': 'https://attacker.example/abc.png',
      'another bucket on the same endpoint': 'https://ams3.digitaloceanspaces.com/other/abc.png',
      'another space virtual host': 'https://other.ams3.digitaloceanspaces.com/abc.png',
      'a host that only embeds the trusted one': 'https://cdn.firma.example.attacker.example/a.png',
      'credentials smuggling the trusted host': 'https://cdn.firma.example@attacker.example/a.png',
      'a non http protocol': 'ftp://cdn.firma.example/a.png',
      'the api server host': 'https://api.firma.example/app/files/test/a.png',
      'a malformed value': 'not a url',
      'an empty value': '',
    };
    Object.entries(rejected).forEach(([name, url]) => {
      it(`rejects ${name}`, () => {
        expect(isTrustedS3Url(url, ENV)).toBeFalse();
      });
    });

    it('rejects non string values', () => {
      [null, undefined, 42, {}, ['https://cdn.firma.example/a.png']].forEach(value => {
        expect(isTrustedS3Url(value, ENV)).toBeFalse();
      });
    });

    it('rejects everything when no storage is configured', () => {
      expect(isTrustedS3Url('https://cdn.firma.example/a.png', {})).toBeFalse();
    });
  });

  describe('isTrustedLocalFileUrl', () => {
    it('accepts a file served by the api host', () => {
      expect(
        isTrustedLocalFileUrl('https://api.firma.example/app/files/test/a.png', ENV)
      ).toBeTrue();
    });

    it('accepts a file served by the public host with a token', () => {
      const url = 'https://public.firma.example/app/files/test/a.png?token=abc';
      expect(isTrustedLocalFileUrl(url, ENV)).toBeTrue();
    });

    it('rejects a foreign host even with a files path', () => {
      expect(isTrustedLocalFileUrl('https://attacker.example/files/test/a.png', ENV)).toBeFalse();
    });

    it('rejects an own host path outside files', () => {
      expect(isTrustedLocalFileUrl('https://api.firma.example/app/users/me', ENV)).toBeFalse();
    });

    it('rejects a relative server url configuration', () => {
      expect(isTrustedLocalFileUrl('https://app/files/a.png', { SERVER_URL: '/app' })).toBeFalse();
    });
  });

  describe('isTrustedStorageUrl', () => {
    it('accepts both storage kinds and nothing else', () => {
      expect(isTrustedStorageUrl('https://cdn.firma.example/a.png', ENV)).toBeTrue();
      expect(isTrustedStorageUrl('https://api.firma.example/app/files/t/a.png', ENV)).toBeTrue();
      expect(isTrustedStorageUrl('https://attacker.example/a.png', ENV)).toBeFalse();
    });
  });

  describe('legacy hosts', () => {
    const LEGACY_ENV = {
      ...ENV,
      STORAGE_LEGACY_HOSTS: 'old-cdn.example, Bucket.S3.amazonaws.com ,,legacy.example:8443',
    };

    it('trusts bucket urls served by a legacy host', () => {
      expect(isTrustedS3Url('https://old-cdn.example/a.png', LEGACY_ENV)).toBeTrue();
      expect(isTrustedS3Url('https://bucket.s3.amazonaws.com/a.png', LEGACY_ENV)).toBeTrue();
      expect(isTrustedS3Url('https://legacy.example:8443/a.png', LEGACY_ENV)).toBeTrue();
    });

    it('trusts local file urls served by a legacy host', () => {
      expect(
        isTrustedLocalFileUrl('https://old-cdn.example/app/files/t/a.png', LEGACY_ENV)
      ).toBeTrue();
    });

    it('does not trust a legacy host path outside files for local files', () => {
      expect(isTrustedLocalFileUrl('https://old-cdn.example/app/users/me', LEGACY_ENV)).toBeFalse();
    });

    it('does not trust a different port of a legacy host', () => {
      expect(isTrustedS3Url('https://legacy.example/a.png', LEGACY_ENV)).toBeFalse();
    });

    it('ignores invalid entries and keeps the valid ones', () => {
      const env = {
        ...ENV,
        STORAGE_LEGACY_HOSTS: 'https://scheme.example,bad host,old-cdn.example,*.wild.example',
      };

      expect(isTrustedS3Url('https://old-cdn.example/a.png', env)).toBeTrue();
      expect(isTrustedS3Url('https://scheme.example/a.png', env)).toBeFalse();
      expect(isTrustedS3Url('https://x.wild.example/a.png', env)).toBeFalse();
    });

    it('trusts nothing extra when the variable is empty or missing', () => {
      expect(
        isTrustedS3Url('https://old-cdn.example/a.png', { ...ENV, STORAGE_LEGACY_HOSTS: '' })
      ).toBeFalse();
      expect(isTrustedS3Url('https://old-cdn.example/a.png', ENV)).toBeFalse();
    });
  });

  describe('reportInvalidLegacyHosts', () => {
    it('warns once listing the invalid entries', () => {
      const warn = spyOn(console, 'warn');

      reportInvalidLegacyHosts({
        STORAGE_LEGACY_HOSTS: 'good.example,https://bad.example,bad host',
      });

      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.calls.mostRecent().args.join(' ');
      expect(message).toContain('STORAGE_LEGACY_HOSTS');
      expect(message).toContain('https://bad.example');
      expect(message).toContain('bad host');
      expect(message).not.toContain('good.example');
    });

    it('stays silent when every entry is valid or the variable is empty', () => {
      const warn = spyOn(console, 'warn');

      reportInvalidLegacyHosts({ STORAGE_LEGACY_HOSTS: 'good.example' });
      reportInvalidLegacyHosts({ STORAGE_LEGACY_HOSTS: '' });
      reportInvalidLegacyHosts({});

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('case normalization', () => {
    const UPPER_ENV = { ...ENV, DO_SPACE: 'Vault', DO_BASEURL: 'https://CDN.Firma.Example' };

    it('compares the bucket name without case', () => {
      expect(
        isTrustedS3Url('https://vault.ams3.digitaloceanspaces.com/a.png', UPPER_ENV)
      ).toBeTrue();
      expect(
        isTrustedS3Url('https://ams3.digitaloceanspaces.com/vault/a.png', UPPER_ENV)
      ).toBeTrue();
    });

    it('compares configured hosts without case', () => {
      expect(isTrustedS3Url('https://cdn.firma.example/a.png', UPPER_ENV)).toBeTrue();
      expect(isTrustedS3Url('https://CDN.FIRMA.EXAMPLE/a.png', ENV)).toBeTrue();
    });
  });

  describe('local files base path', () => {
    it('rejects a files segment outside the configured base path', () => {
      expect(isTrustedLocalFileUrl('https://api.firma.example/other/files/a.png', ENV)).toBeFalse();
      expect(isTrustedLocalFileUrl('https://api.firma.example/app/x/files/a.png', ENV)).toBeFalse();
    });

    it('accepts a root mounted server', () => {
      const env = { SERVER_URL: 'https://api.firma.example/' };

      expect(isTrustedLocalFileUrl('https://api.firma.example/files/test/a.png', env)).toBeTrue();
      expect(
        isTrustedLocalFileUrl('https://api.firma.example/x/files/test/a.png', env)
      ).toBeFalse();
    });

    it('returns the parsed url of a trusted local file', () => {
      const parsed = parseTrustedLocalFileUrl(
        'https://api.firma.example/app/files/t/a.png?token=1#frag',
        ENV
      );

      expect(parsed.origin + parsed.pathname).toBe('https://api.firma.example/app/files/t/a.png');
    });

    it('returns null for an untrusted local file', () => {
      expect(
        parseTrustedLocalFileUrl('https://attacker.example/app/files/t/a.png', ENV)
      ).toBeNull();
    });
  });

  describe('reportUntrustedStorageHost', () => {
    beforeEach(() => resetUntrustedHostReportsForTesting());

    it('logs each host once without path or query', () => {
      const warn = spyOn(console, 'warn');

      reportUntrustedStorageHost('https://legacy-one.example/secret/path/key.pdf?sig=abc');
      reportUntrustedStorageHost('https://legacy-one.example/another/key.pdf');
      reportUntrustedStorageHost('https://legacy-two.example/key.pdf');

      expect(warn).toHaveBeenCalledTimes(2);
      const first = warn.calls.first().args.join(' ');
      expect(first).toContain('legacy-one.example');
      expect(first).not.toContain('secret');
      expect(first).not.toContain('sig=abc');
    });

    it('ignores values that are not urls', () => {
      const warn = spyOn(console, 'warn');

      [undefined, null, '', 'not a url', 42].forEach(reportUntrustedStorageHost);

      expect(warn).not.toHaveBeenCalled();
    });

    it('stops logging after a bounded number of distinct hosts', () => {
      const warn = spyOn(console, 'warn');

      Array.from({ length: 150 }, (_, index) =>
        reportUntrustedStorageHost(`https://h${index}.example/a`)
      );

      expect(warn.calls.count()).toBeLessThanOrEqual(101);
      expect(warn.calls.count()).toBeGreaterThan(50);
    });
  });
});

describe('storageUrlPolicy public server url mount', () => {
  const LOCAL_DEV_ENV = {
    USE_LOCAL: 'true',
    PUBLIC_URL: 'https://localhost:3001',
    PARSE_MOUNT: '/app',
    SERVER_URL: 'http://127.0.0.1:8080/app',
  };
  const PRODUCTION_ENV = {
    PUBLIC_URL: 'https://app.fibexsign.com/',
    SERVER_URL: 'https://app.fibexsign.com/api/app',
  };

  it('trusts files under the public server url of the local dev configuration', () => {
    expect(
      isTrustedLocalFileUrl('https://localhost:3001/app/files/test/abc.png', LOCAL_DEV_ENV)
    ).toBeTrue();
  });

  it('trusts files under the public server url of the production configuration', () => {
    expect(
      isTrustedLocalFileUrl('https://app.fibexsign.com/app/files/test/abc.png', PRODUCTION_ENV)
    ).toBeTrue();
  });

  it('honours a custom parse mount', () => {
    const env = { ...LOCAL_DEV_ENV, PARSE_MOUNT: '/parse' };

    expect(isTrustedLocalFileUrl('https://localhost:3001/parse/files/t/a.png', env)).toBeTrue();
    expect(isTrustedLocalFileUrl('https://localhost:3001/app/files/t/a.png', env)).toBeFalse();
  });

  it('keeps the server url base trusted', () => {
    expect(
      isTrustedLocalFileUrl('http://127.0.0.1:8080/app/files/test/abc.png', LOCAL_DEV_ENV)
    ).toBeTrue();
    expect(
      isTrustedLocalFileUrl('https://app.fibexsign.com/api/app/files/test/abc.png', PRODUCTION_ENV)
    ).toBeTrue();
  });

  const outsideTheMount = {
    'a non files path under the mount': 'https://localhost:3001/app/users/me',
    'a foreign host under the mount': 'https://attacker.example/app/files/test/abc.png',
    'a sibling mount prefix': 'https://localhost:3001/application/files/test/abc.png',
  };
  Object.entries(outsideTheMount).forEach(([name, url]) => {
    it(`rejects ${name}`, () => {
      expect(isTrustedLocalFileUrl(url, LOCAL_DEV_ENV)).toBeFalse();
    });
  });

  it('resolves the public server url with the index formula', () => {
    expect(resolvePublicServerUrl(LOCAL_DEV_ENV)).toBe('https://localhost:3001/app');
    expect(resolvePublicServerUrl(PRODUCTION_ENV)).toBe('https://app.fibexsign.com/app');
    expect(resolvePublicServerUrl({ PUBLIC_URL: 'https://x.example', PARSE_MOUNT: '/m' })).toBe(
      'https://x.example/m'
    );
    expect(resolvePublicServerUrl({})).toBeUndefined();
  });
});
