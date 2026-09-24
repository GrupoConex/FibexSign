# Variables de entorno

FibexSign usa **un único archivo `.env.example`** en la raíz del repositorio (no hay un `.env.example` por app dentro de `apps/OpenSign` o `apps/OpenSignServer`). El mismo patrón aplica a `.env.local_dev`, el archivo con valores de desarrollo local (no sensibles, versionado en git) que se usa para levantar el stack completo.

## Cómo se distribuye el archivo `.env`

El `Makefile` de la raíz es quien copia el archivo a los lugares donde cada proceso lo necesita:

```make
build:
	cp .env.local_dev .env
	cd apps/OpenSign && cp ../../.env.local_dev .env && npm install && npm run build
	HOST_URL=${HOST_URL} docker compose up --build --force-recreate

run:
	cp .env.local_dev .env
	docker compose up -d
```

Esto deja:

- `<raíz>/.env` — usado por `docker-compose.yml` vía `env_file: .env` en los servicios `server` y `client`.
- `apps/OpenSign/.env` — usado por Vite (`loadEnv`) cuando el frontend se compila o corre nativamente (`npm run build` / `npm run dev`).

**Importante — gap no cubierto por el `Makefile`:** `apps/OpenSignServer` NO recibe una copia propia de `.env`. El backend carga variables con `dotenv.config()` (sin `path` explícito), lo que resuelve el archivo `.env` relativo al directorio de trabajo del proceso. Cuando el backend corre **dentro de Docker** (`make build` / `make run`), esto no es un problema porque `docker-compose.yml` inyecta las variables vía `env_file: .env` (raíz). Pero si se ejecuta el backend **fuera de Docker** con `pnpm dev:backend` / `pnpm --filter open_sign_server dev`, hay que copiar manualmente `.env` a `apps/OpenSignServer/.env` (o exportar las variables al shell), porque el `Makefile` no lo hace por vos.

## Frontend config

| Variable | Aplica a | Obligatoria | Valor por defecto | Descripción e impacto |
|---|---|---|---|---|
| `PUBLIC_URL` | Frontend | No (vestigial) | — | Comentario original: *"Set it to the URL form where the app home page will be accessed"*. Es una variable heredada de Create React App. `vite.config.js` solo expone al bundle las variables con prefijo `REACT_APP_`; `PUBLIC_URL` no lo tiene, y no aparece referenciada en `apps/OpenSign/src` ni en `server.cjs`. Actualmente no tiene ningún efecto en el build ni en el servidor de producción. |
| `GENERATE_SOURCEMAP` | Frontend | No (vestigial) | — | Comentario original: *"Set it to true if you want to generate the Sourcemap for debugging"*. También heredada de CRA; Vite controla sourcemaps por su propia configuración de build (`build.sourcemap` en `vite.config.js`, no seteado hoy). No se encontró ninguna referencia a esta variable en el código actual. |
| `REACT_APP_SERVERURL` | Frontend | Recomendada | `window.location.origin + "/api/app"` (fallback en runtime) | Comentario original: *"Set it to the URL from where APIs will be accessible..."*. Consumida en `apps/OpenSign/src/constant/appinfo.js` (`serverUrl_fn`). Si no está definida, el frontend intenta construir la URL del API a partir del origen actual del navegador. |
| `REACT_APP_APPID` | Frontend | No | `opensign` | Comentario original: *"A 12 character long random app identifier. The value of this should be same as APP_ID..."*. Debe coincidir con `APP_ID` del backend. Leída en `appinfo.js` con fallback a `'opensign'`. |
| `REACT_APP_GTM` | Frontend | No | — | Comentario original: *"Google tag manager container id..."*. La dependencia `react-gtm-module` está declarada en `apps/OpenSign/package.json`, pero no se encontró ningún `import` de esa librería ni referencia a `REACT_APP_GTM` en `apps/OpenSign/src`. Es decir: está declarada y documentada, pero actualmente no está cableada a ningún componente (queda como reserva para integración futura). |

## Backend ExpressJS config

| Variable | Aplica a | Obligatoria | Valor por defecto | Descripción e impacto |
|---|---|---|---|---|
| `APP_ID` | Backend | No | `opensign` | Comentario original: *"...should be same as REACT_APP_APPID..."*. Leída en `Utils.js` como `serverAppId = process.env.APP_ID \|\| 'opensign'`. |
| `appName` | Backend | No (**ver discrepancia**) | — | Comentario original: *"Name of the app. It will be visible in the verification emails sent out."*. **Discrepancia verificada en código:** `Utils.js` línea 22 define `export const appName = 'Firma';` como constante **hardcodeada**, ignorando por completo el valor de `process.env.appName`. Cambiar esta variable en `.env` no tiene ningún efecto hoy; el nombre visible en emails es siempre `"Firma"`. |
| `MASTER_KEY` | Backend | **Sí** | — | Comentario original: *"...secret key that allows access to all the data..."*. Se pasa directo a `masterKey` de Parse Server sin fallback. También se reinyecta como variable de entorno al subproceso de migraciones (`node ./node_modules/parse-dbtool/...migrate`). Sin este valor, Parse Server arranca sin master key funcional. |
| `MONGODB_URI` | Backend | Condicional | — | Comentario original: *"Mongodb URI to connect to"*. **Ver discrepancia con `DATABASE_URI`** en la sección de variables ausentes de `.env.example` más abajo — `DATABASE_URI` tiene prioridad si ambas están definidas. |
| `PARSE_MOUNT` | Backend | No | `/app` | Comentario original: *"Path on which APIs should be mounted. Do not change this..."*. Leída en `index.js` como `mountPath`. |
| `SERVER_URL` | Backend | Recomendada | `http://localhost:${PORT}/app` si `PORT` está seteado, si no `/app` | Comentario original: *"...URL from where APIs will be accessible to the NodeJS functions..."*. Usada para `cloudServerUrl` (`Utils.js`) y `publicServerURL` de Parse Server (`index.js`). También se parsea con `new URL(...)` en el middleware de archivos firmados — si está mal formada, esa ruta lanza excepción. |

## Rate Limiting config

| Variable | Aplica a | Obligatoria | Valor por defecto | Descripción e impacto |
|---|---|---|---|---|
| `AUTH_RATE_LIMIT_WINDOW_MS` | Backend | No | `300000` (5 min) | Comentario original coincide con el código (`utils/authRateLimiter.js`). Ventana compartida por el limiter estricto (login) y el operacional. |
| `AUTH_RATE_LIMIT_MAX` | Backend | No | `30` | Comentario original coincide con el código. Aplica a rutas "estrictas" (`/login`, `/requestPasswordReset`, `/functions/loginuser`, `/functions/AuthLoginAsMail`, `/functions/SendOTPMailV1`, `/functions/addadmin`, `/functions/usersignup`). |
| `OPERATIONAL_RATE_LIMIT_MAX` | Backend | No | **No es simplemente `300`** | Comentario original dice *"(default: 300)"*, pero el código real es más específico: `Number(process.env.OPERATIONAL_RATE_LIMIT_MAX) \|\| (process.env.AUTH_RATE_LIMIT_MAX ? Number(process.env.AUTH_RATE_LIMIT_MAX) * 10 : 300)`. Es decir: si `OPERATIONAL_RATE_LIMIT_MAX` no está seteada pero `AUTH_RATE_LIMIT_MAX` sí, el default real es `AUTH_RATE_LIMIT_MAX × 10`, no `300`. Solo cae en `300` si **ninguna** de las dos está definida. Aplica a rutas operacionales (`/functions/getUserDetails`, `/functions/declinedoc`). |

## Storage config (S3 / DigitalOcean Spaces)

| Variable | Aplica a | Obligatoria | Valor por defecto | Descripción e impacto |
|---|---|---|---|---|
| `USE_LOCAL` | Backend | No | `'false'` (string) si no está seteada | Comentario original (citado tal cual, con el typo del archivo): *"Set this to true id you are using local storage instead of s3 compatible storage"*. Leída en `Utils.js` como `useLocal`, comparada en minúsculas. Si es distinto de `'true'`, el backend intenta usar `S3Adapter`. |
| `DO_SPACE` | Backend | Condicional | — | Nombre del bucket/space. Solo relevante si `USE_LOCAL !== 'true'`. |
| `DO_ENDPOINT` | Backend | Condicional | — | Si no incluye `http`, se le antepone `https://` automáticamente (`index.js`). |
| `DO_BASEURL` | Backend | Condicional | — | Base URL pública de los archivos. |
| `DO_ACCESS_KEY_ID` | Backend | Condicional | — | Credencial S3/DO. |
| `DO_SECRET_ACCESS_KEY` | Backend | Condicional | — | Credencial S3/DO. |
| `DO_REGION` | Backend | Condicional | `us-west` (valor de ejemplo, no hay fallback en código) | Región S3/DO. |

**Comportamiento de fallback verificado (no documentado en el comentario original):** la construcción de `S3Adapter` está envuelta en `try/catch` en `index.js`. Si falla (credenciales inválidas, config incompleta), el backend **no aborta el arranque**: cae silenciosamente a `FSFilesAdapter` (almacenamiento local en `./files`) y solo deja un `console.log('Please provide AWS credintials in env file! Defaulting to local storage.')`. Esto significa que una mala configuración de storage en producción puede pasar desapercibida y el servidor terminar guardando archivos en disco local en vez del bucket esperado.

## Email (Mailgun o SMTP)

| Variable | Aplica a | Obligatoria | Valor por defecto | Descripción e impacto |
|---|---|---|---|---|
| `MAILGUN_API_KEY` | Backend | Condicional | — | Comentario original del bloque: *"(The app will not initialize if any of these 3 variables are not set)"*. **Discrepancia verificada:** esto no es exacto. El código solo evalúa `process.env.MAILGUN_API_KEY` como condición para intentar Mailgun (`else if (process.env.MAILGUN_API_KEY)`); `MAILGUN_DOMAIN` y `MAILGUN_SENDER` se leen sin validar que existan. Si faltan, Mailgun puede fallar en tiempo de envío, no en el arranque. Además, si ninguna de las 3 vars de Mailgun ni la config SMTP resultan válidas, la app **igual arranca** — simplemente no configura `emailAdapter` en Parse Server (bloque condicional `isMailAdapter === true`) y los emails no se envían. |
| `MAILGUN_DOMAIN` | Backend | Condicional | — | Ver nota anterior. |
| `MAILGUN_SENDER` | Backend | Condicional | — | Usado como remitente si SMTP no está habilitado (`mailsender`). |
| `SMTP_ENABLE` | Backend | No | `false` | Comparado en minúsculas contra `'true'` (`Utils.js`, `smtpenable`). Si es `true`, se intenta SMTP antes que Mailgun. |
| `SMTP_HOST` | Backend | Condicional (si `SMTP_ENABLE=true`) | — | Host del transporte Nodemailer. |
| `SMTP_PORT` | Backend | No | `465` | Si no está seteado, `index.js` usa `465`. Además, `smtpsecure` (`Utils.js`) se calcula como `true` salvo que `SMTP_PORT` esté seteado y sea distinto de `'465'` — es decir, TLS implícito por defecto. |
| `SMTP_USER_EMAIL` | Backend | Condicional | — | Usado como remitente (`mailsender`) y como usuario de auth SMTP si `SMTP_USERNAME` (ver sección de variables ausentes) no está definida. |
| `SMTP_PASS` | Backend | Condicional | — | Password SMTP. Solo se agrega bloque `auth` al transporter si **tanto** usuario como password están presentes. |

## Certificado de firma (PFX/P12)

| Variable | Aplica a | Obligatoria | Valor por defecto | Descripción e impacto |
|---|---|---|---|---|
| `PFX_BASE64` | Backend | Sí (para firma con certificado) | — | Comentario original: *"Base64 encoded PFX or p12 document signing certificate file"*. Su consumo concreto está en el código de `cloud/` (flujo de firma con `@signpdf/*`), fuera de los archivos verificados para este documento (`index.js`, `Utils.js`, `utils/*.js`, `auth/*.js`). |
| `PASS_PHRASE` | Backend | Sí (si `PFX_BASE64` está seteado) | — | Passphrase del certificado anterior. |

## Variables usadas en código pero ausentes de `.env.example`

Estas variables se leen directamente vía `process.env` en el backend (o, en un caso, en el frontend) pero **no aparecen documentadas en `.env.example`**. Cada una fue confirmada leyendo el código fuente real, no asumida.

### Backend — del hallazgo original

| Variable | Archivo | Comportamiento verificado |
|---|---|---|
| `ACCOUNT_LOCKOUT_DURATION_MINUTES` | `index.js:111` | `Number(...) \|\| 5`. Minutos de bloqueo de cuenta tras superar el umbral de intentos fallidos (config nativa de Parse Server `accountLockout.duration`). |
| `ACCOUNT_LOCKOUT_THRESHOLD` | `index.js:112` | `Number(...) \|\| 5`. Cantidad de intentos fallidos antes de bloquear la cuenta (`accountLockout.threshold`). |
| `MASTER_KEY_IPS` | `index.js:106-110` | Lista de IPs (separadas por coma, trimeadas, vacíos filtrados) autorizadas a usar el master key. **Default confirmado si no está seteada: `['127.0.0.1', '::1']`** — es decir, fuera de esas IPs el master key queda inutilizable aunque el valor sea correcto. |
| `TRUST_PROXY_HOPS` | `index.js:114,186-193` | `Number(...) \|\| 0`. Configura `app.set('trust proxy', N)` de Express. Si es `0` (default), se hace `app.set('trust proxy', false)` y el propio código emite un `console.warn` explícito advirtiendo que, si el servidor corre detrás de un reverse proxy/load balancer en producción, el rate limiter de auth no podrá aislar atacantes de usuarios legítimos por IP real. |
| `SESSION_LENGTH_SECONDS` | `index.js:113` | `Number(...) \|\| 60*60*24*30` (30 días). Duración de sesión de Parse Server (`sessionLength`). |
| `DATABASE_URI` | `index.js:116-117` | **Tiene prioridad sobre `MONGODB_URI`**: `process.env.DATABASE_URI \|\| process.env.MONGODB_URI \|\| 'mongodb://localhost:27017/dev'`. Si ambas están seteadas con valores distintos, `DATABASE_URI` gana y `MONGODB_URI` se ignora silenciosamente — riesgo real de confusión en despliegues donde solo se documenta/configura `MONGODB_URI`. |
| `GOOGLE_CLIENT_ID` | `index.js:177` | Pasada como `auth.google.clientId` a Parse Server, para validar tokens de login social de Google en el backend. |
| `PORT` | `index.js:262` (y `Utils.js:20` como fallback de `SERVER_URL`) | `process.env.PORT \|\| 8080`. Puerto HTTP del backend. |
| `SSO_API_URL` | `auth/authadapter.js:4,9` | Base URL del proveedor SSO propio. El adapter custom de Parse (`SSOAuth.validateAuthData`) hace `GET {SSO_API_URL}/oauth/userinfo` con el `access_token` del usuario para validar el login SSO. |
| `TESTING` | `index.js:242,261` | Cualquier valor truthy desactiva el montaje de Parse Server y el `httpServer.listen(...)`, usado por la suite Jasmine (`TESTING=true jasmine`). |

### Backend — hallazgos adicionales (no listados en el issue original, confirmados durante esta revisión)

| Variable | Archivo | Comportamiento verificado |
|---|---|---|
| `CORS_ALLOWED_ORIGINS` | `utils/corsOptions.js` | Lista de orígenes permitidos separados por coma. **Si no está seteada, la lista queda vacía y se rechazan todas las requests cross-origin** (`callback(null, false)` para cualquier origen no vacío que no esté en la lista). El código emite un `console.warn` una sola vez advirtiendo que hay que setearla en producción. Esta es una variable **crítica para que el frontend pueda hablar con el backend en producción** y no aparece en absoluto en `.env.example`. |
| `SMTP_USERNAME` | `index.js:75,80` | Usuario de autenticación SMTP alternativo/explícito. Si está seteado, se usa en lugar de `SMTP_USER_EMAIL` como `auth.user` del transporter Nodemailer. |

### Frontend

| Variable | Archivo | Comportamiento verificado |
|---|---|---|
| `REACT_APP_GOOGLECLIENTID` | `apps/OpenSign/src/constant/appinfo.js:19-21` | Client ID de Google OAuth para el botón de login social en el frontend (`appInfo.googleClientId`). Sin ella, el valor queda en cadena vacía `''`. No está documentada en `.env.example` pese a que su contraparte de backend (`GOOGLE_CLIENT_ID`, ver arriba) sí es una variable "conocida" del proyecto. |

### Frontend — variables de infraestructura del servidor de producción

`apps/OpenSign/server.cjs` (el servidor estático que sirve el build de producción, invocado por `npm start`) lee además:

| Variable | Comportamiento verificado |
|---|---|
| `PORT` | `Number(process.env.PORT) \|\| 3000`. Puerto donde escucha el servidor estático de producción del frontend. |
| `HOST` | `process.env.HOST \|\| "0.0.0.0"`. Interfaz de red donde escucha. |

Ninguna de las dos aparece en `.env.example` ni en `.env.local_dev`.

## Ver también

- [../README.md](../README.md)
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
- [./internationalization.md](./internationalization.md)
- [./frontend-architecture.md](./frontend-architecture.md)
