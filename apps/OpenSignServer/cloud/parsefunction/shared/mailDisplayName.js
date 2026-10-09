const MAX_DISPLAY_NAME_LENGTH = 100;
const FORBIDDEN_CHARACTERS = /[\u0000-\u001f\u007f<>",;@]/g;

export const sanitizeDisplayName = value => {
  if (typeof value !== 'string') return '';
  return value.replace(FORBIDDEN_CHARACTERS, '').trim().slice(0, MAX_DISPLAY_NAME_LENGTH).trim();
};
