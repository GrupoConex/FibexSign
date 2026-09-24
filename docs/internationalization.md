# Internacionalización (i18n)

FibexSign soporta **7 idiomas** mediante `i18next` + `react-i18next` con carga dinámica de archivos de traducción vía HTTP. Este documento explica cómo se configura y cómo agregar nuevos idiomas o traducciones.

Configuración verificada contra:
- `apps/OpenSign/src/i18n.js`
- `apps/OpenSign/package.json`
- `apps/OpenSign/public/locales/{de,en,es,fr,hi,it,kr}/translation.json`
- `apps/OpenSign/src/components/pdf/SelectLanguage.jsx`

## Configuración de i18next

El archivo `apps/OpenSign/src/i18n.js` inicializa i18next con la siguiente topología:

```javascript
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import Backend from "i18next-http-backend";
import LanguageDetector from "i18next-browser-languagedetector";

i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    backend: {
      loadPath: "/locales/{{lng}}/{{ns}}.json"
    },
    fallbackLng: "en",
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"]
    },
    ns: ["translation"],
    defaultNS: "translation",
    debug: false,
    interpolation: {
      escapeValue: false
    },
    whitelist: ["en", "es", "fr", "it", "de", "hi", "kr"]
  });
```

### Módulos utilizados

| Paquete | Versión | Propósito |
|---|---|---|
| `i18next` | `^26.0.8` | Motor central de internacionalización |
| `react-i18next` | `^17.0.6` | Integración con React (hooks, componentes) |
| `i18next-http-backend` | `^3.0.6` | Carga de archivos de traducción vía HTTP (no bundleados) |
| `i18next-browser-languagedetector` | `^8.2.1` | Detección automática de idioma del navegador y persistencia en `localStorage` |

### Comportamiento clave

- **Carga de archivos:** Las traducciones se cargan dinámicamente desde `/locales/{{lng}}/{{ns}}.json` (ej. `/locales/es/translation.json`). No están incluidas en el bundle — se descargan al navegador cuando cambia el idioma.
- **Namespace:** Solo existe un único namespace llamado `translation`. Todas las claves de traducción viven en un único archivo `translation.json` por idioma.
- **Detección de idioma:** El sistema intenta detectar el idioma del usuario en este orden:
  1. Valor guardado en `localStorage` bajo la clave `i18nextLng` (persiste entre sesiones).
  2. Idioma del navegador (vía `navigator.language` o `navigator.languages`).
  3. Fallback a `en` si ninguno de los anteriores está disponible o no es soportado.
- **Interpolación:** Las traducciones pueden incluir variables con sintaxis `{{variable}}` (ej. `"Subscription renews in {{days}} days"`). React i18next escapa automáticamente el HTML, así que no hay riesgo de XSS.

## Estructura de archivos de localización

```
apps/OpenSign/public/locales/
├── de/
│   └── translation.json      # Alemán (Deutsch)
├── en/
│   └── translation.json      # Inglés (English)
├── es/
│   └── translation.json      # Español
├── fr/
│   └── translation.json      # Francés (Français)
├── hi/
│   └── translation.json      # Hindi (हिन्दी)
├── it/
│   └── translation.json      # Italiano
└── kr/
    └── translation.json      # Coreano (한국어)
```

Cada archivo `translation.json` contiene un objeto JSON plano con ~1300 pares clave-valor. Las claves son **kebab-case** (ej. `enter-document-title`, `user-already-exist`). Algunos valores pueden ser strings simples o objetos anidados para agrupar conceptos relacionados:

```json
{
  "language": "Language",
  "email": "Email",
  "sort-order": {
    "Ascending": "Ascending",
    "Descending": "Descending",
    "Name": "Name",
    "Date": "Date"
  },
  "context-menu": {
    "Download": "Download",
    "Rename": "Rename",
    "Move": "Move",
    "Delete": "Delete"
  },
  "subscription-renew-warning": "Your subscription will expire in {{remainingDays}} days. Please renew your subscription."
}
```

## Uso en componentes React

### Hook `useTranslation`

Todos los componentes que necesiten acceso a traducciones importan y usan el hook:

```javascript
import { useTranslation } from "react-i18next";

function MyComponent() {
  const { t, i18n } = useTranslation();
  
  return (
    <div>
      <h1>{t("document-details")}</h1>
      <button onClick={() => i18n.changeLanguage("es")}>
        Español
      </button>
    </div>
  );
}
```

**Ejemplos en el codebase:**
- `apps/OpenSign/src/components/AddUser.jsx:23` — `const { t } = useTranslation();`
- `apps/OpenSign/src/components/AddUser.jsx:71` — `notify.warning(t("valid-email-alert"));`
- `apps/OpenSign/src/components/AddUser.jsx:77` — `notify.error(t("user-already-exist"));`

### Cambio de idioma

El componente `SelectLanguage` (ubicado en `apps/OpenSign/src/components/pdf/SelectLanguage.jsx`) proporciona la interfaz de usuario para cambiar idioma:

```javascript
const handleChangeLang = (e) => {
  const newLang = e.target.value;
  i18n.changeLanguage(newLang);
  updateExtUser && updateExtUser({ language: newLang });
};
```

Cuando el usuario selecciona un idioma nuevo:
1. `i18n.changeLanguage(newLang)` dispara la descarga del archivo `translation.json` del nuevo idioma (si no está cacheado en memoria).
2. Todos los componentes que usan `useTranslation()` se re-renderizan automáticamente con las nuevas cadenas.
3. Se persiste el idioma elegido en `localStorage` para la próxima sesión.

## Agregar un nuevo idioma

Para agregar un idioma nuevo (ej. `pt` para Portugués):

1. **Crear la carpeta y archivo de traducción:**
   ```bash
   mkdir -p apps/OpenSign/public/locales/pt
   cp apps/OpenSign/public/locales/en/translation.json apps/OpenSign/public/locales/pt/translation.json
   ```

2. **Traducir las claves:** Abre `apps/OpenSign/public/locales/pt/translation.json` y reemplaza los valores en inglés con las traducciones en portugués. Mantén las claves exactamente igual — solo traducen los valores.

3. **Actualizar la configuración de i18next:** Edita `apps/OpenSign/src/i18n.js` y agrega el código al array `whitelist`:
   ```javascript
   whitelist: ["en", "es", "fr", "it", "de", "hi", "kr", "pt"]
   ```

4. **Registrar el idioma en el selector UI:** Edita `apps/OpenSign/src/components/pdf/SelectLanguage.jsx` y agrega una entrada al array `LANGUAGES`:
   ```javascript
   const LANGUAGES = [
     { value: "en", text: "English" },
     { value: "es", text: "Español" },
     // ...
     { value: "pt", text: "Português" }
   ];
   ```

5. **Verificar:** Reinicia el servidor de desarrollo (`pnpm dev:frontend` en `apps/OpenSign`) y la nueva opción debe aparecer en el selector de idioma.

**Nota sobre `whitelist` vs `supportedLngs`:** El código actual usa `whitelist`, que es la opción de versiones antiguas de i18next. A partir de la versión 24+, se reemplazó por `supportedLngs`. En la versión instalada (`^26.0.8`), `whitelist` sigue funcionando pero genera un aviso de deprecación — para futuros refactoring, considerar migrar a `supportedLngs`.

## Agregar una clave de traducción nueva

Cuando se agrega una característica nueva que requiere texto traducible:

1. **Decidir el nombre de la clave:** Usa kebab-case siguiendo la convención actual (ej. `new-feature-title`, `delete-confirmation-message`).

2. **Agregar la clave a TODOS los idiomas:** Abre cada archivo `translation.json` en los 7 locales y agrega la nueva clave:
   ```json
   {
     "existing-key": "...",
     "new-feature-title": "Your translated text here",
     ...
   }
   ```

3. **Usar en el componente:**
   ```javascript
   const { t } = useTranslation();
   return <h1>{t("new-feature-title")}</h1>;
   ```

**Problema actual — sin automatización de sincronización:** No hay scripts en `apps/OpenSign/package.json` que detecten automáticamente:
- Claves faltantes en algún idioma (ej. la clave `attachments-docx-size-limit` falta en `es` pero existe en `en`).
- Claves obsoletas que fueron eliminadas del código pero quedan en los archivos de traducción.
- Nuevas claves en el código que no han sido agregadas a todos los locales.

**Hallazgo verificado:** Comparando `translation.json` entre `en` y `es`, existe una discrepancia:
- `es` tiene `attachments-docx-upload-limit` pero falta `attachments-docx-size-limit`.
- Esto puede causar que esa clave muestre la clave misma (ej. `"attachments-docx-size-limit"`) en lugar de texto traducido cuando se usa en `es`.

**Recomendación para el futuro:** Considerar agregar un script de validación (ej. con `node` o `bash`) que:
- Lea todos los archivos de `translation.json`.
- Detecte claves faltantes entre idiomas.
- Alerte al desarrollador si una clave nueva aparece en el código pero no en todos los `translation.json`.

## Cambio de idioma persistente

Cuando un usuario autenticado cambia su idioma de preferencia vía `SelectLanguage`, el componente llama a `updateExtUser({ language: newLang })`, que típicamente:
1. Persiste la preferencia en la base de datos del usuario (vía un Cloud Function o API endpoint del backend).
2. En sesiones futuras, `HomeLayout.jsx` o `Login.jsx` lee esa preferencia y llama a `i18n.changeLanguage()` automáticamente.

Esto asegura que cada usuario vea su idioma preferido sin necesidad de confiar únicamente en `localStorage`.

## Cacheado del navegador

Una vez que se descarga un archivo `translation.json`, el navegador lo cachea en memoria por la duración de la sesión. El cambio entre idiomas es instantáneo porque:
1. Primera carga de idioma → descarga vía HTTP (Backend de i18next-http-backend).
2. Cambios posteriores del mismo idioma → lectura de memoria (sin HTTP).

Cambiar a un idioma nuevo que ya fue usado antes en esa sesión es de nuevo instantáneo.

## Interpolación de variables

Las claves de traducción pueden incluir placeholders que se reemplazan en runtime:

```json
{
  "subscription-renew-warning": "Your subscription will expire in {{remainingDays}} days. Please renew your subscription.",
  "gdrive-info-connect": "When Google Drive is connected, the completed document will be saved in the {{appName}} folder on Google Drive."
}
```

En el componente, se pasan las variables como segundo argumento a `t()`:

```javascript
{t("subscription-renew-warning", { remainingDays: 7 })}
{t("gdrive-info-connect", { appName: "FibexSign" })}
```

React i18next escapa automáticamente los valores, previniendo inyecciones de XSS.

## Locale codes

Los códigos de idioma usados son códigos ISO 639-1 de dos caracteres (con una excepción: `kr` para Coreano en lugar del estándar `ko`). Esta discrepancia es un legado del fork de OpenSign original y se mantiene por compatibilidad.

| Código | Idioma | Nota |
|---|---|---|
| `en` | English | Idioma por defecto, usado como fallback |
| `es` | Español | — |
| `fr` | Français | — |
| `it` | Italiano | — |
| `de` | Deutsch | — |
| `hi` | Hindi | — |
| `kr` | 한국어 (Coreano) | Debería ser `ko` según ISO 639-1, pero se usa `kr` |

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
- [./reports.md](./reports.md)
- [./frontend-architecture.md](./frontend-architecture.md)
