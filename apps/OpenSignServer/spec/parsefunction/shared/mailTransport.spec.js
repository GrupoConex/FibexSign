import {
  MailTransport,
  buildMailAdapterSender,
  buildMailTransportState,
  createMailApiCallback,
  resolveMailTransport,
} from '../../../cloud/parsefunction/shared/mailTransport.js';

const COMMS = { COMMS_BASE_URL: 'https://c.test', COMMS_API_KEY: 'k' };
const SMTP = {
  SMTP_ENABLE: 'true',
  SMTP_HOST: 'smtp.secret-host.test',
  SMTP_PASS: 'secret-pass',
  SMTP_USERNAME: 'user',
};

const buildLogger = () => ({ log: jasmine.createSpy('log'), error: jasmine.createSpy('error') });

const buildSmtpFactory = (verify = async () => {}) => {
  const transporter = { verify: jasmine.createSpy('verify').and.callFake(verify) };
  return { transporter, create: jasmine.createSpy('createSmtp').and.returnValue(transporter) };
};

describe('mailTransport', () => {
  describe('resolveMailTransport', () => {
    it('prefers comms over smtp and mailgun', () => {
      const env = { ...COMMS, SMTP_ENABLE: 'true', MAILGUN_API_KEY: 'm' };
      expect(resolveMailTransport(env)).toBe(MailTransport.COMMS);
    });

    it('prefers smtp over mailgun', () => {
      expect(resolveMailTransport({ SMTP_ENABLE: 'TRUE', MAILGUN_API_KEY: 'm' })).toBe('smtp');
    });

    it('uses mailgun when only its key is set', () => {
      expect(resolveMailTransport({ MAILGUN_API_KEY: 'm' })).toBe('mailgun');
    });

    it('is disabled when nothing is configured', () => {
      expect(resolveMailTransport({ SMTP_ENABLE: 'false' })).toBe('disabled');
    });

    it('ignores comms when only one variable is set', () => {
      expect(resolveMailTransport({ COMMS_BASE_URL: 'https://c.test' })).toBe('disabled');
    });
  });

  describe('buildMailAdapterSender', () => {
    it('uses the configured sender address for smtp and mailgun', () => {
      expect(buildMailAdapterSender('App', 'smtp', 'no@reply.com')).toBe('App <no@reply.com>');
      expect(buildMailAdapterSender('App', 'mailgun', 'm@x.com')).toBe('App <m@x.com>');
    });

    it('uses the local sender for comms and disabled', () => {
      expect(buildMailAdapterSender('App', 'comms', 'x@y.com')).toBe('App <dev@localhost>');
      expect(buildMailAdapterSender('App', 'disabled', undefined)).toBe('App <dev@localhost>');
    });
  });

  describe('buildMailTransportState', () => {
    it('selects comms without creating smtp or mailgun clients', async () => {
      const createSmtpTransport = jasmine.createSpy('createSmtp');
      const createMailgunClient = jasmine.createSpy('createMailgun');

      const state = await buildMailTransportState({
        env: { ...COMMS, ...SMTP },
        createSmtpTransport,
        createMailgunClient,
        logger: buildLogger(),
      });

      expect(state.transport).toBe('comms');
      expect(createSmtpTransport).not.toHaveBeenCalled();
      expect(createMailgunClient).not.toHaveBeenCalled();
    });

    it('verifies smtp and exposes the transporter with auth', async () => {
      const smtp = buildSmtpFactory();

      const state = await buildMailTransportState({
        env: { ...SMTP, SMTP_PORT: '587' },
        createSmtpTransport: smtp.create,
        logger: buildLogger(),
      });

      expect(state.transport).toBe('smtp');
      expect(state.smtpTransporter).toBe(smtp.transporter);
      expect(smtp.transporter.verify).toHaveBeenCalledTimes(1);
      expect(smtp.create).toHaveBeenCalledWith({
        host: 'smtp.secret-host.test',
        port: '587',
        secure: false,
        auth: { user: 'user', pass: 'secret-pass' },
      });
    });

    it('defaults smtp to secure port 465 without auth when credentials are partial', async () => {
      const smtp = buildSmtpFactory();

      await buildMailTransportState({
        env: { SMTP_ENABLE: 'true', SMTP_HOST: 'h', SMTP_PASS: 'only-pass' },
        createSmtpTransport: smtp.create,
        logger: buildLogger(),
      });

      expect(smtp.create).toHaveBeenCalledWith({ host: 'h', port: 465, secure: true });
    });

    it('treats an explicit port 465 as secure', async () => {
      const smtp = buildSmtpFactory();

      await buildMailTransportState({
        env: { SMTP_ENABLE: 'true', SMTP_PORT: '465' },
        createSmtpTransport: smtp.create,
        logger: buildLogger(),
      });

      expect(smtp.create.calls.mostRecent().args[0].secure).toBe(true);
    });

    it('falls back to disabled when smtp verify fails, without leaking details', async () => {
      const smtp = buildSmtpFactory(async () => {
        throw new Error('connect ECONNREFUSED smtp.secret-host.test');
      });
      const logger = buildLogger();

      const state = await buildMailTransportState({
        env: { ...SMTP, NODE_ENV: 'development' },
        createSmtpTransport: smtp.create,
        logger,
      });

      const logged = [...logger.log.calls.allArgs(), ...logger.error.calls.allArgs()]
        .flat()
        .join(' ');
      expect(state.transport).toBe('disabled');
      expect(state.smtpTransporter).toBeUndefined();
      expect(logged).not.toContain('secret-host');
      expect(logged).not.toContain('secret-pass');
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('falls back to disabled when creating the smtp transport throws', async () => {
      const state = await buildMailTransportState({
        env: SMTP,
        createSmtpTransport: () => {
          throw new Error('bad config');
        },
        logger: buildLogger(),
      });

      expect(state.transport).toBe('disabled');
    });

    it('selects mailgun and exposes client and domain', async () => {
      const client = { messages: {} };
      const createMailgunClient = jasmine.createSpy('createMailgun').and.returnValue(client);

      const state = await buildMailTransportState({
        env: { MAILGUN_API_KEY: 'mg-key', MAILGUN_DOMAIN: 'mg.test' },
        createMailgunClient,
        logger: buildLogger(),
      });

      expect(state.transport).toBe('mailgun');
      expect(state.mailgunClient).toBe(client);
      expect(state.mailgunDomain).toBe('mg.test');
      expect(createMailgunClient).toHaveBeenCalledWith('mg-key');
    });

    it('falls back to disabled when mailgun init fails', async () => {
      const state = await buildMailTransportState({
        env: { MAILGUN_API_KEY: 'mg-key' },
        createMailgunClient: () => {
          throw new Error('boom');
        },
        logger: buildLogger(),
      });

      expect(state.transport).toBe('disabled');
      expect(state.mailgunClient).toBeUndefined();
    });

    it('logs one startup error without secrets when disabled in production', async () => {
      const logger = buildLogger();

      const state = await buildMailTransportState({
        env: { ...SMTP, NODE_ENV: 'production' },
        createSmtpTransport: buildSmtpFactory(async () => {
          throw new Error('nope');
        }).create,
        logger,
      });

      expect(state.transport).toBe('disabled');
      expect(logger.error).toHaveBeenCalledTimes(1);
      const line = logger.error.calls.mostRecent().args.join(' ');
      expect(line).not.toContain('secret-host');
      expect(line).not.toContain('secret-pass');
    });

    it('logs the startup error when nothing is configured in production', async () => {
      const logger = buildLogger();

      await buildMailTransportState({ env: { NODE_ENV: 'production' }, logger });

      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('stays quiet when nothing is configured outside production', async () => {
      const logger = buildLogger();

      const state = await buildMailTransportState({ env: {}, logger });

      expect(state.transport).toBe('disabled');
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('does not log a startup error for a working transport in production', async () => {
      const logger = buildLogger();

      await buildMailTransportState({ env: { ...COMMS, NODE_ENV: 'production' }, logger });

      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('createMailApiCallback', () => {
    const payload = { to: 'a@x.com, b@x.com', subject: 'TopSecretSubject', text: 't', html: 'h' };

    it('throws in production when transport is disabled', async () => {
      const callback = createMailApiCallback({
        transport: 'disabled',
        env: { NODE_ENV: 'production' },
        logger: buildLogger(),
      });

      await expectAsync(callback({ payload })).toBeRejectedWithError(
        'Email transport is not configured'
      );
    });

    it('does not throw and logs only recipient count outside production', async () => {
      const logger = buildLogger();
      const callback = createMailApiCallback({
        transport: 'disabled',
        env: { NODE_ENV: 'development' },
        logger,
      });

      await expectAsync(callback({ payload })).toBeResolved();

      const logged = logger.log.calls.allArgs().flat().join(' ');
      expect(logged).toContain('2 recipient(s)');
      expect(logged).not.toContain('TopSecretSubject');
      expect(logged).not.toContain('a@x.com');
      expect(logger.log.calls.allArgs().every(args => args.length === 1)).toBe(true);
    });

    it('logs zero recipients when payload has none', async () => {
      const logger = buildLogger();
      const callback = createMailApiCallback({ transport: 'disabled', env: {}, logger });

      await callback({});

      expect(logger.log.calls.mostRecent().args[0]).toContain('0 recipient(s)');
    });

    it('sends through comms with mapped fields', async () => {
      const sendComms = jasmine.createSpy('sendComms').and.resolveTo([]);
      const callback = createMailApiCallback({ transport: 'comms', env: COMMS, sendComms });

      await callback({ payload: { ...payload, from: 'x', attachments: [1] } });

      expect(sendComms).toHaveBeenCalledWith(
        { to: payload.to, subject: payload.subject, text: 't', html: 'h' },
        { env: COMMS }
      );
    });

    it('propagates comms failures', async () => {
      const sendComms = jasmine.createSpy('sendComms').and.rejectWith(new Error('boom'));
      const callback = createMailApiCallback({ transport: 'comms', env: COMMS, sendComms });

      await expectAsync(callback({ payload })).toBeRejectedWithError('boom');
    });

    it('delegates to smtp sender', async () => {
      const sendSmtp = jasmine.createSpy('sendSmtp').and.resolveTo();
      const callback = createMailApiCallback({ transport: 'smtp', sendSmtp });

      await callback({ payload });

      expect(sendSmtp).toHaveBeenCalledWith(payload);
    });

    it('delegates to mailgun sender', async () => {
      const sendMailgun = jasmine.createSpy('sendMailgun').and.resolveTo();
      const callback = createMailApiCallback({ transport: 'mailgun', sendMailgun });

      await callback({ payload });

      expect(sendMailgun).toHaveBeenCalledWith(payload);
    });

    describe('with default env and logger', () => {
      let previousNodeEnv;

      beforeEach(() => {
        previousNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
      });

      afterEach(() => {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
      });

      it('logs through console when no logger is injected', async () => {
        const logSpy = spyOn(console, 'log');
        const callback = createMailApiCallback({ transport: 'disabled' });

        await callback({ payload });

        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(process.env.NODE_ENV).toBe('test');
      });
    });
  });
});
