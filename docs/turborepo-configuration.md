# Configuración de Turborepo y workspaces (pnpm)

FibexSign es un monorepo **pnpm workspaces + Turborepo**. Este documento explica cómo está configurado y cómo extenderlo.

## `pnpm-workspace.yaml`

```yaml
packages:
  - 'apps/*'
```

Cualquier directorio directo bajo `apps/` que contenga un `package.json` válido (con campo `name`) se registra automáticamente como paquete del workspace. pnpm resuelve el glob al hacer `pnpm install` y al ejecutar `pnpm --filter <nombre>`.

**Nota verificada en el repo actual:** bajo `apps/` también existen los directorios `localstack/` y `mongo/`, usados como utilidades de infraestructura local (script de LocalStack y un `Dockerfile` de Mongo respectivamente). Ninguno de los dos tiene `package.json`, por lo que **pnpm los ignora silenciosamente** como paquetes del workspace — no aparecen en `pnpm -r list` ni participan de las tareas de Turborepo. Esto es relevante para la sección "cómo agregar una tercera app" más abajo: el glob `apps/*` por sí solo no es suficiente, hace falta un `package.json`.

Los dos paquetes reales del workspace hoy son:

- `apps/OpenSign` → paquete npm `open_sign` (frontend).
- `apps/OpenSignServer` → paquete npm `open_sign_server` (backend).

## `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "dev": {
      "persistent": true,
      "cache": false
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["build/**", "dist/**"]
    },
    "lint": {
      "dependsOn": ["^lint"]
    }
  }
}
```

- **`ui: "tui"`** — Turborepo renderiza su interfaz de terminal interactiva (paneles por paquete) en vez del log lineal plano.
- **Tarea `dev`**
  - `persistent: true`: le dice a Turborepo que este proceso no termina solo (es un watcher/servidor de larga duración: `vite` para el frontend, `nodemon` para el backend). Turborepo no espera a que "termine" para considerar la tarea completa, y la mantiene corriendo en su panel de la TUI.
  - `cache: false`: nunca cachea resultados de `dev` (no tendría sentido cachear un servidor persistente).
  - Se dispara con `pnpm dev` → `turbo dev --ui=tui`, que corre la tarea `dev` de **todos** los paquetes del workspace que la definan, en paralelo, respetando el grafo de dependencias entre paquetes si existiera alguno (hoy `open_sign` y `open_sign_server` no dependen entre sí en sus respectivos `package.json`, así que corren simplemente en paralelo).
- **Tarea `build`**
  - `dependsOn: ["^build"]`: el prefijo `^` es la sintaxis de Turborepo para "las dependencias de este paquete dentro del workspace, no el paquete mismo". Es decir: *antes* de correr `build` en un paquete dado, Turborepo primero debe correr (y completar con éxito) la tarea `build` de todo paquete del workspace del que ese paquete dependa (vía `dependencies`/`devDependencies` internas al monorepo). Con la topología actual (sin dependencias cruzadas entre `open_sign` y `open_sign_server`), esta regla no tiene efecto práctico hoy — pero es la que garantiza el orden correcto automáticamente el día que, por ejemplo, se extraiga un paquete compartido `apps/shared-types` del que ambos dependan.
  - `outputs: ["build/**", "dist/**"]`: le dice a Turborepo qué carpetas cachear/restaurar por paquete. `apps/OpenSign` compila a `build/` (`vite build`, ver `outDir: "build"` en `vite.config.js`); `dist/**` queda declarado de forma genérica para cubrir cualquier paquete futuro que compile ahí (`open_sign_server` no tiene paso de build — corre directo con `node index.js` — por lo que hoy no genera ni `build/` ni `dist/`).
  - Se dispara con `pnpm build` → `turbo build`.
- **Tarea `lint`**
  - `dependsOn: ["^lint"]`: mismo mecanismo que `build`, aplicado a lint — lintea primero las dependencias internas del workspace antes que el paquete dependiente. Sin dependencias cruzadas hoy, corre lint de ambos paquetes en el orden que Turborepo determine, cacheando el resultado si el código no cambió (a diferencia de `dev`, `lint` sí puede cachear porque no define `cache: false`).
  - Se dispara con `pnpm lint` → `turbo lint`.

## Cómo los scripts raíz mapean a `pnpm --filter`

El `package.json` de la raíz no tiene dependencias propias — es puramente un orquestador:

| Script raíz | Qué hace |
|---|---|
| `pnpm dev` | `turbo dev --ui=tui` — corre `dev` en **todos** los paquetes del workspace en paralelo, vía el grafo de Turborepo. |
| `pnpm dev:frontend` | `pnpm --filter open_sign dev` — bypassa Turborepo por completo y ejecuta el script `dev` **solo** del paquete `open_sign` (`apps/OpenSign`), como si hicieras `cd apps/OpenSign && pnpm dev`. |
| `pnpm dev:backend` | `pnpm --filter open_sign_server dev` — mismo mecanismo, pero apunta al paquete `open_sign_server` (`apps/OpenSignServer`). |
| `pnpm build` | `turbo build` — build de todos los paquetes con caché y orden de dependencias (`^build`). |
| `pnpm lint` | `turbo lint` — lint de todos los paquetes con caché y orden de dependencias (`^lint`). |

`pnpm --filter <nombre>` usa el campo `name` del `package.json` de cada paquete (`open_sign`, `open_sign_server`), **no** el nombre del directorio (`OpenSign`, `OpenSignServer`) — son distintos y hay que usar el del `package.json`.

## Cómo agregar una tercera app al monorepo

Pasos verificados contra el comportamiento real de pnpm + Turborepo en este repo (corrige la asunción de que "solo crear el directorio alcanza"):

1. Crear el directorio bajo `apps/` (ej. `apps/mi-nueva-app/`).
2. Agregar un `package.json` mínimo con un campo `name` único dentro del workspace (ej. `"name": "mi_nueva_app"`). **Sin este archivo, pnpm ignora el directorio** — es exactamente lo que pasa hoy con `apps/localstack` y `apps/mongo`, que no tienen `package.json` y por eso no son paquetes del workspace pese a matchear el glob `apps/*`.
3. Correr `pnpm install` desde la raíz para que pnpm registre el nuevo paquete y linkee su `node_modules`.
4. Si la nueva app define scripts `dev`, `build` y/o `lint` en su propio `package.json`, Turborepo los recoge automáticamente la próxima vez que corras `pnpm dev` / `pnpm build` / `pnpm lint` — **no hace falta tocar `turbo.json` ni `pnpm-workspace.yaml`**, porque las tareas están definidas de forma genérica por nombre de script, no por paquete explícito.
5. Si la nueva app va a depender de otro paquete del workspace (ej. un paquete de tipos compartidos), agregar esa dependencia en su `package.json` como `"mi-paquete-compartido": "workspace:*"` — recién ahí `dependsOn: ["^build"]` empieza a tener efecto real para esa app.
6. Opcional: agregar un script de conveniencia en el `package.json` raíz (ej. `"dev:mi-nueva-app": "pnpm --filter mi_nueva_app dev"`), siguiendo el mismo patrón que `dev:frontend` / `dev:backend`.

## Ver también

- [../README.md](../README.md)
- [./environment-variables.md](./environment-variables.md)
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
