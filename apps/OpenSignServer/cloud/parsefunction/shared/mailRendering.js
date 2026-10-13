import { replaceMailVaribles } from '../../../Utils.js';

const HTML_ENTITIES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});
const HTML_SPECIAL_CHARACTERS = /[&<>"']/g;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g;

const asText = value => (value === undefined || value === null ? '' : String(value));

export const escapeHtml = value =>
  asText(value).replace(HTML_SPECIAL_CHARACTERS, character => HTML_ENTITIES[character]);

export const toMailSubject = value => asText(value).replace(CONTROL_CHARACTERS, ' ').trim();

export const mapValues = (values, convert) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, convert(value)]));

export const renderMailTemplate = (subject, body, variables) => ({
  subject: toMailSubject(replaceMailVaribles(subject, '', mapValues(variables, asText)).subject),
  body: replaceMailVaribles('', body, mapValues(variables, escapeHtml)).body,
});
