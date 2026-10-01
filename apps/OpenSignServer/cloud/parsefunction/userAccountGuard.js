export const PROTECTED_USER_FIELDS = Object.freeze(['email', 'username', 'normalizedEmail']);

const buildForbiddenError = field =>
  new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, `${field} cannot be modified.`);

const buildCreationForbiddenError = () =>
  new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Accounts can only be created by the server.');

export async function guardUserAccountSave(request) {
  if (request.master) {
    return;
  }
  if (!request.original) {
    throw buildCreationForbiddenError();
  }
  const changedField = PROTECTED_USER_FIELDS.find(
    field => request.object.get(field) !== request.original.get(field)
  );
  if (changedField) {
    throw buildForbiddenError(changedField);
  }
}
