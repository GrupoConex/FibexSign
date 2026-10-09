const WEB_PROTOCOLS = ['http:', 'https:'];
const LOCAL_FILES_SEGMENT = '/files/';
const LEGACY_HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;
const MAX_REPORTED_HOSTS = 100;

const reportedUntrustedHosts = new Set();

const parseWebUrl = value => {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const url = new URL(value);
    const hasCredentials = Boolean(url.username || url.password);
    return WEB_PROTOCOLS.includes(url.protocol) && !hasCredentials ? url : null;
  } catch {
    return null;
  }
};

const parseConfiguredUrl = value => {
  if (!value || value.startsWith('/')) return null;
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return parseWebUrl(withProtocol);
};

const parseConfiguredHost = value => parseConfiguredUrl(value)?.host ?? null;

export const resolvePublicServerUrl = (env = process.env) =>
  env.PUBLIC_URL ? `${env.PUBLIC_URL.replace(/\/$/, '')}${env.PARSE_MOUNT || '/app'}` : undefined;

const hostMatchesConfigured = (url, configuredValue) => {
  const configuredHost = parseConfiguredHost(configuredValue);
  return configuredHost !== null && url.host === configuredHost;
};

const splitLegacyEntries = env =>
  (env.STORAGE_LEGACY_HOSTS ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);

const getLegacyHosts = env =>
  splitLegacyEntries(env)
    .map(entry => entry.toLowerCase())
    .filter(entry => LEGACY_HOST_PATTERN.test(entry));

export const reportInvalidLegacyHosts = (env = process.env) => {
  const invalidEntries = splitLegacyEntries(env).filter(
    entry => !LEGACY_HOST_PATTERN.test(entry.toLowerCase())
  );
  if (invalidEntries.length > 0) {
    console.warn(
      `STORAGE_LEGACY_HOSTS ignored invalid entries (expected comma separated hosts without scheme): ${invalidEntries.join(', ')}`
    );
  }
};

const matchesLegacyHost = (url, env) => getLegacyHosts(env).includes(url.host);

const getBucketName = env => env.DO_SPACE?.toLowerCase() ?? '';

const matchesVirtualHostedBucket = (url, env) => {
  const endpointHost = parseConfiguredHost(env.DO_ENDPOINT);
  const bucket = getBucketName(env);
  return Boolean(bucket && endpointHost && url.host === `${bucket}.${endpointHost}`);
};

const matchesPathStyleBucket = (url, env) => {
  const bucket = getBucketName(env);
  return Boolean(
    bucket &&
    hostMatchesConfigured(url, env.DO_ENDPOINT) &&
    url.pathname.toLowerCase().startsWith(`/${bucket}/`)
  );
};

export const isTrustedS3Url = (value, env = process.env) => {
  const url = parseWebUrl(value);
  if (!url) return false;
  return (
    hostMatchesConfigured(url, env.DO_BASEURL) ||
    matchesVirtualHostedBucket(url, env) ||
    matchesPathStyleBucket(url, env) ||
    matchesLegacyHost(url, env)
  );
};

const stripTrailingSlash = pathname => pathname.replace(/\/+$/, '');

const matchesConfiguredFilesMount = (url, configuredValue) => {
  const configured = parseConfiguredUrl(configuredValue);
  if (!configured || configured.host !== url.host) return false;
  return url.pathname.startsWith(
    `${stripTrailingSlash(configured.pathname)}${LOCAL_FILES_SEGMENT}`
  );
};

const matchesLegacyFilesPath = (url, env) =>
  matchesLegacyHost(url, env) && url.pathname.includes(LOCAL_FILES_SEGMENT);

export const parseTrustedLocalFileUrl = (value, env = process.env) => {
  const url = parseWebUrl(value);
  if (!url) return null;
  const isTrusted =
    matchesConfiguredFilesMount(url, resolvePublicServerUrl(env)) ||
    matchesConfiguredFilesMount(url, env.PUBLIC_URL) ||
    matchesConfiguredFilesMount(url, env.SERVER_URL) ||
    matchesLegacyFilesPath(url, env);
  return isTrusted ? url : null;
};

export const isTrustedLocalFileUrl = (value, env = process.env) =>
  parseTrustedLocalFileUrl(value, env) !== null;

export const isTrustedStorageUrl = (value, env = process.env) =>
  isTrustedS3Url(value, env) || isTrustedLocalFileUrl(value, env);

export const reportUntrustedStorageHost = value => {
  const host = parseWebUrl(value)?.host;
  if (!host || reportedUntrustedHosts.has(host)) return;
  if (reportedUntrustedHosts.size >= MAX_REPORTED_HOSTS) return;
  reportedUntrustedHosts.add(host);
  console.warn(
    `Storage url with untrusted host left unsigned: ${host}. Add it to STORAGE_LEGACY_HOSTS if it is a legacy storage host.`
  );
};

export const resetUntrustedHostReportsForTesting = () => reportedUntrustedHosts.clear();

reportInvalidLegacyHosts();
