# Triple Firma

> El LLM **lee**, el código **decide**, la persona **autoriza**.

Agente que revisa las facturas de una empresa y decide si **pagarlas**, **frenarlas** o **escalarlas** a una persona, dentro de las reglas que la empresa define. Cada decisión queda registrada y explicada. Proyecto para el reto Blinka.

> **Estado:** esqueleto del proyecto. Los módulos se están construyendo. La propuesta completa está en [docs/PROPUESTA.md](docs/PROPUESTA.md).

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

Para empezar no hace falta llenar nada: la base de datos es un archivo local y la UI usa datos de ejemplo. `ANTHROPIC_API_KEY` solo se necesita para leer facturas con el modelo de verdad.

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
