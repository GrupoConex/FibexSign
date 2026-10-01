import { randomBytes } from 'node:crypto';

const GUEST_PASSWORD_BYTES = 32;

export const generateGuestPassword = () => randomBytes(GUEST_PASSWORD_BYTES).toString('hex');
