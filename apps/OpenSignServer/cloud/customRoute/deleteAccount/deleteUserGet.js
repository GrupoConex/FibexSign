import { randomBytes } from 'node:crypto';
import { findOwnExtUser } from './accountLookup.js';
import { isValidUserId, renderDeletePage } from './deletePageTemplate.js';

const NONCE_BYTES = 16;

const buildContentSecurityPolicy = nonce =>
  [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ');

export const deleteUserGet = async (req, res) => {
  const { userId } = req.params;
  if (!isValidUserId(userId)) return res.status(404).send('User not found.');

  const extUser = await findOwnExtUser(userId);
  if (!extUser) return res.status(404).send('User not found.');

  const nonce = randomBytes(NONCE_BYTES).toString('base64');
  const routePath = process.env.SERVER_URL.includes('api') ? '/api' : '';
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', buildContentSecurityPolicy(nonce));
  return res.send(renderDeletePage({ routePath, userId, nonce }));
};
