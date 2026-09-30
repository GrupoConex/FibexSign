export const PROTECTED_USER_FIELDS = Object.freeze(['email', 'username', 'normalizedEmail']);

const buildForbiddenError = field =>
  new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, `${field} cannot be modified.`);

export async function guardUserAccountSave(request) {
  if (request.master || !request.original) {
    return;
  }
  const changedField = PROTECTED_USER_FIELDS.find(
    field => request.object.get(field) !== request.original.get(field)
  );
  if (changedField) {
    throw buildForbiddenError(changedField);
  }
}
