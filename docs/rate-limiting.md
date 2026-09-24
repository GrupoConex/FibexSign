# Rate Limiting — FibexSign Backend (OpenSignServer)

Documenta el estado **actual** (post-PR #34, `fix(security): flexibilizar rate limiting con niveles diferenciados para navegación y autenticación`) de `apps/OpenSignServer/utils/authRateLimiter.js`, leído directamente del código en esta sesión — no se reutiliza ningún resumen previo del archivo, dado que su comportamiento cambió respecto a versiones anteriores (de un único bucket estricto a dos niveles diferenciados). Se referencian brevemente `utils/corsOptions.js` y el resto del hardening de `index.js` (`MASTER_KEY_IPS`, `TRUST_PROXY_HOPS`, `ACCOUNT_LOCKOUT_*`) únicamente donde son directamente relevantes al rate limiting.

## Dos niveles (buckets)

El middleware `buildAuthRateLimiterMiddleware()` construye **dos limitadores independientes** con `express-rate-limit`, cada uno con su propio `MemoryStore` (en memoria del proceso — no distribuido entre réplicas):

| Nivel | Variable de ventana | Variable de máximo | Default máximo | Rutas |
|---|---|---|---|---|
| **Estricto (auth)** | `AUTH_RATE_LIMIT_WINDOW_MS` (default `300000` = 5 min) | `AUTH_RATE_LIMIT_MAX` | `30` req/ventana/IP+ruta | `STRICT_AUTH_PATH_SUFFIXES` |
| **Operacional (navegación)** | mismo `AUTH_RATE_LIMIT_WINDOW_MS` | `OPERATIONAL_RATE_LIMIT_MAX` | `300` req/ventana/IP+ruta (o `AUTH_RATE_LIMIT_MAX * 10` si `OPERATIONAL_RATE_LIMIT_MAX` no está seteada y `AUTH_RATE_LIMIT_MAX` sí) | `OPERATIONAL_PATH_SUFFIXES` |

Ambos niveles comparten la misma ventana de tiempo (`windowMs`); solo difiere el máximo de requests permitidas y el store en el que se cuentan. Los defaults en `.env.example` (repo root) son:

```
AUTH_RATE_LIMIT_WINDOW_MS=300000
AUTH_RATE_LIMIT_MAX=30
OPERATIONAL_RATE_LIMIT_MAX=300
```

## Rutas cubiertas por cada bucket

Definidas por **sufijo** (`request.path.endsWith(suffix)`), no por path exacto — esto las hace robustas al prefijo de montaje de Parse Server (`PARSE_MOUNT`, típicamente `/app`), ya que p. ej. `/app/login`.endsWith(`/login`) es `true`.

**`STRICT_AUTH_PATH_SUFFIXES`** (bucket estricto, `authMax` = 30/5min por default):
- `/login`
- `/requestPasswordReset`
- `/functions/loginuser`
- `/functions/AuthLoginAsMail`
- `/functions/SendOTPMailV1`
- `/functions/addadmin`
- `/functions/usersignup`

**`OPERATIONAL_PATH_SUFFIXES`** (bucket operacional, `operationalMax` = 300/5min por default):
- `/functions/getUserDetails`
- `/functions/declinedoc`

`AUTH_RATE_LIMITED_PATH_SUFFIXES` es la unión de ambos arrays y se usa en `isAuthRateLimitedPath()` para decidir si una ruta entra al rate limiting en absoluto; `isStrictAuthPath()` decide cuál de los dos limitadores aplica. Cualquier ruta que no matchee ninguno de los dos arrays de sufijos **no pasa por rate limiting** en este middleware (`return next()` directo).

Nota de nomenclatura: `AUTH_RATE_LIMITED_PATH_SUFFIXES` es un identificador interno del módulo (no exportado); solo `STRICT_AUTH_PATH_SUFFIXES`, `OPERATIONAL_PATH_SUFFIXES`, `isAuthRateLimitedPath`, `isStrictAuthPath`, `buildAuthRateLimiterMiddleware` y `resetAuthRateLimiterStoreForTesting` son exports del archivo.

## Cálculo de la clave (key)

Ambos limitadores usan el mismo `keyGenerator`:

```js
keyGenerator: request => `${ipKeyGenerator(request.ip)}:${request.path}`
```

Es decir, la clave es **IP + path exacto de la request** (no solo IP). `ipKeyGenerator` es el helper oficial de `express-rate-limit` para normalizar IPv4/IPv6 de forma segura. Esto significa que el límite se cuenta **por combinación IP+ruta**, no de forma agregada entre rutas — un atacante que agote el límite de `/functions/loginuser` desde una IP no afecta su propio límite en `/functions/usersignup` desde la misma IP (cada sufijo de ruta lleva su propio contador dentro del mismo store/nivel).

`request.ip` depende de la configuración de `trust proxy` de Express, fijada en `index.js` vía `TRUST_PROXY_HOPS` (ver más abajo) — si no se configura correctamente detrás de un proxy/load balancer, todas las requests entrantes pueden verse como una sola IP (la del proxy), degradando el aislamiento del rate limiter entre atacante y usuarios legítimos.

## Comportamiento al exceder el límite

Al superar `max` dentro de la ventana, `express-rate-limit` responde automáticamente con:
- **Código:** `429 Too Many Requests` (default de la librería, no sobreescrito)
- **Cuerpo:** `{ error: 'Too many requests, please try again later.' }` (mismo mensaje para ambos niveles)
- **Headers:** `standardHeaders: true` (headers `RateLimit-*` estándar con el estado del límite) y `legacyHeaders: false` (sin los headers `X-RateLimit-*` legacy)

No hay bloqueo persistente ni backoff exponencial — es una ventana deslizante simple respaldada por `MemoryStore`; al expirar la ventana, el contador para esa clave se resetea.

## Testing

`resetAuthRateLimiterStoreForTesting()` limpia ambos `MemoryStore` (`authRateLimiterStore` y `operationalRateLimiterStore`) — pensado para usarse entre tests de integración que ejercitan rutas rate-limited, evitando que el estado de un test contamine el siguiente.

## Relación con el resto del hardening

El middleware se monta en `index.js` con `app.use(buildAuthRateLimiterMiddleware())`, **antes** del mount de Parse Server, y **después** de `app.use(cors(buildCorsOptions()))` (`utils/corsOptions.js` — allowlist de orígenes vía `CORS_ALLOWED_ORIGINS`, sin origen — same-origin/curl — siempre permitido). El orden importa: CORS decide si el navegador deja pasar la respuesta al frontend, el rate limiter decide si la request se procesa en absoluto; ambos son independientes entre sí (uno no reemplaza al otro).

Relevante directamente al rate limiter (no se documenta el resto del hardening de `index.js` aquí):
- **`TRUST_PROXY_HOPS`** (default `0`): controla `app.set('trust proxy', N)`. Si es `0`, Express no confía en `X-Forwarded-For` y usa la IP de conexión directa como `request.ip` — correcto solo si no hay proxy/load balancer delante. `index.js` emite un `console.warn` explícito si la variable no está seteada, advirtiendo que sin el hop count correcto "the auth rate limiter will not isolate attackers from legitimate users".
- **`MASTER_KEY_IPS`** (default `['127.0.0.1', '::1']`): restringe desde qué IPs se acepta el `X-Parse-Master-Key` en Parse Server; es un control distinto y complementario al rate limiting (uno limita volumen, el otro restringe origen del master key), pero ambos dependen de que la IP resuelta (`request.ip` / IP real del cliente) sea confiable — lo cual depende a su vez de `TRUST_PROXY_HOPS` bien configurado.
- **`ACCOUNT_LOCKOUT_DURATION_MINUTES`/`ACCOUNT_LOCKOUT_THRESHOLD`** (defaults `5`/`5`): configuran el `accountLockout` nativo de Parse Server (bloqueo de cuenta tras N intentos fallidos de login), una capa de defensa distinta y adicional al rate limiter por IP — el rate limiter limita volumen de requests hacia el endpoint de login sin importar la cuenta objetivo; el account lockout de Parse Server bloquea una cuenta específica tras fallos repetidos sin importar la IP de origen. Ambos mecanismos se combinan para mitigar credential stuffing / brute force.

## Ver también

- [../README.md](../README.md)
- [./environment-variables.md](./environment-variables.md)
- [./turborepo-configuration.md](./turborepo-configuration.md)
- [./authentication-and-multitenancy.md](./authentication-and-multitenancy.md)
- [./document-preparation-and-sending.md](./document-preparation-and-sending.md)
- [./signing-ceremony.md](./signing-ceremony.md)
- [./cloud-functions-catalog.md](./cloud-functions-catalog.md)
- [./testing-guide.md](./testing-guide.md)
- [./deployment-guide.md](./deployment-guide.md)
- [./email-builder.md](./email-builder.md)
- [./opensign-drive.md](./opensign-drive.md)
- [./reports.md](./reports.md)
- [./internationalization.md](./internationalization.md)
- [./frontend-architecture.md](./frontend-architecture.md)
