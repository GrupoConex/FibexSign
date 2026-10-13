const TEMPLATE_CLASS = 'contracts_Template';
const TEMPLATE_INCLUDES = [
  'ExtUserPtr',
  'Signers',
  'CreatedBy',
  'ExtUserPtr.TenantId',
  'Placeholders.signerPtr',
  'Bcc',
  'Cc',
];

const isUsableId = id => typeof id === 'string' && id.length > 0;

const toPointer = (className, objectId) => ({ __type: 'Pointer', className, objectId });

const asArray = value => (Array.isArray(value) ? value : []);

const pointerId = value => value?.id ?? value?.objectId;

const assertUsableIds = ({ userId, templateId }) => {
  if (!isUsableId(userId) || !isUsableId(templateId)) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Invalid template lookup');
  }
};

const accessBranches = ({ userId, access }) => {
  const extUserPointer = access?.extUserId && toPointer('contracts_Users', access.extUserId);
  const teamPointers = asArray(access?.teamAncestorIds)
    .filter(isUsableId)
    .map(teamId => toPointer('contracts_Teams', teamId));
  return [
    query => query.equalTo('CreatedBy', toPointer('_User', userId)),
    extUserPointer && (query => query.equalTo('ExtUserPtr', extUserPointer)),
    extUserPointer && (query => query.equalTo('SharedWithUsers', extUserPointer)),
    teamPointers.length > 0 && (query => query.containedIn('SharedWith', teamPointers)),
  ].filter(Boolean);
};

const scopedBranch = (templateId, constrain) =>
  constrain(
    new Parse.Query(TEMPLATE_CLASS).equalTo('objectId', templateId).notEqualTo('IsArchive', true)
  );

export const buildAccessibleTemplateQuery = ({ userId, access, templateId }) => {
  assertUsableIds({ userId, templateId });
  const branches = accessBranches({ userId, access }).map(constrain =>
    scopedBranch(templateId, constrain)
  );
  const query = Parse.Query.or(...branches);
  TEMPLATE_INCLUDES.forEach(field => query.include(field));
  return query;
};

const placeholderContactIds = placeholders =>
  asArray(placeholders).flatMap(placeholder => [
    placeholder?.signerObjId,
    pointerId(placeholder?.signerPtr),
  ]);

export const templateContactIds = template => {
  const recipientIds = ['Signers', 'Bcc', 'Cc'].flatMap(field =>
    asArray(template.get(field)).map(pointerId)
  );
  const ids = [...recipientIds, ...placeholderContactIds(template.get('Placeholders'))];
  return [...new Set(ids.filter(isUsableId))];
};
