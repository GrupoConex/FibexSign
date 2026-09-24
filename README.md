# FibexSign

Plataforma de firma electrónica **self-hosted**, operada por **GrupoConex**. Es un fork de [OpenSign](https://github.com/OpenSignLabs/OpenSign) mantenido internamente; en la interfaz de usuario el producto se presenta bajo el nombre **"Firma"**, mientras que `FibexSign` es el nombre del repositorio/proyecto interno.

## Stack tecnológico

Monorepo **pnpm workspaces + Turborepo**, con dos aplicaciones:

- **`apps/OpenSign`** (paquete npm `open_sign`, frontend) — React 19 + Vite, Redux Toolkit, MUI + Radix Themes + DaisyUI + Tailwind (clases temáticas `op-*`), i18next (7 locales: `de`, `en`, `es`, `fr`, `hi`, `it`, `kr`), `pdf-lib` + `react-pdf` + `pkijs` para manejo de PDF/certificados en cliente, `parse` (Parse JS SDK) para hablar con el backend, íconos vía `lucide-react`, tests con Vitest.
- **`apps/OpenSignServer`** (paquete npm `open_sign_server`, backend, ESM) — Express 5 + Parse Server 8 sobre MongoDB, adaptadores de storage S3/DigitalOcean Spaces o filesystem local, envío de mail vía Mailgun o SMTP, firma de documentos con certificado PFX/P12 (`@signpdf/*`), tests con Jasmine + `mongodb-runner`.
- **Orquestación**: Turborepo (`turbo.json`) coordina las tareas `dev`, `build` y `lint` de ambos paquetes.
- **Infraestructura local**: Docker Compose (`server`, `mongo`, `client`, `caddy` como reverse proxy TLS).

## Requisitos de entorno

- Node.js `18`, `20` o `22` (definido en `engines` de ambos `package.json`).
- [pnpm](https://pnpm.io) `10.33.2` (fijado en `packageManager` del `package.json` raíz — usar Corepack o instalar esa versión exacta).
- Docker Desktop (o Docker Engine + Compose) para levantar MongoDB y, opcionalmente, el stack completo vía `docker compose`.

## Quick start

```bash
# 1. Clonar el repo
git clone <url-del-repo> FibexSign
cd FibexSign

# 2. Instalar dependencias de todo el monorepo
pnpm install

# 3. Configurar variables de entorno
#    Desarrollo local rápido (valores no sensibles, ya versionados):
cp .env.local_dev .env
cp .env.local_dev apps/OpenSign/.env
#    Para producción o un entorno real, seguir docs/environment-variables.md
#    en vez de reusar .env.local_dev.

# 4. Levantar frontend + backend en paralelo (vía Turborepo)
pnpm dev
```

`pnpm dev` requiere MongoDB accesible en la URI configurada (`MONGODB_URI` / `DATABASE_URI`). Para levantar Mongo con Docker sin construir las imágenes de la app, ver el target `run` del `Makefile` (`docker compose up -d`); para un build completo del stack (frontend nativo + `docker compose up --build`), ver el target `build` del `Makefile`.

## Comandos esenciales

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Corre `dev` de frontend y backend en paralelo vía Turborepo (`turbo dev --ui=tui`). |
| `pnpm dev:frontend` | Corre solo el frontend (`pnpm --filter open_sign dev`, Vite). |
| `pnpm dev:backend` | Corre solo el backend (`pnpm --filter open_sign_server dev`, `nodemon index.js`). |
| `pnpm build` | Build de producción de todos los paquetes (`turbo build`). |
| `pnpm lint` | Lint de todos los paquetes (`turbo lint`). |
| `pnpm --filter open_sign test` | Tests del frontend (Vitest). |
| `pnpm --filter open_sign_server test` | Tests del backend (`mongodb-runner start && TESTING=true jasmine`; requiere Docker/Mongo disponible). |

## Documentación

- [Variables de entorno](docs/environment-variables.md) — catálogo completo de `.env.example`/`.env.local_dev` por sección, más las variables leídas en código que faltan documentar.
- [Configuración de Turborepo](docs/turborepo-configuration.md) — `turbo.json`, `pnpm-workspace.yaml` y cómo agregar una nueva app al monorepo.
- [Autenticación y multi-tenancy](docs/authentication-and-multitenancy.md)
- [Preparación y envío de documentos](docs/document-preparation-and-sending.md)
- [Ceremonia de firma](docs/signing-ceremony.md)
- [Catálogo de Cloud Functions](docs/cloud-functions-catalog.md)
- [Rate limiting](docs/rate-limiting.md)
- [Guía de testing](docs/testing-guide.md)
- [Guía de despliegue](docs/deployment-guide.md)
- [Email Builder (plantillas de email)](docs/email-builder.md)
- [OpenSignDrive (gestor de archivos)](docs/opensign-drive.md)
- [Reportes (contactos, documentos, plantillas)](docs/reports.md)
- [Internacionalización (i18n)](docs/internationalization.md)
- [Arquitectura del frontend](docs/frontend-architecture.md)
- [Guía de QA](docs/qa-guide.md) — 59 casos de prueba manuales derivados de los docs anteriores

## Licencia y contribución

- [LICENSE](LICENSE)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
