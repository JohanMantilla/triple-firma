# Triple Firma

> El LLM **lee**, el código **decide**, la persona **autoriza**.

Agente que revisa las facturas de una empresa y decide si **pagarlas**, **frenarlas** o **escalarlas** a una persona, dentro de las reglas que la empresa define. Cada decisión queda registrada y explicada. Proyecto para el reto Blinka.

> La propuesta completa está en [docs/PROPUESTA.md](docs/PROPUESTA.md).

## Cómo funciona

1. **Lector (LLM):** extrae de la factura a quién se paga, cuánto, en qué moneda, para cuándo y la referencia, con evidencia. No ve las reglas ni los límites.
2. **Motor de reglas (código determinista):** evalúa todas las reglas y decide PAGAR, FRENAR o ESCALAR. Gana la decisión más restrictiva.
3. **Persona:** aprueba o rechaza lo escalado desde la bandeja.

Todo queda en un registro append-only con hash encadenado.

## Requisitos

- **Node.js 24 LTS** (ver `.nvmrc`). Descárgalo de https://nodejs.org (versión "LTS"). npm viene incluido.
- **Git**

Comprueba que los tienes:

```bash
node -v   # debe mostrar v24.x
npm -v
git --version
```

> **¿Tu red bloquea nodejs.org?** Descarga el instalador desde el espejo https://npmmirror.com/mirrors/node/ (carpeta `v24.x`, archivo `node-v24.x-x64.msi` en Windows). Después de instalar, **cierra y vuelve a abrir la terminal o VS Code** para que reconozca `node`.

## Puesta en marcha

**1. Clona el repo e instala las dependencias** (solo la primera vez):

```bash
git clone <url-del-repo>
cd triple-firma
npm install
```

> **¿Tu red bloquea el registro de npm?** Antes de `npm install`, usa el espejo solo en tu máquina, sin cambiar el repo:
> `npm config set registry https://registry.npmmirror.com/`

**2. Crea tu archivo de variables locales** (solo la primera vez):

```bash
# macOS / Linux / Git Bash
cp .env.example .env.local
```

```powershell
# Windows PowerShell
copy .env.example .env.local
```

Con eso ya puedes trabajar en la UI: usa datos de ejemplo (`NEXT_PUBLIC_USE_MOCK_API=true`) y no necesita secretos. `ANTHROPIC_API_KEY` solo se necesita para leer facturas con el modelo de verdad.

**Si vas a correr el backend** (la API o `npm run demo`), crea **tu propia** base de datos en Turso. Es gratis, y cada persona usa la suya porque `npm run demo` la borra y la vuelve a cargar:

1. Crea una cuenta en https://turso.tech e instala la CLI `turso` (en Windows, úsala desde WSL o crea la base en el panel web).
2. Crea la base y copia sus datos en `.env.local`:

```bash
turso auth login
turso db create triple-firma-<tu-nombre>
turso db show triple-firma-<tu-nombre> --url     # va en TURSO_DATABASE_URL
turso db tokens create triple-firma-<tu-nombre>  # va en TURSO_AUTH_TOKEN
```

> **¿Sin internet?** Pon `TURSO_DATABASE_URL=file:local.db` en `.env.local`: todo funciona igual con un archivo local (es el plan B de la presentación).

**3. Inicia la app:**

```bash
npm run dev
```

**4. Comprueba que funciona** en el navegador:

| URL                              | Qué debes ver                           |
| -------------------------------- | --------------------------------------- |
| http://localhost:3000            | La página "Triple Firma"                |
| http://localhost:3000/api/health | `{"status":"ok"}` (el backend responde) |

Para detener la app: `Ctrl + C` en la terminal.

**5. Antes de cada commit**, comprueba que todo sigue en verde (es lo mismo que corre la CI en GitHub):

```bash
npm run lint
npm run typecheck
npm test
```

**Cada vez que hagas `git pull`** y cambie `package.json`, vuelve a correr `npm install`.

## Comandos

| Comando             | Qué hace                                                |
| ------------------- | ------------------------------------------------------- |
| `npm run dev`       | Servidor de desarrollo                                  |
| `npm run lint`      | ESLint, incluida la regla de dependencias entre módulos |
| `npm run typecheck` | Revisión de tipos de TypeScript                         |
| `npm test`          | Pruebas con Vitest                                      |
| `npm run format`    | Formatea el código con Prettier                         |
| `npm run build`     | Build de producción                                     |
| `npm run demo`      | Carga el set de facturas y abre la app (ver "Demo")     |

## Demo

| Comando               | Qué hace                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run demo`        | Reinicia **tu** base de Turso, carga las reglas de Andes Labs y decide `dev/` y `adversarial/` desde la caché, sin API key ni tokens. Luego abre http://localhost:3000 |
| `npm run demo:live`   | Igual, pero si una factura no está en caché la lee con el modelo (requiere `ANTHROPIC_API_KEY`) y guarda la lectura en `data/cache/`                                   |
| `npm run demo:tamper` | Altera una entrada del registro directamente en la base, como podría hacerlo alguien con acceso a ella. El botón **Verificar integridad** la detecta                   |

Todas las facturas del set se deciden con el mismo reloj fijo (`DATASET_NOW`), así que el resultado no depende del día en que se corra.

Un archivo cuya extracción falló queda en ESCALATE para esos mismos bytes (es idempotente por hash): para reintentar hay que cambiar el archivo.

## API

| Método | Ruta                          | Para qué                                                      |
| ------ | ----------------------------- | ------------------------------------------------------------- |
| `POST` | `/api/invoices`               | Subir una factura (campo `file`: PDF, imagen, `.eml`, `.txt`) |
| `GET`  | `/api/invoices/[id]/file`     | Ver el documento original                                     |
| `GET`  | `/api/decisions?status=…`     | Listar decisiones (`PENDING_APPROVAL` = bandeja)              |
| `GET`  | `/api/decisions/[id]`         | Detalle: datos extraídos, reglas, explicación y aprobación    |
| `GET`  | `/api/config` · `PUT`         | Leer o guardar las reglas (cada cambio es una versión nueva)  |
| `POST` | `/api/approvals/[decisionId]` | Aprobar o rechazar con `{ action, approver, comment }`        |
| `GET`  | `/api/audit/verify`           | Verificar la cadena de hashes del registro                    |
| `GET`  | `/api/metrics`                | Métricas contra `data/expected.csv`                           |

## Deploy (Vercel + Turso)

La base del deploy es `triple-firma-demo` y **solo E la reinicia**. La base compartida nunca va en `.env.local`: usa un archivo aparte, `.env.demo` (ya ignorado por git).

1. Crea la base de la demo: `turso db create triple-firma-demo`, y copia su URL y un token.
2. Importa el repo en Vercel y agrega `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`. **No** agregues `ANTHROPIC_API_KEY`: la URL pública funciona desde la caché, y una factura nueva se escala por seguridad.
3. Carga la base desde tu máquina con esas variables en `.env.demo`: `npx tsx --env-file=.env.demo scripts/demo.ts`.
4. Abre la URL, aprueba una escalada, recarga y comprueba que sigue aprobada.

> **Advertencia:** el paso 3 **reinicia la base a la que apunta** `.env.demo`. Además, `PUT /api/config` y las aprobaciones no tienen autenticación: no compartas el deploy público más allá del jurado hasta protegerlas.

## Plan B sin internet

Con `TURSO_DATABASE_URL=file:local.db` en `.env.local`, `npm run demo` funciona igual con un archivo local, sin red.

## Estructura

```
src/
├── contracts/    # Esquemas Zod y tipos compartidos
├── app/          # Pantallas (frontend) y app/api/ (backend)
├── components/   # Componentes de la UI
├── lib/          # api-client.ts y datos de ejemplo
├── pipeline/     # Orquesta el flujo de una factura
├── engine/       # Motor de reglas (puro, sin I/O)
├── extraction/   # Lector con LLM y normalizador
└── store/        # Base de datos (libSQL / Turso) y registro de auditoría
data/             # Configuración de la empresa ficticia y facturas
scripts/          # Generador de facturas, evaluación y demo
tests/            # Pruebas
```

## Tecnologías

Next.js 16 · TypeScript · Node 24 LTS · Zod · libSQL / Turso · SDK de Anthropic · Tailwind CSS · Vitest · Vercel

## Para el equipo

Las reglas de código, el glosario de nombres y el formato de commits están en [CLAUDE.md](CLAUDE.md). Léelo antes de tu primer commit.

## Restricciones

- Ningún dato real de clientes ni de empresas: todo el set es ficticio.
- No se mueve dinero real ni se conecta a ninguna plataforma de pagos.
- No es detección de fraude, cumplimiento ni verificación de identidad.
