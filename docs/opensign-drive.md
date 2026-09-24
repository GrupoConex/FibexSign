# OpenSignDrive — Gestor de archivos y documentos

Este documento describe la arquitectura del OpenSignDrive, el espacio central de almacenamiento y organización de documentos en FibexSign. Cubre navegación de carpetas, operaciones de archivo (crear/renombrar/mover/eliminar), búsqueda, estados de documentos y la interacción con el backend. Verificado contra `apps/OpenSign/src/pages/Opensigndrive.jsx`, `apps/OpenSign/src/components/opensigndrive/DriveBody.jsx`, `apps/OpenSign/src/components/shared/fields/FolderModal.jsx`, y las Cloud Functions llamadas en `apps/OpenSignServer/cloud/parsefunction/`.

## Navegación y estructura jerárquica

El Drive mantiene un árbol jerárquico de carpetas almacenadas como registros `contracts_Document` con `Type: 'Folder'` en Parse. La navegación ocurre en dos niveles:

1. **Breadcrumb de ruta** (`folderName` state en `Opensigndrive.jsx`): lista visual de navegación desde "OpenSignDrive" (raíz) hacia carpetas anidadas. Al hacer clic en un punto de la ruta, se recalcula el `docId` a ese nivel y se recargan los contenidos.
2. **Árbol de carpetas** (`FolderModal.jsx`): cuando se mueve un documento, se abre un modal que carga recursivamente subcarpetas mediante queries `Parse.Query` con `Folder` pointer (filtro: `Type: 'Folder'`, `IsArchive !== true`, `CreatedBy: currentUser`).

La relación padre-hijo se modela con un puntero `Folder` en `contracts_Document`:
```javascript
// Carpeta raíz: no tiene campo Folder (doesNotExist("Folder"))
// Carpeta anidada: Folder -> { __type: "Pointer", className: "contracts_Document", objectId: parentId }
```

## Listado de documentos y carpetas

`Opensigndrive.jsx` invoca `getDrive(docId, skip, limit)` (utility wrapper en `apps/OpenSign/src/constant/Utils.js` → Cloud Function `getDrive`) para cargar:

- **Parámetros:** `docId` (carpeta actual, opcional; si no se pasa, lista documentos en raíz), `skip` (paginación), `limit` (50 por defecto)
- **Retorno:** array de `contracts_Document` (tanto carpetas como documentos), excluye campos sensibles (`AuditTrail`, `OriginalDocument`, `SignedDocument`)
- **Filtrado:** server-side por `CreatedBy = request.user` + `IsArchive !== true`

La paginación usa **infinite scroll** con `IntersectionObserver` (ref `bottomRef`) — cuando el usuario llega al final, automáticamente se carga la siguiente página sin recargar la UI.

Los documentos se renderizan en dos modos de vista (controlados por `isList` state):

1. **Cuadrícula (`!isList`)**: cards con vista previa de estado, icono PDF/carpeta, nombre truncado, fecha, y hover card con detalles (signatarios, estado exacto).
2. **Tabla (`isList`)**: filas con columnas Nombre, Fecha creación, Tipo, Estado, Acción (descargar).

## Operaciones sobre carpetas y documentos

### Crear carpeta

`handleAddFolder` (wrappedcon `withSessionValidation`, línea 277):
1. Valida que el nombre no sea vacío.
2. Consulta si ya existe una carpeta con ese nombre en el mismo nivel (`Parse.Query` con `Name`, `Type: 'Folder'`, padre `Folder` opcional, `IsArchive !== true`).
3. Si no existe, crea un nuevo `Parse.Object` con:
   - `Type: 'Folder'`
   - `Name: newFolderName`
   - `ExtUserPtr` → puntero al `contracts_Users` del usuario actual
   - `CreatedBy` → puntero al `_User` del usuario actual
   - `Folder` (opcional) → puntero al padre si está anidada
4. Persiste localmente en `pdfData` y re-ordena según los parámetros de sorting actuales.

### Renombrar documento/carpeta

`handledRenameDoc` (línea 55):
1. Valida longitud > 0.
2. Actualiza localmente el array `pdfData` con el nuevo nombre.
3. Envía un `PUT` REST directo a `/classes/contracts_Document/:docId` con `{ Name: newFolderName }` y headers de sesión (`X-Parse-Session-Token`).

**Nota:** esto es una actualización REST directa, no una Cloud Function, lo que implica que confía en la ACL/sesión de Parse para autorización.

### Mover documento/carpeta

`handleMoveFolder` (línea 195):
1. Abre un modal (`FolderModal.jsx`) que permite navegar la jerarquía de carpetas.
2. El usuario selecciona una carpeta destino (o raíz).
3. Detecta si el documento ya está en esa carpeta (compara `moveFolderId` con `selecFolderId`) para evitar no-ops.
4. Envía `PUT /classes/contracts_Document/:docId` con:
   - Si hay destino: `{ Folder: { __type: "Pointer", className: "contracts_Document", objectId: moveFolderId } }`
   - Si es raíz: `{ Folder: { __op: "Delete" } }` (elimina el puntero)
5. Remueve el documento del array `pdfData` en el frontend.

### Eliminar carpeta

`handleDeleteFolder` (línea 275):
1. Verifica que la carpeta esté vacía mediante `checkFolderEmpty` (query Parse por `Folder` pointer, excluye archivados).
2. Si está vacía, obtiene el objeto y establece `IsArchive: true` (soft delete vía Parse SDK).
3. Si no está vacía, muestra una notificación de error.

### Eliminar documento

`handleDeleteDocument` (línea 158):
1. Envía `PUT /classes/contracts_Document/:docId` con `{ IsArchive: true }`.
2. Remueve del array `pdfData` localmente.

**Nota:** no hay borrado físico — todos los documentos/carpetas se marcan con `IsArchive: true` para auditoría.

## Estados de documento

`getStatusBadgeConfig` (línea 301) determina el estado según los campos del documento:

| Campo | Condición | Estado |
|-------|-----------|--------|
| `IsCompleted` | true | "Completed" (verde) |
| `IsDeclined` | true | "Declined" (rojo) |
| `SignedUrl` ausente | true | "Draft" (azul) |
| Fecha expiración < ahora | true | "Expired" (gris) |
| (otro) | — | "In Progress" (ámbar) |

El estado se usa para renderizar un badge con icono y color, y para determinar a qué página navegar cuando se hace clic sobre un documento (ver `checkPdfStatus`, línea 95).

## Búsqueda de documentos

`handleSearchChange` (línea 530) invoca `Parse.Cloud.run('filterdocs', { searchTerm })` con un debounce de 300ms:

- **Parámetro:** `searchTerm` (búsqueda case-insensitive sobre `Name`)
- **Retorno:** array de `contracts_Document` que coinciden (desde el backend, filtrados por `CreatedBy = request.user`)
- **Comportamiento:** reemplaza completamente `pdfData` con los resultados; al borrar el término, llama nuevamente con string vacío que devuelve todos los documentos del usuario.

## Integración con flujos de firma

El Drive **no inicia** la preparación ni el envío de documentos. Solo navega documentos existentes. Cuando se hace clic sobre un documento, `checkPdfStatus` determina a qué pantalla redirigir:

```javascript
// Draft (sin destinatarios ni placeholders): /signaturePdf/:docId (auto-firma)
// In progress (con placeholders + SignedUrl): /recipientSignPdf/:docId (ver estado de firma)
// Draft con destinatarios/placeholders: /placeHolderSign/:docId (editar/enviar)
// IsSignyourself: /signaturePdf/:docId
// Etc.
```

Para crear documentos nuevos, el usuario usa el botón "+ Nuevo" que abre un menú con:
- **Crear carpeta** → abre modal de entrada de nombre
- **Sign Yourself** → redirige a `/form/sHAnZphf69` (plantilla de auto-firma)
- **Request Signatures** → redirige a `/form/8mZzFxbG1z` (plantilla de envío a terceros)

Estas son plantillas predefinidas, no flujos de creación desde cero.

## Ordenamiento

`sortingData` (línea 365) y `sortedBy` (línea 344) permiten ordenar por:
- **Nombre**: ascendente/descendente (case-insensitive)
- **Fecha creación**: ascendente/descendente

El estado se mantiene en `selectedSort` y `sortingOrder`, y aplica a toda la lista renderizada cada vez que cambia la selección.

## Estados y pagination

- `pdfData`: array completo de documentos cargados hasta ahora (acumula conforme se hace scroll).
- `skip`: offset de paginación (incrementa en `limit` pasos, default 50).
- `loading`: flag de carga en vuelo para evitar requests duplicadas.
- `folderName`: breadcrumb actual.
- `docId`: ID de la carpeta actual siendo visualizada (undefined = raíz).

Al navegar a una carpeta diferente, se resetean `skip: 0` y `pdfData: []` para cargar desde cero.

## Tour interactivo (primera visita)

Al primer acceso, `Opensigndrive.jsx` llama `checkTourStatus` que invoca `Parse.Cloud.run('getUserDetails')` para revisar si el usuario ya vio el tour (campo `TourStatus`). Si no, renderiza un tour paso a paso con `reactour` (7 pasos configurables). El usuario puede marcar "Don't show again" (`isDontShow`), que persiste via `PUT /classes/contracts_Users/:extUserId` con `{ TourStatus: [...] }`.

## Diagrama — flujo de navegación y operaciones en OpenSignDrive

```mermaid
flowchart TD
    A[Usuario accede a /opensigndrive] --> B[Opensigndrive.jsx]
    B --> C{¿Primer acceso?}
    C -->|sí| D[getUserDetails → verificar TourStatus]
    C -->|no| E[getDrive → cargar documentos de raíz]
    D --> E
    E --> F[Renderizar carpetas + documentos<br/>en grid o tabla]
    F --> G{Acción del usuario}
    G -->|Click en carpeta| H[Actualizar docId + folderName<br/>getDrive con nuevo docId]
    G -->|Click en documento| I[checkPdfStatus →<br/>navegar a /signaturePdf, /recipientSignPdf, etc.]
    G -->|Búsqueda| J[filterdocs → resultados en pdfData]
    G -->|+ Nuevo| K[Menú: Crear carpeta / Sign Yourself / Request Signatures]
    K -->|Crear carpeta| L[Validar nombre único a este nivel<br/>Parse.Object.save con Type: Folder]
    K -->|Sign Yourself| M[Redirigir a /form/sHAnZphf69]
    K -->|Request Signatures| N[Redirigir a /form/8mZzFxbG1z]
    G -->|Renombrar| O[REST PUT /classes/contracts_Document<br/>{ Name: newName }]
    G -->|Mover| P[FolderModal.jsx → seleccionar destino<br/>REST PUT con Folder pointer o __op: Delete]
    G -->|Eliminar| Q{¿Es carpeta?}
    Q -->|sí| R[Verificar isEmpty<br/>REST PUT { IsArchive: true }]
    Q -->|no| S[REST PUT { IsArchive: true }]
    H --> F
    J --> F
    O --> F
    P --> F
    R --> F
    S --> F
```

## Cloud Functions utilizadas

Verificadas en `docs/cloud-functions-catalog.md`:

- **`getDrive`** (línea 121 del catálogo): lista documentos/carpetas de una carpeta con paginación.
- **`filterdocs`** (línea 163): busca documentos por nombre.
- **`getUserDetails`** (línea 28): obtiene detalles extendidos del usuario (incluyendo TourStatus).

Ninguna de estas funciones se documentaba previamente específicamente para OpenSignDrive, pero todas están presentes en el catálogo.

## Operaciones Parse SDK (no Cloud Functions)

El Drive también usa consultas Parse SDK directas sobre `contracts_Document`:

| Operación | Línea aprox. | Propósito |
|-----------|---|---|
| `Parse.Query("contracts_Document").equalTo("Name", ...)` | 296–302 (Opensigndrive) | Verificar nombre de carpeta único antes de crear |
| `Parse.Query("contracts_Document").equalTo("Folder", folderPtr)` | 260 (DriveBody) | Listar contenido de una subcarpeta |
| `Parse.Query("contracts_Document").doesNotExist("Folder")` | 36 (FolderModal) | Listar documentos en raíz del drive |

## Autenticación y sesión

Todas las operaciones que escriben (`handleAddFolder`, `handledRenameDoc`, `handleMoveFolder`, `handleDeleteDocument`, `handleDeleteFolder`) están wrappedadas con `withSessionValidation`, que verifica:
- `localStorage.TenantId` existe
- `Parse.User.current().getSessionToken()` es válido

Si falta alguno, aborta la operación y despacha `sessionStatus(false)` a Redux, que dispara `SessionExpiredModal` y cierra sesión.

## Hallazgos y discrepancias

1. **Operaciones REST directas sin Cloud Function:** Renombrar, mover y eliminar usan `axios.put` contra `/classes/contracts_Document/:docId` en vez de Cloud Functions dedicadas. Esto significa que la autorización se confía completamente a la ACL de Parse y al `X-Parse-Session-Token` enviado en headers. Esto es funcional pero menos auditable que si hubiese funciones centralizadas (`renameDocFromDrive`, `moveDocFromDrive`, etc.) que logueen cambios específicamente.

2. **Soft delete sin cascada auditable:** `IsArchive: true` es el único mecanismo de eliminación. Dependiendo de qué tan estrictos sean los requisitos de auditoría, puede ser necesario un hook `beforeSave` que registre en un log de cambios (audit trail) cada vez que se archiva, especialmente para carpetas que contienen documentos sensibles.

3. **No hay validación server-side de nombre único:** La validación de "carpeta ya existe" ocurre client-side (`Parse.Query` en el cliente) antes de crear. Aunque Parse resuelve la sesión, es posible que dos requests concurrentes pasen la check simultáneamente y creen duplicados si no hay un índice único DB-side sobre `(Folder, Name, CreatedBy, IsArchive)`.

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
- [./reports.md](./reports.md)
- [./internationalization.md](./internationalization.md)
- [./frontend-architecture.md](./frontend-architecture.md)
