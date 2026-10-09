import { collectRecipients } from './commsMailClient.js';
import { createUserCallLimiter } from './userCallLimiter.js';

const DOCUMENT_CLASS = 'contracts_Document';
const TEMPLATE_CLASS = 'contracts_Template';
const ALLOWED_CLASSES = Object.freeze([DOCUMENT_CLASS, TEMPLATE_CLASS]);
const DEFAULT_USER_LIMIT = 100;
const MAX_USER_LIMIT = 1000;
const ADMIN_ROLE = 'contracts_Admin';
const ORG_ADMIN_ROLE = 'contracts_OrgAdmin';
const DEFAULT_USER_WINDOW_MS = 10 * 60 * 1000;
const MASTER = { useMasterKey: true };

const userLimiter = createUserCallLimiter();

export const resetSendMailv3UserLimits = () => userLimiter.reset();

const positiveIntegerOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const resolveLimitPolicy = env => ({
  limit: Math.min(positiveIntegerOr(env.SENDMAILV3_USER_LIMIT, DEFAULT_USER_LIMIT), MAX_USER_LIMIT),
  windowMs: positiveIntegerOr(env.SENDMAILV3_USER_WINDOW_MS, DEFAULT_USER_WINDOW_MS),
});

const forbidden = () =>
  new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Not allowed to send mail for this document');

const invalidRequest = message => new Parse.Error(Parse.Error.INVALID_QUERY, message);

const placeholderEmails = placeholders =>
  (placeholders ?? []).flatMap(placeholder => [placeholder?.email, placeholder?.signerPtr?.Email]);

export const loadMailContext = async (docId, className) => {
  const query = new Parse.Query(className);
  query.include('ExtUserPtr');
  query.include('Signers');
  const document = await query.get(docId, MASTER);
  const extUser = document.get('ExtUserPtr');
  const signers = document.get('Signers') ?? [];
  return {
    createdById: document.get('CreatedBy')?.id,
    ownerUserId: extUser?.get('UserId')?.id,
    extUserId: extUser?.id,
    ownerEmail: extUser?.get('Email'),
    tenantId: extUser?.get('TenantId')?.id,
    organizationId: extUser?.get('OrganizationId')?.id,
    sharedWithUserIds: (document.get('SharedWithUsers') ?? []).map(pointer => pointer?.id),
    sharedTeamIds: (document.get('SharedWith') ?? []).map(pointer => pointer?.id),
    signerEmails: [
      ...signers.map(signer => signer?.get?.('Email')),
      ...placeholderEmails(document.get('Placeholders')),
    ],
  };
};

const teamAncestorIds = teams => [
  ...new Set(teams.flatMap(team => (team.get('Ancestors') ?? []).map(ancestor => ancestor?.id))),
];

export const loadCallerAccess = async userId => {
  const query = new Parse.Query('contracts_Users');
  query.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: userId });
  query.notEqualTo('IsDisabled', true);
  query.include('TeamIds');
  const extUser = await query.first(MASTER);
  if (!extUser) return null;
  return {
    extUserId: extUser.id,
    role: extUser.get('UserRole'),
    tenantId: extUser.get('TenantId')?.id,
    organizationId: extUser.get('OrganizationId')?.id,
    teamAncestorIds: teamAncestorIds(extUser.get('TeamIds') ?? []),
  };
};

const resolveClassName = ({ docClass }) => {
  if (docClass === undefined || docClass === null) return DOCUMENT_CLASS;
  if (!ALLOWED_CLASSES.includes(docClass)) throw invalidRequest('Invalid docClass');
  return docClass;
};

const resolveDocId = ({ docId }) => {
  if (typeof docId !== 'string' || !docId.trim()) throw invalidRequest('Missing docId');
  return docId.trim();
};

const isOwner = (context, userId) =>
  Boolean(userId) && (context.createdById === userId || context.ownerUserId === userId);

const sameDefinedId = (left, right) => Boolean(left) && left === right;

const isSharedWith = (context, access) =>
  (context.sharedWithUserIds ?? []).includes(access.extUserId) ||
  (context.sharedTeamIds ?? []).some(teamId => access.teamAncestorIds.includes(teamId));

const isAdminOfScope = (context, access) => {
  const sameTenant = sameDefinedId(access.tenantId, context.tenantId);
  if (access.role === ADMIN_ROLE) return sameTenant;
  return (
    access.role === ORG_ADMIN_ROLE &&
    sameTenant &&
    sameDefinedId(access.organizationId, context.organizationId)
  );
};

const hasSharedAccess = (context, access) =>
  Boolean(access) && (isSharedWith(context, access) || isAdminOfScope(context, access));

const allowedAddresses = context =>
  new Set(
    collectRecipients({ to: [context.ownerEmail, ...(context.signerEmails ?? [])].filter(Boolean) })
  );

const assertRecipientsAllowed = (params, context) => {
  const allowed = allowedAddresses(context);
  const requested = collectRecipients({ to: params.recipient, cc: params.cc, bcc: params.bcc });
  if (!requested.every(address => allowed.has(address))) throw forbidden();
};

const fetchContextOrForbid = async (loader, docId, className) => {
  try {
    return await loader(docId, className);
  } catch {
    throw forbidden();
  }
};

const isAuthorizedCaller = async (context, userId, lookupAccess) => {
  if (isOwner(context, userId)) return true;
  try {
    return hasSharedAccess(context, await lookupAccess(userId));
  } catch {
    return false;
  }
};

const assertWithinUserLimit = (userId, env, now) => {
  const allowed = userLimiter.tryConsume(userId, { ...resolveLimitPolicy(env), now });
  if (!allowed) {
    throw new Parse.Error(Parse.Error.REQUEST_LIMIT_EXCEEDED, 'Too many mail requests');
  }
};

export const authorizeSendMailv3 = async (
  { user, params = {} },
  {
    env = process.env,
    now = Date.now,
    loadMailContext: loader = loadMailContext,
    loadCallerAccess: lookupAccess = loadCallerAccess,
  } = {}
) => {
  assertWithinUserLimit(user.id, env, now);
  const docId = resolveDocId(params);
  const className = resolveClassName(params);
  const context = await fetchContextOrForbid(loader, docId, className);
  if (!(await isAuthorizedCaller(context, user.id, lookupAccess))) throw forbidden();
  assertRecipientsAllowed(params, context);
  return { extUserId: context.extUserId ?? '' };
};
