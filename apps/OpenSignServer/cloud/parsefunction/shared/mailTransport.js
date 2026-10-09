import {
  CommsLane,
  collectRecipients,
  isCommsMailEnabled,
  sendCommsMail,
} from './commsMailClient.js';

const DEFAULT_SMTP_PORT = 465;
const LOCAL_SENDER_ADDRESS = 'dev@localhost';

export const MailTransport = Object.freeze({
  COMMS: 'comms',
  SMTP: 'smtp',
  MAILGUN: 'mailgun',
  DISABLED: 'disabled',
});

const SENDER_TRANSPORTS = [MailTransport.SMTP, MailTransport.MAILGUN];

export const resolveMailTransport = (env = process.env) => {
  if (isCommsMailEnabled(env)) return MailTransport.COMMS;
  if (env.SMTP_ENABLE?.toLowerCase() === 'true') return MailTransport.SMTP;
  if (env.MAILGUN_API_KEY) return MailTransport.MAILGUN;
  return MailTransport.DISABLED;
};

const adapterPayloadToCommsMessage = ({ to, subject, text, html }) => ({
  to,
  subject,
  text,
  html,
});

const handleDisabled = (payload, { env, logger }) => {
  if (env.NODE_ENV === 'production') {
    throw new Error('Email transport is not configured');
  }
  const count = collectRecipients({ to: payload?.to }).length;
  logger.log(`[dev email adapter] Email to ${count} recipient(s) not sent (no mail transport)`);
};

export const createMailApiCallback = ({
  transport,
  env = process.env,
  logger = console,
  sendComms = sendCommsMail,
  sendSmtp,
  sendMailgun,
}) => {
  const senders = {
    [MailTransport.COMMS]: payload =>
      sendComms(adapterPayloadToCommsMessage(payload), { env, lane: CommsLane.CRITICAL }),
    [MailTransport.SMTP]: payload => sendSmtp(payload),
    [MailTransport.MAILGUN]: payload => sendMailgun(payload),
  };
  return async ({ payload }) => {
    const send = senders[transport];
    if (!send) return handleDisabled(payload, { env, logger });
    await send(payload);
  };
};

export const buildMailAdapterSender = (appName, transport, senderAddress) => {
  const address = SENDER_TRANSPORTS.includes(transport) ? senderAddress : LOCAL_SENDER_ADDRESS;
  return `${appName} <${address}>`;
};

const buildSmtpConfig = env => {
  const config = {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT || DEFAULT_SMTP_PORT,
    secure: !(env.SMTP_PORT && env.SMTP_PORT !== String(DEFAULT_SMTP_PORT)),
  };
  if (!env.SMTP_USERNAME || !env.SMTP_PASS) return config;
  return { ...config, auth: { user: env.SMTP_USERNAME, pass: env.SMTP_PASS } };
};

const initSmtp = async (env, createSmtpTransport, logger) => {
  try {
    const smtpTransporter = createSmtpTransport(buildSmtpConfig(env));
    await smtpTransporter.verify();
    return { transport: MailTransport.SMTP, smtpTransporter };
  } catch {
    logger.log('Mail transport smtp failed to initialize');
    return { transport: MailTransport.DISABLED };
  }
};

const initMailgun = (env, createMailgunClient, logger) => {
  try {
    return {
      transport: MailTransport.MAILGUN,
      mailgunClient: createMailgunClient(env.MAILGUN_API_KEY),
      mailgunDomain: env.MAILGUN_DOMAIN,
    };
  } catch {
    logger.log('Mail transport mailgun failed to initialize');
    return { transport: MailTransport.DISABLED };
  }
};

const initTransport = (transport, { env, createSmtpTransport, createMailgunClient, logger }) => {
  if (transport === MailTransport.SMTP) return initSmtp(env, createSmtpTransport, logger);
  if (transport === MailTransport.MAILGUN) return initMailgun(env, createMailgunClient, logger);
  return { transport };
};

export const buildMailTransportState = async ({
  env = process.env,
  createSmtpTransport,
  createMailgunClient,
  logger = console,
}) => {
  const state = await initTransport(resolveMailTransport(env), {
    env,
    createSmtpTransport,
    createMailgunClient,
    logger,
  });
  if (state.transport === MailTransport.DISABLED && env.NODE_ENV === 'production') {
    logger.error('Mail transport is disabled in production: email sending will fail');
  }
  return state;
};
