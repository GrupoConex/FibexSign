# Guía de testing

Este documento describe cómo correr y escribir tests en las dos apps del monorepo FibexSign: el frontend `apps/OpenSign` (Vitest) y el backend `apps/OpenSignServer` (Jasmine + nyc + mongodb-runner). También documenta un hallazgo relevante sobre el estado actual de CI: hoy ningún workflow ejecuta la suite de tests automáticamente.

## Frontend (`apps/OpenSign`)

### Stack y configuración

- Test runner: **Vitest**, configurado en el bloque `test` de `apps/OpenSign/vite.config.js`:
  ```js
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./setuptest.js"
  }
  ```
- Librerías de testing: `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom` (ver `devDependencies` en `apps/OpenSign/package.json`).

### Comandos

Desde `apps/OpenSign`:

```bash
npm run test        # vitest run — corre toda la suite una vez
npm run test:watch  # vitest — modo watch
```

### Convención de ubicación de tests

Los tests están **co-ubicados** en carpetas `__tests__/` junto al código que prueban, no en un directorio de tests centralizado. Ejemplos reales:

- `apps/OpenSign/src/pages/__tests__/Managesign.test.jsx`
- `apps/OpenSign/src/pages/__tests__/Preferences.test.jsx`
- `apps/OpenSign/src/pages/__tests__/UserList.test.jsx`
- `apps/OpenSign/src/components/__tests__/AddUser.test.jsx`
- `apps/OpenSign/src/components/profile/__tests__/PersonalInfoCard.test.jsx`
- `apps/OpenSign/src/hook/__tests__/useIsDarkTheme.test.js`

Patrón: por cada carpeta de código (`pages/`, `components/`, `components/profile/`, `hook/`, etc.) existe una subcarpeta `__tests__/` hermana con los tests de esa carpeta, nombrados `<Componente>.test.jsx` (componentes/páginas) o `<hook>.test.js` (hooks/utilidades).

### Cómo escribir un test nuevo (ejemplo real)

Para un hook nuevo en `src/hook/`, seguir el patrón de `src/hook/__tests__/useIsDarkTheme.test.js`: crear `src/hook/__tests__/<miHook>.test.js`, importar el hook con ruta relativa (`../miHook`) y usar `renderHook`/`act` de `@testing-library/react`. Extracto real del archivo citado:

```js
import { act, renderHook } from "@testing-library/react";
import { useIsDarkTheme } from "../useIsDarkTheme";

describe("useIsDarkTheme", () => {
  afterEach(() => {
    setDataTheme(null);
  });

  it("returns false when data-theme is not opensigndark", () => {
    setDataTheme("opensignlight");
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(false);
  });
  // ...
});
```

Convenciones observadas: `describe`/`it` de Vitest en modo `globals: true` (no hace falta importarlos explícitamente, aunque `no-external-support-links.test.js` sí los importa desde `"vitest"` — ambos estilos conviven en el repo), nombres de test descriptivos en inglés que explican el comportamiento (`"returns false when ..."`), y `afterEach` para limpiar estado global (aquí, el atributo `data-theme` del `document`).

### Tests de invariante de arquitectura (`src/__tests__/`)

Además de los tests co-ubicados por feature, existe una carpeta a nivel raíz **`apps/OpenSign/src/__tests__/`** con tests que no prueban un componente puntual sino que actúan como **invariantes de arquitectura ejecutables**: recorren todo `src/` con `fs`/`path` y verifican una regla global sobre el código fuente, fallando el build de tests si alguien la rompe. Ejemplos reales en el repo:

- `no-blocking-native-dialogs.test.js` — falla si algún archivo fuente (fuera de `__tests__/` y `node_modules`) usa `alert(`, `confirm(`, `window.alert(` o `window.confirm(`, salvo el propio `src/utils/notificationManager.js` (el único punto autorizado a mostrar diálogos nativos bloqueantes).
- `no-external-support-links.test.js` — verifica que no queden enlaces externos de soporte/comunidad (GitHub, Discord, Twitter, LinkedIn) en `SocialMedia.jsx`, `AddAdmin.jsx`, `UpdateExistUserAdmin.jsx`, que `constant/appinfo.js` no defina `supportEmail`, y que el primitive `ShareButton.jsx` ni siquiera exista.
- `no-fibexsign-brand-text.test.js` — invariante de marca (no dejar texto de marca hardcodeado fuera de lo esperado).
- `utils-circular-dependency.test.js` — invariante de que `src/utils/` no tenga dependencias circulares.

**Patrón para agregar una invariante nueva** (basado en `no-blocking-native-dialogs.test.js`):

1. Crear `src/__tests__/<regla-en-kebab-case>.test.js`.
2. Resolver `srcRoot` con `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")`.
3. Recorrer `srcRoot` recursivamente con `fs.readdirSync(..., { withFileTypes: true })`, excluyendo `__tests__` y `node_modules`, y filtrando por extensión (`.js`/`.jsx`, excluyendo `*.test.*`).
4. Aplicar una regex/chequeo por archivo y acumular violaciones (patrón `reduce` inmutable, sin mutar arrays).
5. Un único `it` con `expect(violationReport).toBe("")` (o `expect(...).toBe(true/false)` según el caso) que falla con un reporte legible (archivo + línea) cuando hay violaciones.

Este patrón permite codificar reglas de producto/seguridad/marca como tests normales de Vitest, sin herramientas de lint adicionales.

## Backend (`apps/OpenSignServer`)

### Stack y configuración

- Test runner: **Jasmine**, configurado en `apps/OpenSignServer/spec/support/jasmine.json`:
  ```json
  {
    "spec_dir": "spec",
    "spec_files": ["**/*[sS]pec.js"],
    "helpers": ["support/test-env.helper.js", "helper.js"],
    "stopSpecOnExpectationFailure": false,
    "random": false
  }
  ```
- Cobertura: **nyc**.
- Base de datos: **mongodb-runner** levanta un MongoDB efímero para la suite.
- `spec/helper.js` define los hooks globales `beforeAll`/`afterAll` que arrancan y detienen un Parse Server real contra ese Mongo (`startParseServer`, `dropDB`, `stopParseServer` de `spec/utils/test-runner.js`), con un timeout de 2 minutos para el arranque.

### Comandos

Desde `apps/OpenSignServer`:

```bash
npm run test      # mongodb-runner start && TESTING=true jasmine
npm run coverage  # TESTING=true nyc jasmine
npm run lint      # eslint sobre cloud/, index.js y spec/
npm run lint-fix  # eslint --fix sobre los mismos paths
```

`npm run test` levanta primero el Mongo efímero (`mongodb-runner start`) y luego corre Jasmine con `TESTING=true`; no requiere un Mongo local corriendo de antemano, pero sí requiere Docker o el runtime que `mongodb-runner` necesite para levantar la instancia.

### Convención de ubicación y estilo de specs

Todos los specs viven en `apps/OpenSignServer/spec/`, con nombre `*.spec.js` o `*Spec.js` (patrón `**/*[sS]pec.js` de `jasmine.json`). No hay sub-organización por feature dentro de `spec/`: los archivos son planos, nombrados por el área que cubren. Ejemplos reales:

- `spec/Tests.spec.js` — spec de ejemplo/smoke test de Parse Server (llamadas a Cloud Functions y endpoints HTTP básicos).
- `spec/idor-and-enumeration.spec.js`, `spec/otp-security.spec.js`, `spec/server-hardening.spec.js`, `spec/signup-auth-bypass.spec.js` — specs de seguridad, cada uno enfocado en una clase de vulnerabilidad concreta.
- `spec/no-support-email.spec.js`, `spec/brand-name-firma.spec.js` — invariantes de producto/marca, equivalentes en espíritu a los tests de invariante del frontend pero en Jasmine.
- `spec/helper.js`, `spec/support/` — helpers compartidos (arranque/derribo del server de test, utilidades).

Extracto real de `spec/idor-and-enumeration.spec.js` (uso de `describe`/`it`, helpers locales para dar de alta un usuario/tenant, y `Parse.Cloud.run` contra el server de test):

```js
describe('getUserDetails unauthenticated enumeration is closed', () => {
  Parse.User.enableUnsafeCurrentUser();

  it('returns only an existence flag, never an objectId, for an existing email with no session', async () => {
    const email = `enum-exists-${Date.now()}@example.com`;
    await signupUser(email, 'Str0ngPassw0rd!');

    const result = await Parse.Cloud.run('getUserDetails', { email });

    expect(result).toEqual({ exists: true });
    expect(Object.prototype.hasOwnProperty.call(result, 'objectId')).toBe(false);
  });
});
```

Convenciones observadas: nombres de `describe` que enuncian la invariante de seguridad que se está cerrando (no solo el nombre de la función), emails únicos con `Date.now()` para evitar colisiones entre corridas, y aserciones que chequean tanto el valor devuelto como la **ausencia** de campos sensibles (`hasOwnProperty`) — relevante para specs anti-IDOR/enumeración.

### Cómo escribir un spec nuevo

Seguir el patrón de `idor-and-enumeration.spec.js`: crear `spec/<area>.spec.js`, usar `describe`/`it` de Jasmine, apoyarse en los helpers ya definidos en `spec/helper.js`/`spec/support/` (no reimplementar el arranque de Parse Server), y nombrar el `describe` por la invariante o comportamiento que se protege, no por el nombre técnico de la función bajo test.

## CI no ejecuta tests hoy (hallazgo)

El único workflow de CI del repo es `.github/workflows/Docker.yml`. Se dispara en `push` a `main` y `staging`, y su único trabajo (`docker`) hace build multi-arch (amd64/arm64) y push a Docker Hub de las dos imágenes (`opensign/opensign` desde `apps/OpenSign/Dockerhubfile`, `opensign/opensignserver` desde `apps/OpenSignServer/Dockerhubfile`) usando `docker/build-push-action`. En ningún paso del workflow se ejecuta `npm run test`, `vitest` ni `jasmine`.

Esto significa que, en el estado actual del repo, **toda la suite de tests (frontend y backend) corre únicamente de forma local/manual** — no actúa como gate antes de mergear a `staging`/`main` ni antes de publicar las imágenes Docker que consume `docker-compose.yml`.

Nota (fuera de alcance de esta documentación): sería valioso agregar un job de test — al menos `npm run test` en `apps/OpenSign` y `npm run test` en `apps/OpenSignServer` — a `Docker.yml` (o a un workflow separado) antes del build/push de imágenes, para que un test roto bloquee la publicación. No se implementa acá; queda como mejora sugerida.

## Ver también

- [../README.md](../README.md)
- [./environment-variables.md](./environment-variables.md)
- [./turborepo-configuration.md](./turborepo-configuration.md)
- [./authentication-and-multitenancy.md](./authentication-and-multitenancy.md)
- [./document-preparation-and-sending.md](./document-preparation-and-sending.md)
- [./signing-ceremony.md](./signing-ceremony.md)
- [./cloud-functions-catalog.md](./cloud-functions-catalog.md)
- [./rate-limiting.md](./rate-limiting.md)
- [./deployment-guide.md](./deployment-guide.md)
- [./email-builder.md](./email-builder.md)
- [./opensign-drive.md](./opensign-drive.md)
- [./reports.md](./reports.md)
- [./internationalization.md](./internationalization.md)
- [./frontend-architecture.md](./frontend-architecture.md)
