# Reportes — contactos, documentos y plantillas

Este documento describe los tres tipos de reportes disponibles en FibexSign — documentos, contactos y plantillas — las vistas que los muestran, los filtros y búsquedas disponibles, y cómo se genera y exporta el contenido. Todo fue verificado contra `apps/OpenSign/src/pages/Report.jsx`, `apps/OpenSign/src/json/ReportJson.js`, `apps/OpenSign/src/reports/{contact,document,template}/`, `apps/OpenSignServer/cloud/parsefunction/getReport.js` y `reportsJson.js`.

## Punto de entrada y enrutamiento

El usuario llega a los reportes desde `/report/:id`, donde `:id` es un identificador de reporte registrado en `ReportJson.js` (frontend) y `reportsJson.js` (backend). El componente `Report.jsx` actúa como orquestador: resuelve qué vista específica renderizar según el `id`, carga la configuración de columnas desde `localStorage` (clave: `reportColumns`), y delega las llamadas de datos a la Cloud Function `getReport`.

```
GET /report/:id
├─ report id = "contacts" → Contactbook.jsx
├─ report id = "6TeaPr321t" → TemplatesReport.jsx
└─ report id = (documento) → DocumentsReport.jsx
```

## Reportes de documentos

### Tipos de reportes documentales

Frontend (`ReportJson.js`) y backend (`reportsJson.js`) definen 9 tipos de reportes sobre `contracts_Document`:

| ID | Nombre | Descripción |
|---|---|---|
| `ByHuevtCFY` | Draft Documents | Documentos sin enviar |
| `4Hhwbp482K` | Need your sign | Documentos esperando mi firma |
| `1MwEuxLEkF` | In-progress documents | Documentos enviados, en progreso |
| `kQUoW4hUXz` | Completed Documents | Documentos completamente firmados |
| `UPr2Fm5WY3` | Declined Documents | Documentos rechazados |
| `zNqBHXHsYH` | Expired Documents | Documentos vencidos |
| `d9k3UfYHBc` | Recently sent for signatures | Últimos enviados (dashboard) |
| `5Go51Q7T8r` | Recent signature requests | Últimos que me piden firmar (dashboard) |
| `kC5mfynCi4` | Drafts | Borradores (dashboard) |

### Columnas mostradas

Cada reporte muestra un conjunto fijo de columnas (configurables por usuario en `localStorage`):

- **Comunes:** `Title`, `Note`, `Folder`, `File`, `Owner`, `Signers`
- **In-progress:** `Title`, `Note`, `Folder`, `File`, `Signers`, `Sent Date`
- **Declined:** `Title`, `Reason`, `Folder`, `File`, `Owner`, `Signers`
- **Extra columnas** (seleccionables): `Note`, `Time to complete (Days)`, `Enable Tour`, `Notify on signatures`, `Redirect url`, `Created Date`, `Updated Date`

### Acciones por reporte

- **Draft Documents:** Edit, Delete
- **Need your sign:** Sign
- **In-progress:** Share, View, Resend, Rename, Extend expiry, Revoke, Save as template, Delete
- **Completed Documents:** View, Delete, Save as template, Fix & resend
- **Declined Documents:** View, Delete, Save as template, Fix & resend
- **Expired Documents:** View, Delete, Extend expiry, Save as template

### Búsqueda y filtros

- **Búsqueda:** campo libre sobre `Name` (debounce 300ms, AbortController)
- **Filtro de estado de firmante:** `signerStatus` (all/viewed/signed)
- **Paginación:** `skip` y `limit`, típicamente 20 documentos por llamada

## Reporte de contactos (Contactbook)

Vista: `apps/OpenSign/src/reports/contact/Contactbook.jsx`

### Datos mostrados

Columnas: `Name`, `Email`, `Phone`, `Company`, `JobTitle`

Origen: `contracts_Contactbook` del usuario autenticado, filtrados por `IsDeleted !== true`.

### Acciones

- **Edit:** abre `EditContactForm.jsx`, llama Cloud Function `editcontact`
- **Delete:** soft-delete con `IsDeleted: true`

### Importación de contactos (ImportContact.jsx)

- **Formatos:** `.csv`, `.xlsx`, `.xls` (máx. 100 registros)
- **Headers requeridos:** `Name`, `Email`
- **Headers opcionales:** `Phone`, `Company`, `JobTitle`
- **Validación:** regex de email
- **Envío:** Cloud Function `createbatchcontact`

## Reporte de plantillas (TemplatesReport)

Vista: `apps/OpenSign/src/reports/template/TemplatesReport.jsx`

### Datos mostrados

Columnas: `Title`, `File`, `Owner`, `Signers` (base)

Origen: `contracts_Template` filtrado por `Type !== 'Folder'` y `IsArchive !== true`

### Acciones

- **Use:** crea documento nuevo desde plantilla
- **Quick send:** envío masivo
- **Opciones:** Edit, Rename, Delete, Share with team

### Tour interactivo

`ReportTour.jsx` define 4 pasos de onboarding (selector data-tut):
1. `reactourFirst` - Introducción
2. `reactourSecond` - Botón "Use"
3. `tourbulksend` - Botón "Quick send"
4. `reactourThird` - Menú opciones

## Cloud Function getReport

**Archivo:** `apps/OpenSignServer/cloud/parsefunction/getReport.js`

**Parámetros:**
- `reportId` (required): identificador del reporte
- `skip` (required): offset de paginación
- `limit` (required): cantidad de resultados
- `searchTerm` (optional): búsqueda por Name/Email
- `signerStatus` (optional): viewed/signed/all
- Headers: `sessiontoken` o `x-parse-session-token`

**Flujo interno:**
1. Resuelve usuario vía `GET /users/me`
2. Llama `reportJson(reportId, userId)` para obtener params y clase
3. Aplica filtros especiales para Templates (equipos, usuarios compartidos)
4. Aplica `applySearch()` si hay `searchTerm`
5. Filtra por `AuditTrail.Activity` si `signerStatus` está presente
6. Construye URL REST a `/classes/{reportClass}` y retorna resultados

## Filtro de búsqueda (applySearch)

Definido en `reportsJson.js`:

- **Contactbook:** `$or: [{ Name: /searchTerm/i }, { Email: /searchTerm/i }]`
- **Documentos/Plantillas:** `$or: [{ Name: /searchTerm/i }, { Signers: { $inQuery: { ... Email: /searchTerm/i } } }]`

## Selección de columnas

**Almacenamiento:** `localStorage.reportColumns` = JSON con estructura:
```javascript
{
  "reportId": { 
    visible: ["Name", "Email"], 
    labels: { "Name": "Full Name" } 
  }
}
```

**Fallback:** si no hay preferencia, se usan columnas por defecto de `json.heading`

## Integración con backend (reportsJson.js)

**Archivo:** `apps/OpenSignServer/cloud/parsefunction/reportsJson.js`

Cada reportId retorna:
```javascript
{
  reportName: "...",
  reportClass: "contracts_Document" | "contracts_Contactbook" | "contracts_Template",
  params: { /* query filters */ },
  keys: [ /* columnas a retornar */ ]
}
```

- `params`: filtros WHERE de Parse
- `keys`: proyección de columnas
- Acceso acotado a usuario autenticado
- Templates: acceso por equipos + usuarios compartidos

## Ver también

- [../README.md](../README.md)
- [./environment-variables.md](./environment-variables.md)
- [./turborepo-configuration.md](./turborepo-configuration.md)
- [./authentication-and-multitenancy.md](./authentication-and-multitenancy.md)
- [./document-preparation-and-sending.md](./document-preparation-and-sending.md)
- [./signing-ceremony.md](./signing-ceremony.md)
- [./cloud-functions-catalog.md](./cloud-functions-catalog.md)
- [./rate-limiting.md](./rate-limiting.md)
- [./testing-guide.md](./testing-guide.md)
- [./deployment-guide.md](./deployment-guide.md)
- [./email-builder.md](./email-builder.md)
- [./opensign-drive.md](./opensign-drive.md)
- [./internationalization.md](./internationalization.md)
- [./frontend-architecture.md](./frontend-architecture.md)
