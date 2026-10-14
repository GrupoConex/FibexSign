import { projectContact } from './shared/contactProjection.js';

export default async function getContact(request) {
  const contactId = request.params.contactId;
  try {
    const contactCls = new Parse.Query('contracts_Contactbook');
    const contactRes = await contactCls.get(contactId, { useMasterKey: true });
    return projectContact(JSON.parse(JSON.stringify(contactRes)));
  } catch (err) {
    console.log('Err in contracts_Contactbook class ', err);
    throw err;
  }
}
