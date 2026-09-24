# Catálogo de Cloud Functions

Este documento cataloga las **53 Parse Cloud Functions** registradas vía `Parse.Cloud.define` en `apps/OpenSignServer/cloud/main.js`, los **6 endpoints REST** montados por fuera de Parse en `apps/OpenSignServer/cloud/customRoute/customApp.js` (Express puro), y los **11 hooks automáticos** (`beforeSave`/`afterSave`/`afterFind`) registrados sobre clases Parse. Cada entrada fue verificada contra el archivo real en `cloud/parsefunction/` o `cloud/customRoute/` — parámetros, retorno, errores y permisos reflejan el código tal como está hoy, no la documentación previa de OpenSign upstream. Las funciones están agrupadas en secciones temáticas que siguen la organización real del código.

## Autenticación y administración de usuarios

### `usersignup`
**Archivo:** `cloud/parsefunction/usersignup.js`
**Parámetros:** `request.params.userDetails` (objeto: `email`, `password`, `phone`, `company`, `role`, `name`, `pincode`, `country`, `state`, `city`, `address`, `jobTitle`, `timezone`)
**Retorno:** `{ message: 'User sign up', sessionToken }`, o `{ message: 'User already exist' }` si ya existe un registro `<rol>_Users` para ese usuario
**Errores:** relanza lo que arroje `createUserAccount` (p.ej. `Parse.Error.USERNAME_TAKEN` si el email ya existe)
**Permisos:** público (no requiere `request.user`); usa `useMasterKey` para crear el tenant (`partners_Tenant`) y el registro extendido de usuario.

### `SendOTPMailV1`
**Archivo:** `cloud/parsefunction/SendMailOTPv1.js`
**Parámetros:** `email`, `TenantId` (opcional), `docId` (opcional)
**Retorno:** `'Otp send'`, o `'Please Enter valid email'` si falta `email`
**Errores:** no lanza `Parse.Error`; el catch interno hace `console.log` y devuelve el objeto de error crudo
**Permisos:** público; `useMasterKey` para leer/crear el registro `defaultdata_Otp`.

### `AuthLoginAsMail`
**Archivo:** `cloud/parsefunction/AuthLoginAsMail.js`
**Parámetros:** `otp`, `email`
**Retorno:** payload de sesión devuelto por `/loginAs` (login sin password), o strings `'Invalid Otp'` / `'user not found!'` / `'Result not found'`
**Errores:** no lanza; retorna mensajes de string en cada rama de fallo; bloquea el OTP tras `MAX_OTP_ATTEMPTS = 5` intentos fallidos
**Permisos:** público; llama a `/loginAs` con `X-Parse-Master-Key`; `useMasterKey` en las queries de OTP/usuario.

### `getUserDetails`
**Archivo:** `cloud/parsefunction/getUserDetails.js`
**Parámetros:** `email` (opcional), `userId` (opcional)
**Retorno:** registro `contracts_Users` completo; o `{ exists: true|false }` si se pasó `email`; `''` si no hay resultado
**Errores:** `Parse.Error.INVALID_SESSION_TOKEN` si no hay `email` ni `request.user`; `Parse.Error(code, msg)` genérico en catch
**Permisos:** requiere `email` en params o `request.user`; `useMasterKey`.

### `verifyemail`
**Archivo:** `cloud/parsefunction/VerifyEmail.js`
**Parámetros:** `otp`, `email`
**Retorno:** `{ message: 'Email is already verified.' }` o `{ message: 'Email is verified.' }`
**Errores:** `Parse.Error.INVALID_SESSION_TOKEN` si no hay `request.user`; error código 400 `'OTP is invalid.'` o `'Something went wrong...'`
**Permisos:** requiere `request.user`; `useMasterKey` para validar OTP y guardar `emailVerified`.

### `isextenduser`
**Archivo:** `cloud/parsefunction/isextenduser.js`
**Parámetros:** `email`
**Retorno:** `{ isUserExist: true|false }`
**Errores:** `Parse.Error(code, message)` genérico en catch
**Permisos:** público; `useMasterKey`.

### `addadmin`
**Archivo:** `cloud/parsefunction/AddAdmin.js`
**Parámetros:** `userDetails` (mismo shape que `usersignup`)
**Retorno:** `{ message: 'User already exist' }` o `{ message: 'User sign up', sessionToken }`
**Errores:** el catch externo solo hace `console.log` — **no relanza** el error (fallo silencioso)
**Permisos:** público (no valida `request.user`); `useMasterKey`; crea `contracts_Organizations` y `contracts_Teams` ("All Users") y fija rol `contracts_Admin` vía `addTeamAndOrg`.

### `checkadminexist`
**Archivo:** `cloud/parsefunction/CheckAdminExist.js`
**Parámetros:** ninguno
**Retorno:** `'exist'` o `'not_exist'`
**Errores:** `Parse.Error(code, msg)` genérico
**Permisos:** público; `useMasterKey`.

### `updateuserasadmin`
**Archivo:** `cloud/parsefunction/UpdateExistUserAsAdmin.js`
**Parámetros:** `email`, `masterkey`
**Retorno:** `'admin_created'`
**Errores:** `Parse.Error(404, 'Invalid master key.')`, `Parse.Error.DUPLICATE_VALUE` (ya existe admin), `Parse.Error.OBJECT_NOT_FOUND`, `Parse.Error(code, msg)` genérico
**Permisos:** gate por secreto compartido (`masterkey` == `process.env.MASTER_KEY`), no por `request.user`; `useMasterKey`.

### `getuserlistbyorg`
**Archivo:** `cloud/parsefunction/getUserListByOrg.js`
**Parámetros:** `organizationId`
**Retorno:** array de `contracts_Users` (JSON) de la organización
**Errores:** `INVALID_SESSION_TOKEN`, `INVALID_QUERY`, `OBJECT_NOT_FOUND`, `OPERATION_FORBIDDEN`
**Permisos:** requiere `request.user`; valida server-side que la org solicitada pertenezca al tenant del caller y que un no-admin solo liste su propia organización; `useMasterKey`.

### `loginuser`
**Archivo:** `cloud/parsefunction/loginUser.js`
**Parámetros:** `email`, `password`
**Retorno:** JSON del usuario devuelto por `Parse.User.logIn`
**Errores:** `Parse.Error.OBJECT_NOT_FOUND`, `Parse.Error.PASSWORD_MISSING`; relanza errores de `Parse.User.logIn` (credenciales inválidas, etc.)
**Permisos:** público; usa `Parse.User.logIn` (no master key).

### `adduser`
**Archivo:** `cloud/parsefunction/addUser.js`
**Parámetros:** `phone`, `name`, `password`, `organization` (`{objectId, company}`), `team`, `tenantId`, `timezone`, `role`, `email`
**Retorno:** JSON del nuevo `contracts_Users`
**Errores:** `INVALID_SESSION_TOKEN`, `OBJECT_NOT_FOUND`, `OPERATION_FORBIDDEN` (múltiples checks de autorización), `INVALID_QUERY`, 400 genérico
**Permisos:** requiere `request.user` con rol `contracts_Admin`/`contracts_OrgAdmin`; fuerza `tenantId` al del caller; `role` limitado a `OrgAdmin`/`Editor`/`User` (nunca `Admin`); `useMasterKey` para lookups, ACL explícita en el nuevo registro.

### `senddeleterequest`
**Archivo:** `cloud/parsefunction/sendDeleteUserMail.js`
**Parámetros:** `userId`, `app` (opcional)
**Retorno:** `'mail sent.'`
**Errores:** `INVALID_SESSION_TOKEN`, `INVALID_QUERY`, `SCRIPT_FAILED` (target no es admin, o falla el envío)
**Permisos:** requiere `request.user`; solo permite la acción si el usuario objetivo tiene rol `contracts_Admin`; `useMasterKey`.

### `resetpassword`
**Archivo:** `cloud/parsefunction/resetPassword.js`
**Parámetros:** `userId`, `password`
**Retorno:** `{ status: 'success', message: 'Password has been reset.' }`
**Errores:** `INVALID_QUERY` (params faltantes o intento de resetear la propia contraseña), `INVALID_SESSION_TOKEN`, `OBJECT_NOT_FOUND`
**Permisos:** requiere `request.user` con rol `contracts_Admin`/`contracts_OrgAdmin` del mismo tenant; el target no puede ser Admin ni el propio caller; `useMasterKey`.

## Documentos

### `signPdf`
**Archivo:** `cloud/parsefunction/pdf/PDF.js`
**Parámetros:** `docId`, `userId` (signer/contacto, opcional), `isCustomCompletionMail`, `mailProvider`, `signature`, `pdfFile` (base64), header `x-real-ip`, header `public_url`
**Retorno:** `{ status: 'success', data: <imageUrl del PDF firmado> }`
**Errores:** `OBJECT_NOT_FOUND` ('Document not found.'), `INVALID_SESSION_TOKEN` (si el doc tiene OTP habilitado y no hay `request.user`), `OPERATION_FORBIDDEN` (orden estricto de firma violado), error 400 ('Pdf file not present!' / 'Please provide required parameters!')
**Permisos:** autenticación condicional a `IsEnableOTP` del documento; firma digitalmente con el PFX del tenant o el de `process.env.PFX_BASE64`; `useMasterKey` en todo el flujo.

### `getDocument`
**Archivo:** `cloud/parsefunction/getDocument.js`
**Parámetros:** `docId`, `include` (opcional), header `sessiontoken`
**Retorno:** JSON del documento (sin `TenantId.FileAdapters`/`PfxFile`)
**Errores:** no lanza — devuelve objetos `{ error: '...' }` en casi todos los casos de fallo (documento no encontrado, sin acceso, sesión inválida)
**Permisos:** si `IsEnableOTP` es true, exige `sessiontoken` válido y chequea ACL de lectura; si no, acceso por `docId`; `useMasterKey` para la query.

### `getDrive`
**Archivo:** `cloud/parsefunction/getDrive.js`
**Parámetros:** `limit`, `skip`, `docId` (opcional, para listar contenido de una carpeta), header `sessiontoken`
**Retorno:** array de `contracts_Document` (excluye `AuditTrail`/`OriginalDocument`/`SignedDocument`)
**Errores:** no lanza — devuelve `{ error: '...' }` en fallos
**Permisos:** requiere `sessiontoken` válido resuelto vía `/users/me`; `useMasterKey` para la query, filtrada por `CreatedBy`.

### `batchdocuments`
**Archivo:** `cloud/parsefunction/createBatchDocs.js`
**Parámetros:** `Documents` (JSON string), headers `sessiontoken`, `type` (`quicksend`/`bulksend`), `x-real-ip`, `origin`/`public_url`
**Retorno:** `{ total, created, failed }`
**Errores:** `INVALID_SESSION_TOKEN` si no hay `request.user`; `Parse.Error(code, msg)` genérico
**Permisos:** requiere `request.user`; hace `POST /batch` contra el propio Parse Server con el `sessionToken` del caller; envía email de resumen al dueño al finalizar.

### `linkcontacttodoc`
**Archivo:** `cloud/parsefunction/linkContactToDoc.js`
**Parámetros:** `email`, `docId`, `name`, `phone`, `jobTitle`, `company`
**Retorno:** `{ contactId }`
**Errores:** `OBJECT_NOT_FOUND` (documento o usuario no encontrado), `OPERATION_FORBIDDEN` ('unauthorized' si el email no está en los `Placeholders` del documento)
**Permisos:** sin chequeo explícito de `request.user` (autoriza por coincidencia email/placeholder); `useMasterKey`; otorga ACL de lectura/escritura sobre el documento al nuevo usuario/contacto.

### `declinedoc`
**Archivo:** `cloud/parsefunction/declinedocument.js`
**Parámetros:** `docId`, `reason` (opcional), `userId` (solo si no hay `request.user`), header `public_url`
**Retorno:** `'document declined'` / `'document already declined'`
**Errores:** `SCRIPT_FAILED` (falta `docId`), `OPERATION_FORBIDDEN` (caller no es creador ni firmante), `OBJECT_NOT_FOUND`, `INVALID_SESSION_TOKEN` (solo si el documento tiene OTP habilitado)
**Permisos:** el caller debe ser el creador o figurar en `Signers`; `useMasterKey`.

### `getsigners`
**Archivo:** `cloud/parsefunction/getSigners.js`
**Parámetros:** `search` (opcional, sobre Name/Email)
**Retorno:** array de `contracts_Contactbook` creados por el caller
**Errores:** `INVALID_SESSION_TOKEN` si no hay `request.user`; relanza errores de query
**Permisos:** requiere `request.user`; la query corre con el `sessionToken` del caller (no master key).

### `savefile`
**Archivo:** `cloud/parsefunction/saveFile.js`
**Parámetros:** `fileBase64`, `id` (opcional), `fileName`
**Retorno:** `{ url }`
**Errores:** `INVALID_QUERY` (falta archivo), `OBJECT_NOT_FOUND` (usuario no encontrado), `INVALID_SESSION_TOKEN`, 400 genérico en fallo de subida
**Permisos:** requiere `request.user`; `useMasterKey` para resolver el usuario extendido; aplana PDFs (`flattenPdf`) antes de subir.

### `filterdocs`
**Archivo:** `cloud/parsefunction/filterDocs.js`
**Parámetros:** `searchTerm`, `limit`, `skip`, `caseSensitive`
**Retorno:** array de `contracts_Document` que matchean por `Name`
**Errores:** `INVALID_SESSION_TOKEN`, `INVALID_PARAMETER` (searchTerm no es string), `SCRIPT_FAILED` (fallo de query)
**Permisos:** requiere `request.user`; query acotada a `CreatedBy = request.user`; `useMasterKey`.

### `createduplicate`
**Archivo:** `cloud/parsefunction/createDuplicate.js`
**Parámetros:** `templateId`
**Retorno:** JSON del nuevo `contracts_Template` duplicado
**Errores:** `INVALID_SESSION_TOKEN`, `INVALID_QUERY` ('You cannot create duplicate of this template.')
**Permisos:** requiere `request.user`; el template origen debe pertenecer al caller (`CreatedBy`); `useMasterKey`.

### `generatecertificate`
**Archivo:** `cloud/parsefunction/generateCertificatebydocId.js`
**Parámetros:** `docId`
**Retorno:** `{ CertificateUrl }` (vacío si el documento no está completo o ya tiene certificado)
**Errores:** `INVALID_QUERY` (falta `docId`), `Parse.Error(code, message)` genérico
**Permisos:** sin chequeo explícito de `request.user`; `useMasterKey`; firma digitalmente el certificado con el PFX de `process.env.PFX_BASE64`.

### `fileupload`
**Archivo:** `cloud/parsefunction/fileUpload.js`
**Parámetros:** `url`
**Retorno:** `{ url: <url firmada con JWT, expira en 200s> }`
**Errores:** relanza cualquier error capturado
**Permisos:** sin auth propia; el JWT se firma con `process.env.MASTER_KEY` como secreto.

### `forwarddoc`
**Archivo:** `cloud/parsefunction/ForwardDoc.js`
**Parámetros:** `docId`, `recipients` (array, máx. 10)
**Retorno:** respuesta del último envío de `sendMailWithAttachment`
**Errores:** `INVALID_SESSION_TOKEN`, `INVALID_QUERY` (recipients faltante/inválido), `OBJECT_NOT_FOUND`, 400 genérico en fallo de envío
**Permisos:** requiere `request.user`; el documento debe pertenecer al caller (`CreatedBy`), no archivado ni rechazado; `useMasterKey`.

### `recreatedoc`
**Archivo:** `cloud/parsefunction/recreateDocument.js`
**Parámetros:** `docId`
**Retorno:** `{ objectId, createdAt, updatedAt }` del documento nuevo
**Errores:** `INVALID_QUERY` (falta `docId`), `INVALID_SESSION_TOKEN` (no autenticado, o documento `IsSignyourself`), `OBJECT_NOT_FOUND`
**Permisos:** requiere `request.user`; `useMasterKey`; limpia ACL/audit/decline y resetea el valor de los widgets de los placeholders.

### `createdocumentfromapp`
**Archivo:** `cloud/parsefunction/createDocumentFromApp.js`
**Parámetros:** `document` (objeto con `Name`, `URL`, `ExtUserPtr`, `CreatedBy`, `Signers`, `Placeholders`, `SignatureType`, `Bcc`, `Cc`, `PenColors`, etc.)
**Retorno:** el `contracts_Document` creado
**Errores:** `INVALID_JSON` (falta el payload `document`), `INVALID_SESSION_TOKEN`
**Permisos:** requiere `request.user`; `useMasterKey`; actualiza el contador de documentos del `ExtUserPtr`.

## Plantillas

### `getTemplate`
**Archivo:** `cloud/parsefunction/GetTemplate.js`
**Parámetros:** `templateId`, header `sessiontoken`
**Retorno:** JSON del template (sin `TenantId.FileAdapters`/`PfxFile`), o `{ error: '...' }`
**Errores:** no lanza — devuelve `{ error: "template deleted or you don't have access." }` / `{ error: 'Invalid session token' }`
**Permisos:** resuelve el email del caller vía `sessiontoken` (`/users/me`); visibilidad acotada a dueño, equipos (`SharedWith`) o usuarios compartidos (`SharedWithUsers`); `useMasterKey`.

### `saveastemplate`
**Archivo:** `cloud/parsefunction/saveAsTemplate.js`
**Parámetros:** `docId`
**Retorno:** el `contracts_Template` guardado
**Errores:** `INVALID_SESSION_TOKEN`, `OBJECT_NOT_FOUND`
**Permisos:** requiere `request.user`; el documento origen debe pertenecer al caller; `useMasterKey`.

## Firmas

### `savesignature`
**Archivo:** `cloud/parsefunction/saveSignature.js`
**Parámetros:** `signature`, `userId`, `initials`, `id` (opcional, para update), `title`, `stamp`
**Retorno:** el `contracts_Signature` guardado
**Errores:** `INVALID_QUERY` (falta `userId`, o `userId !== request.user.id`)
**Permisos:** `userId` debe coincidir con `request.user.id`; `useMasterKey`.

### `managesign`
**Archivo:** `cloud/parsefunction/manageSign.js`
**Parámetros:** idénticos a `savesignature` (implementación casi duplicada)
**Retorno:** el `contracts_Signature` guardado
**Errores:** mismos checks `INVALID_QUERY` que `savesignature`
**Permisos:** `userId` debe coincidir con `request.user.id`; `useMasterKey`.

### `getdefaultsignature`
**Archivo:** `cloud/parsefunction/getSignature.js`
**Parámetros:** `userId`
**Retorno:** el `contracts_Signature` del usuario
**Errores:** `INVALID_QUERY` (falta `userId`, o no coincide con `request.user.id`)
**Permisos:** `userId` debe coincidir con `request.user.id`; `useMasterKey`.

### `updatesignaturetype`
**Archivo:** `cloud/parsefunction/updatesignaturetype.js`
**Parámetros:** `SignatureType` (array de `{ name, enabled }`)
**Retorno:** el `contracts_Users` actualizado
**Errores:** `INVALID_SESSION_TOKEN`, `INVALID_QUERY` (ningún tipo habilitado, o solo `default` habilitado), `OPERATION_FORBIDDEN`
**Permisos:** requiere `request.user`; `useMasterKey`.

## Contactos y equipos

### `getteams`
**Archivo:** `cloud/parsefunction/getTeams.js`
**Parámetros:** `active` (opcional, filtra `IsActive`)
**Retorno:** array de `contracts_Teams` de la organización del caller (o `[]`)
**Errores:** `INVALID_SESSION_TOKEN`, `Parse.Error(code, msg)` genérico
**Permisos:** requiere `request.user`; `useMasterKey`.

### `getcontact`
**Archivo:** `cloud/parsefunction/getContact.js`
**Parámetros:** `contactId`
**Retorno:** el `contracts_Contactbook`
**Errores:** relanza errores de `.get()` (p.ej. `OBJECT_NOT_FOUND`)
**Permisos:** sin chequeo explícito de `request.user`; `useMasterKey`.

### `updatecontacttour`
**Archivo:** `cloud/parsefunction/updateContactTour.js`
**Parámetros:** `contactId`
**Retorno:** el `contracts_Contactbook` actualizado (marca `requestSign: true` en `TourStatus`)
**Errores:** `OBJECT_NOT_FOUND`
**Permisos:** sin chequeo explícito de `request.user`; `useMasterKey`.

### `savecontact`
**Archivo:** `cloud/parsefunction/savecontact.js`
**Parámetros:** `name`, `phone`, `email`, `tenantId`, `company`, `jobTitle`
**Retorno:** el `contracts_Contactbook` creado (JSON)
**Errores:** `DUPLICATE_VALUE` ('Contact already exists.'); si no hay `request.user` la función retorna `undefined` sin lanzar
**Permisos:** requiere `request.user` (chequeo implícito por `if`); crea un `_User` sombra si el email no existe aún; `useMasterKey` para los saves.

### `isuserincontactbook`
**Archivo:** `cloud/parsefunction/isUserInContactBook.js`
**Parámetros:** ninguno (usa `request.user.email`)
**Retorno:** el `contracts_Contactbook` del propio caller, o `undefined`
**Errores:** relanza errores capturados
**Permisos:** requiere `request.user` (chequeo implícito); la query corre con el `sessionToken` del caller.

### `updatetourstatus`
**Archivo:** `cloud/parsefunction/updateTourStatus.js`
**Parámetros:** `TourStatus`, `ExtUserId`
**Retorno:** el `contracts_Users` actualizado
**Errores:** `INVALID_SESSION_TOKEN`, `Parse.Error(code, msg)` genérico
**Permisos:** requiere `request.user`; el `.save()` se hace **sin** `useMasterKey` (depende de ACL/sesión).

### `createbatchcontact`
**Archivo:** `cloud/parsefunction/createBatchContact.js`
**Parámetros:** `contacts` (JSON string, array)
**Retorno:** `{ success, failed }` (conteos)
**Errores:** `INVALID_SESSION_TOKEN`, `INVALID_QUERY` (falta `contacts`), `INVALID_CONTENT_LENGTH` (array vacío), 400 genérico
**Permisos:** requiere `request.user`; usa `POST /batch` autenticado con `X-Parse-Master-Key` (no el session token del caller).

### `editcontact`
**Archivo:** `cloud/parsefunction/editContact.js`
**Parámetros:** `contactId`, `name`, `email`, `phone`, `tenantId`, `company`, `jobTitle`
**Retorno:** el nuevo `contracts_Contactbook` (JSON) — soft-delete del anterior + creación de uno nuevo
**Errores:** `INVALID_SESSION_TOKEN`, `DUPLICATE_VALUE`, 400 genérico
**Permisos:** requiere `request.user`; el soft-delete usa el `sessionToken` del caller, el resto `useMasterKey`.

### `gettenant`
**Archivo:** `cloud/parsefunction/getTenant.js`
**Parámetros:** `userId` (opcional), `contactId` (opcional)
**Retorno:** el `partners_Tenant` (excluye `FileAdapters`/`PfxFile`[/`ContactNumber`])
**Errores:** `INVALID_SESSION_TOKEN` (solo en la rama por `userId` sin `request.user`)
**Permisos:** la rama por `contactId` **no** requiere `request.user`; la rama por `userId` sí; `useMasterKey`.

### `updatetenant`
**Archivo:** `cloud/parsefunction/updateTenant.js`
**Parámetros:** `tenantId`, `details` (`CompletionBody`/`CompletionSubject`/`RequestBody`/`RequestSubject`/`EmailEditorType`)
**Retorno:** el `partners_Tenant` actualizado
**Errores:** 400 (params faltantes), `INVALID_SESSION_TOKEN`, `OBJECT_NOT_FOUND`, `OPERATION_FORBIDDEN`
**Permisos:** requiere `request.user` con rol `contracts_Admin`/`contracts_OrgAdmin`; `tenantId` debe ser el propio tenant del caller (nunca confía en el valor recibido); `useMasterKey`.

### `getlogobydomain`
**Archivo:** `cloud/parsefunction/GetLogoByDomain.js`
**Parámetros:** `domain`
**Retorno:** `{ logo, favicon, appname, user: 'exist'|'not_exist' }`
**Errores:** `Parse.Error(code, msg)` genérico
**Permisos:** público (usado antes del login para branding); `useMasterKey`.

## Reportes y utilidades varias

### `getReport`
**Archivo:** `cloud/parsefunction/getReport.js` (usa `reportsJson.js` para las definiciones de reporte y `applySearch`)
**Parámetros:** `reportId`, `limit`, `skip`, `searchTerm`, `signerStatus`, header `sessiontoken`/`x-parse-session-token`
**Retorno:** array de resultados (vía REST de Parse, `results`)
**Errores:** no lanza — devuelve `{ error: 'Invalid session token' }` / `{ error: 'Report is not available!' }` / `{ error: "You don't have access!" }`
**Permisos:** resuelve al caller vía `sessiontoken`; las queries a `/classes/...` usan `X-Parse-Master-Key`; el reporte `6TeaPr321t` aplica un filtro adicional por equipos/organización del caller.

### `sendmailv3`
**Archivo:** `cloud/parsefunction/sendMailv3.js`
**Parámetros:** `extUserId`, `from`, `recipient`, `subject`, `text`, `html`, `bcc`, `cc`, `replyto`
**Retorno:** `{ status: 'success' }` o `{ status: 'error' }`
**Errores:** nunca lanza — todas las excepciones se capturan y se traducen a `{ status: 'error' }`
**Permisos:** sin chequeo de `request.user`; función interna usada por otras cloud functions para despachar mail vía SMTP o Mailgun.

### `getsignedurl`
**Archivo:** `cloud/parsefunction/getSignedUrl.js`
**Parámetros:** `docId` (opcional), `templateId` (opcional), `url`
**Retorno:** URL firmada (presigned S3, o JWT local si `useLocal === 'true'`)
**Errores:** `INVALID_SESSION_TOKEN` (documento con OTP sin auth, o sin `docId`/`templateId` y sin autenticar); envuelve otros errores en `Parse.Error`
**Permisos:** autenticación condicional según `IsEnableOTP` del documento/template, o exigida siempre que no se pase `docId`/`templateId`.

### `updatepreferences`
**Archivo:** `cloud/parsefunction/updatePreferences.js`
**Parámetros:** `SignatureType`, `NotifyOnSignatures`, `Timezone`, `UseNameAsSender`, `SendinOrder`, `IsTourEnabled`, `DateFormat`, `Is12HourTime`, `IsLTVEnabled`, `DownloadFilenameFormat`
**Retorno:** el `contracts_Users` actualizado
**Errores:** `INVALID_SESSION_TOKEN`, `INVALID_QUERY` (ningún campo válido, o validación de `SignatureType`), `OPERATION_FORBIDDEN`
**Permisos:** requiere `request.user`; `useMasterKey`.

### `updateemailtemplates`
**Archivo:** `cloud/parsefunction/updateEmailTemplates.js`
**Parámetros:** `tenantId`, `details` (`CompletionBody`/`CompletionSubject`/`RequestBody`/`RequestSubject`/`EmailEditorType`)
**Retorno:** el `contracts_Users` del caller actualizado (los templates de mail viven en el registro de usuario extendido, no en `partners_Tenant`, pese al nombre/parámetro)
**Errores:** 400 (params faltantes), `INVALID_SESSION_TOKEN`
**Permisos:** requiere `request.user`; a diferencia de `updatetenant`, **no valida** que `tenantId` coincida con el tenant del caller — solo se usa para el `include` de la query; `useMasterKey`.

### `triggerevent`
**Archivo:** `cloud/parsefunction/triggerEvent.js`
**Parámetros:** `event`, `body` (con `objectId`), `contactId`, header `sessiontoken`
**Retorno:** `{ message: 'event called!' }` / `{ message: 'User not found!' }` / `{ message: 'Something went wrong!' }`
**Errores:** nunca propaga una excepción al caller — todo se captura y se traduce a un mensaje
**Permisos:** si el documento tiene `IsEnableOTP`, exige `sessiontoken` resoluble; si no, sin auth; `useMasterKey`. Usado para registrar el evento `'viewed'` en el `AuditTrail`.

### `setwidgetpreferences`
**Archivo:** `cloud/parsefunction/setWidgetPreferences.js`
**Parámetros:** `dateWidget` (`{ isSigningDate, isReadOnly, date, format }`)
**Retorno:** `{ WidgetPreferences, updatedAt, createdAt }`
**Errores:** `INVALID_SESSION_TOKEN`, `INVALID_QUERY` (falta `dateWidget`), `OPERATION_FORBIDDEN`, `Parse.Error` genérico
**Permisos:** requiere `request.user`; `useMasterKey`.

## Endpoints REST (customRoute)

Montados en `cloud/customRoute/customApp.js` como app Express independiente (con su propio `cors`/`express.json`), no como `Parse.Cloud.define`.

### `POST /docxtopdf`
**Archivo:** `cloud/customRoute/docxtopdf.js`
**Parámetros:** archivo multipart (campo `file`, solo `.docx`, límite 50MB vía `multer`), header `sessiontoken`
**Retorno:** `200 { message: 'success.', url }`
**Errores:** `400 { error: 'No file uploaded.' }`; `403 { error: 'User not linked to tenant.' }` / `'Tenant not found for user.'`; `400` con mensaje genérico amigable (oculta el error real) con variantes para timeout/tamaño excedido
**Permisos:** requiere `sessiontoken` válido resuelto vía `/users/me`; las llamadas internas a Parse usan `X-Parse-Master-Key`; concurrencia limitada (`DOCX2PDF_CONCURRENCY`, default 1) con timeout de 90s/120s según tamaño.

### `POST /decryptpdf`
**Archivo:** `cloud/customRoute/decryptpdf.js`
**Parámetros:** archivo multipart en disco (campo `file`), `body.password`
**Retorno:** `200`, stream binario del PDF descifrado (`Content-Type: application/pdf`)
**Errores:** `401 { error: 'Incorrect password.' }` en password incorrecta; `{ error: message }` con `err.code` o 400 en otros casos
**Permisos:** **sin verificación de sesión ni master key** — cualquiera que alcance el endpoint puede intentar descifrar un PDF subido.

### `GET /delete-account/:userId`
**Archivo:** `cloud/customRoute/deleteAccount/deleteUserGet.js`
**Parámetros:** `:userId` (path)
**Retorno:** `200`, página HTML con el formulario de confirmación de borrado por OTP
**Errores:** `404 'User not found.'` (texto plano)
**Permisos:** sin auth — cualquiera con un `userId` válido puede ver el formulario (el borrado real queda gateado por OTP en el POST).

### `POST /delete-account/:userId/otp`
**Archivo:** `cloud/customRoute/deleteAccount/deleteUserOtp.js`
**Parámetros:** `:userId` (path)
**Retorno:** `200 { ok: true, cooldownSec, expiresInMin }`
**Errores:** `404 { error: 'User not found' }`; `429 { error: 'Cooldown not finished', retryAfterSec }` si se reenvía antes del cooldown; `500 { error: 'Failed to send OTP' }`
**Permisos:** sin auth; rate-limitado por `RESEND_COOLDOWN_SEC` (campo `DeleteOTPSentAt` persistido); el OTP se envía al email registrado del usuario, no a uno arbitrario.

### `POST /delete-account/:userId`
**Archivo:** `cloud/customRoute/deleteAccount/deleteUser.js` (`deleteUserPost`)
**Parámetros:** `:userId` (path), `body.otp`
**Retorno:** `200`, texto plano de éxito (`'User and all associated data deleted successfully.'`) u otro mensaje de `deleteUser()`
**Errores:** `404 'Missing userId parameter.'`; `429` (demasiados intentos de OTP inválido, `MAX_ATTEMPTS`); `400` (OTP faltante/expirado/inválido; cuenta no es admin; aún quedan usuarios del equipo); `500` genérico
**Permisos:** sin sesión — depende únicamente del OTP de la cuenta objetivo; solo permitido si el rol de la cuenta es `contracts_Admin` y no quedan otros usuarios del tenant; cascada de borrado sobre ~11 clases relacionadas vía `useMasterKey`.

### `POST /deleteuser/:userId`
**Archivo:** `cloud/customRoute/deleteAccount/deleteUser.js` (`deleteUserByAdmin`)
**Parámetros:** `:userId` (path), header `sessiontoken`
**Retorno:** `200 { message: 'User and all associated data deleted successfully.' }`
**Errores:** `400 { message: 'unauthorized.' }` (sin `sessiontoken`); `400 { message: 'Missing userId parameter.' }`; `400 { message: 'User not found.' }`; `400 { message: 'You cannot delete your own account.' }`; `400 { message: 'Unauthorized.' }` (caller no es Admin/OrgAdmin)
**Permisos:** requiere `sessiontoken` válido resuelto a un `contracts_Admin`/`contracts_OrgAdmin`; un `OrgAdmin` queda acotado a su propia organización; `useMasterKey` para la cascada de borrado.

## Hooks automáticos (beforeSave/afterSave/afterFind)

Triggers registrados sobre clases Parse — no son invocables por nombre desde el cliente, corren automáticamente en cada save/find de la clase indicada.

- **afterSave `contracts_Document`** (`cloud/parsefunction/DocumentAftersave.js`): en creación, calcula `ExpiryDate`/`OriginIp`/`NextReminderDate` y reescribe el ACL del documento (lectura/escritura para los `Signers`, o solo para el creador si no hay firmantes). `useMasterKey`: sí.
- **afterSave `contracts_Contactbook`** (`cloud/parsefunction/ContactBookAftersave.js`): en creación sin `UserId`, crea un `_User` sombra para el contacto y le asigna ACL; si ya tiene `UserId`, asegura ACL de lectura/escritura para creador+usuario y marca `IsDeleted: false`. `useMasterKey`: sí.
- **afterSave `contracts_Template`** (`cloud/parsefunction/TemplateAfterSave.js`): análogo a `DocumentAftersave` para templates (`NextReminderDate`, `OriginIp`, ACL por `Signers`/creador). `useMasterKey`: sí.
- **afterSave `contracts_Teams`** (`cloud/parsefunction/TeamsAftersave.js`): en creación, agrega el puntero del propio equipo a su array `Ancestors` (encadenamiento de jerarquía auto-referenciado). `useMasterKey`: sí.
- **beforeSave `contracts_Document`** (`cloud/parsefunction/DocumentBeforesave.js`): valida longitud máxima de `Name`/`Note`/`Description` y el límite de recordatorios (lanza `VALIDATION_ERROR`/`INVALID_QUERY` en creación); en update, fija `DocSentAt` cuando aparece `SignedUrl` y actualiza el contador de documentos. `useMasterKey`: no directamente (delega en `setDocumentCount`).
- **beforeSave `contracts_Template`** (`cloud/parsefunction/TemplateBeforesave.js`): mismas validaciones de longitud/recordatorios que `Document`; en creación también llama a `setTemplateCount`. `useMasterKey`: no directamente.
- **afterFind `Parse.User`** (`cloud/parsefunction/UserAfterFInd.js`): resuelve `ProfilePic` a una URL firmada (presigned S3 o JWT local), solo cuando se devuelve un único objeto. `useMasterKey`: no.
- **afterFind `contracts_Document`** (`cloud/parsefunction/DocumentAfterFind.js`): resuelve `SignedUrl`/`URL`/`CertificateUrl` a URLs firmadas y resuelve imágenes de placeholders `prefill`, solo para un único objeto devuelto. `useMasterKey`: no.
- **afterFind `contracts_Template`** (`cloud/parsefunction/TemplateAfterFind.js`): igual que `DocumentAfterFind` pero para templates. `useMasterKey`: no.
- **afterFind `contracts_Signature`** (`cloud/parsefunction/SignatureAfterFind.js`): resuelve `ImageURL`/`Initials`/`Stamp` a URLs firmadas para una única firma devuelta. `useMasterKey`: no.
- **afterFind `partners_Tenant`** (`cloud/parsefunction/TenantAfterFind.js`): resuelve `Logo`/`Favicon` a URLs firmadas para un único tenant devuelto. `useMasterKey`: no.

## Ver también

- [../README.md](../README.md)
- [./environment-variables.md](./environment-variables.md)
- [./turborepo-configuration.md](./turborepo-configuration.md)
- [./authentication-and-multitenancy.md](./authentication-and-multitenancy.md)
- [./document-preparation-and-sending.md](./document-preparation-and-sending.md)
- [./signing-ceremony.md](./signing-ceremony.md)
- [./rate-limiting.md](./rate-limiting.md)
- [./testing-guide.md](./testing-guide.md)
- [./deployment-guide.md](./deployment-guide.md)
- [./email-builder.md](./email-builder.md)
- [./opensign-drive.md](./opensign-drive.md)
- [./reports.md](./reports.md)
- [./internationalization.md](./internationalization.md)
- [./frontend-architecture.md](./frontend-architecture.md)
