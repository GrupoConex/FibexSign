# Guía de deployment

Este documento describe cómo desplegar FibexSign con el `docker-compose.yml` de la raíz del repo (el camino soportado para levantar el stack completo: backend, frontend, MongoDB y reverse proxy con TLS), y menciona brevemente las alternativas de deploy standalone por PaaS del backend. Para el detalle completo de variables de entorno, ver [`./environment-variables.md`](./environment-variables.md).

## Prerequisitos

- **Docker** y **Docker Compose** (el `docker-compose.yml` usa la sintaxis de Compose v2, sin declaración de `version:`).
- `make` (el `Makefile` de la raíz orquesta ambos flujos de abajo). En Windows, correr los comandos equivalentes a mano si no hay `make` disponible (ver el contenido del `Makefile` más abajo).
- Un archivo `.env` en la raíz — los targets del `Makefile` lo generan copiando `.env.local_dev`, pero para un deploy real hay que reemplazar sus valores por los de producción (ver checklist más abajo).

## `make build` vs `make run`

El `Makefile` de la raíz define dos targets:

```makefile
build:
	@echo "Building with HOST_URL=${HOST_URL}"
	cp .env.local_dev .env
	cd apps/OpenSign && cp ../../.env.local_dev .env && npm install && npm run build
	HOST_URL=${HOST_URL} docker compose up --build --force-recreate

run:
	@echo "Building with HOST_URL=${HOST_URL}"
	cp .env.local_dev .env
	docker compose up -d
```

- **`make build`**: copia `.env.local_dev` a `.env` (raíz y `apps/OpenSign`), instala dependencias y buildea el frontend **nativamente** (`npm install && npm run build` dentro de `apps/OpenSign`), y luego levanta todo el stack con `docker compose up --build --force-recreate` (reconstruye las imágenes locales y fuerza recreación de contenedores). Usar cuando cambiaste código y necesitás que Compose reconstruya las imágenes desde el Dockerfile local en vez de usar las imágenes publicadas en Docker Hub.
- **`make run`**: copia `.env.local_dev` a `.env` y hace `docker compose up -d`, **sin rebuildear** nada. Usa las imágenes ya existentes (localmente cacheadas o las publicadas en Docker Hub: `opensign/opensignserver:main`, `opensign/opensign:main`). Usar para levantar/reiniciar el stack rápido cuando no cambiaste código.

Ambos targets sobreescriben `.env` con `.env.local_dev` — en un entorno de producción real conviene no usar `make build`/`make run` tal cual, sino preparar el `.env` de producción primero y correr `docker compose up -d` (o `--build` si corresponde) directamente, para no pisarlo con los valores de desarrollo.

## Servicios de `docker-compose.yml`

El archivo define 4 servicios en la red `app-network` (bridge):

| Servicio | Imagen | Puerto host → contenedor | Depende de | Notas |
|---|---|---|---|---|
| `server` | `opensign/opensignserver:main` | `8080:8080` | `mongo` | `env_file: .env`; setea `NODE_ENV=production`, `SERVER_URL` y `PUBLIC_URL` derivados de `HOST_URL` (default `https://localhost:3001`); volumen `opensign-files:/usr/src/app/files` para los documentos subidos. |
| `mongo` | `mongo:latest` | **`27018:27017`** | — | Puerto host **no estándar** (27018, no el 27017 default de Mongo); volumen `data-volume:/data/db` para persistencia. |
| `client` | `opensign/opensign:main` | `3000:3000` | `server` | `env_file: .env`; es el frontend servido. |
| `caddy` | `caddy:latest` | `3001:3001`, `80:80`, `443:443` (TCP y UDP) | — | Reverse proxy con TLS; monta `./Caddyfile`, y los volúmenes `caddy_data`/`caddy_config` para persistir certificados y estado de Caddy entre reinicios. |

Volúmenes nombrados: `data-volume` (Mongo), `web-root` (declarado pero sin uso visible en los servicios actuales), `caddy_data`, `caddy_config`, `opensign-files`.

## Qué hace el `Caddyfile`

El `Caddyfile` de la raíz es corto y define un único sitio:

```caddyfile
{$HOST_URL} {
    reverse_proxy client:3000
    handle_path /api/* {
        reverse_proxy server:8080
            rewrite * {uri}
    }
}
```

- El sitio se sirve en el dominio/host dado por la variable de entorno `HOST_URL` (Caddy hace TLS automático — obtiene y renueva el certificado solo — cuando `HOST_URL` es un dominio real; con `localhost` no emite un certificado público, sirve en local).
- Todo el tráfico entra por Caddy y se reparte en dos rutas:
  - Cualquier ruta que **no** empiece con `/api/` → proxy al contenedor `client` (frontend, puerto 3000).
  - Rutas bajo `/api/*` → `handle_path` les saca el prefijo `/api` y hace proxy al contenedor `server` (backend, puerto 8080), reescribiendo la URI resultante.
- En otras palabras: Caddy es el único punto de entrada público (puertos 80/443, más 3001 explícito) y decide, por prefijo de ruta, si la request va al frontend o al backend — el usuario nunca pega directo a los puertos 3000/8080 en un deploy con Caddy.

## Checklist de variables de entorno críticas para producción

La lista completa y su documentación viven en [`./environment-variables.md`](./environment-variables.md). Como mínimo, para un deploy productivo revisar/setear:

- `MONGODB_URI` — connection string de Mongo (en Compose, apunta a `mongo-container:27017`; en un Mongo gestionado/externo, usar esa URI).
- `MASTER_KEY` — clave maestra de Parse Server; debe rotarse respecto del valor de ejemplo en `.env.local_dev`/`.env.example`.
- `SERVER_URL` / `PUBLIC_URL` (y `HOST_URL` para Compose/Caddy) — deben apuntar al dominio público real, no a `localhost`.
- Credenciales de storage: `DO_ACCESS_KEY_ID`, `DO_SECRET_ACCESS_KEY`, `DO_SPACE`, `DO_ENDPOINT` (DigitalOcean Spaces o S3-compatible) para el almacenamiento de documentos.
- Credenciales de email: o bien `MAILGUN_API_KEY`/`MAILGUN_DOMAIN`/`MAILGUN_SENDER`, o bien la config SMTP (`SMTP_ENABLE=true`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER_EMAIL`, `SMTP_PASS`) — el server no inicializa el envío de mail si falta alguna de las variables requeridas por el modo elegido.
- `PFX_BASE64` (y su passphrase asociada) — certificado de firma de documentos en base64; sin esto no funciona la firma digital de PDFs.

Todos estos valores están presentes como placeholders en `.env.example`/`.env.local_dev` (raíz) — nunca deployar con esos valores de ejemplo tal cual.

## Deploy standalone del backend por PaaS (alternativa a Docker Compose)

Para desplegar **solo** `apps/OpenSignServer` en un PaaS de un solo servicio (sin el resto del stack — sin `client` ni `caddy` gestionados por Compose), el backend trae manifiestos listos:

- `apps/OpenSignServer/app.json` — manifiesto estilo Heroku (define env vars como `PARSE_MOUNT`, `APP_ID`, `MASTER_KEY`, `SERVER_URL`, y el addon `mongolab` para Mongo gestionado).
- `apps/OpenSignServer/openshift.json` — manifiesto para OpenShift.
- `apps/OpenSignServer/scalingo.json` — manifiesto para Scalingo.

Estas opciones son para correr el backend de forma aislada en esas plataformas; no reemplazan al `docker-compose.yml` cuando se necesita el stack completo (frontend + proxy TLS + Mongo) en un solo host.

## Troubleshooting básico

- **Puerto de Mongo no estándar (27018)**: `docker-compose.yml` mapea `27018:27017`, es decir, Mongo escucha en `27017` **dentro** del contenedor pero se publica en `27018` del host. Si en vez de Docker corrés un `mongod` nativo en el host para desarrollo/debug, tenés que usar `mongodb://localhost:27018/...` para conectarte al Mongo del stack (o `27017` si estás apuntando a un `mongod` nativo separado) — mezclar ambos puertos es la causa más probable de un "no se puede conectar a Mongo" al mezclar Compose con un Mongo local.
- **`client` o `caddy` no arrancan / dependencias de orden**: `docker-compose.yml` declara `depends_on` (server → mongo, client → server) pero eso solo espera a que el contenedor exista, no a que el proceso adentro esté realmente listo; si `server` tarda en levantar (por ejemplo, esperando a Mongo), `client`/`caddy` pueden arrancar antes de que la API responda — un reinicio del servicio dependiente (`docker compose restart client`) suele bastar en desarrollo.
- **Certificado TLS no se emite**: si `HOST_URL` apunta a `localhost` o a una IP, Caddy no puede emitir un certificado público válido vía ACME; para TLS real, `HOST_URL` debe ser un dominio con DNS público apuntando al host, con los puertos 80/443 accesibles desde internet.
- **`.env` pisado accidentalmente**: tanto `make build` como `make run` copian `.env.local_dev` sobre `.env` en cada corrida; si editaste `.env` a mano para producción y volvés a correr `make build`/`make run`, perdés esos cambios. Preparar un `.env` de producción aparte y no usar esos targets del `Makefile` para reaplicarlo, o ajustar el `Makefile` antes de reutilizarlo en ese flujo.

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
- [./email-builder.md](./email-builder.md)
- [./opensign-drive.md](./opensign-drive.md)
- [./reports.md](./reports.md)
- [./internationalization.md](./internationalization.md)
- [./frontend-architecture.md](./frontend-architecture.md)
