# Triple Firma

**Agente inteligente para la gestión, validación y toma de decisiones sobre facturas empresariales.**

Triple Firma es un proyecto que busca automatizar la revisión de facturas y ayudar a las empresas a tomar decisiones de pago de forma más segura, transparente y controlada.

El sistema combina inteligencia artificial para interpretar la información de las facturas con un motor de reglas determinista que evalúa las condiciones establecidas por la empresa. Cuando una operación requiere supervisión, el sistema la deja pendiente para que una persona pueda revisarla y autorizarla.

> **La IA interpreta. El código decide. La persona autoriza.**

## El problema

Las empresas reciben facturas constantemente y deben comprobar que sean correctas antes de procesar sus pagos. Este proceso puede consumir tiempo y provocar errores cuando existen documentos duplicados, importes incorrectos, gastos fuera del presupuesto o información sospechosa.

Depender exclusivamente de una revisión manual ralentiza las operaciones. Por otro lado, permitir que un modelo de inteligencia artificial decida y ejecute pagos sin controles suficientes puede introducir riesgos financieros.

## Nuestra solución

Triple Firma propone un agente de decisiones financieras que analiza las facturas y aplica las reglas definidas por cada empresa.

El objetivo es que el equipo financiero pueda consultar qué decidió el agente, qué operaciones bloqueó, cuáles dejó pendientes de aprobación y las razones detrás de cada decisión.

## Funcionalidades principales

- **Análisis de facturas:** extracción e interpretación de la información relevante mediante inteligencia artificial.
- **Motor de reglas:** evaluación de las facturas mediante condiciones explícitas y verificables.
- **Detección de duplicados:** identificación de posibles facturas repetidas.
- **Validación financiera:** comprobación de importes, presupuestos y otros criterios configurados.
- **Control de riesgos:** identificación de inconsistencias que requieren una revisión adicional.
- **Aprobación humana:** posibilidad de dejar decisiones pendientes cuando las reglas lo requieren.
- **Trazabilidad:** explicación de las decisiones para facilitar su revisión.
- **Panel de control:** visualización del estado de las facturas y las decisiones del agente.

*El alcance efectivo de cada funcionalidad depende de su nivel de implementación e integración en la versión actual del proyecto.*

## ¿Cómo funciona?

1. **Recepción:** el sistema recibe una factura para su análisis.
2. **Extracción:** se identifican los datos relevantes, como proveedor, importe, moneda y fecha de vencimiento.
3. **Validación:** se comprueba la información extraída y se evalúan las reglas empresariales.
4. **Decisión:** el motor determina si la factura puede continuar, debe bloquearse o necesita aprobación humana.
5. **Explicación:** se registra el resultado y el motivo de la decisión.
6. **Supervisión:** el equipo responsable puede revisar las operaciones pendientes y actuar cuando corresponda.

### Flujo de decisión

```text
Factura recibida
       |
       v
Extracción de información con IA
       |
       v
Validación de datos
       |
       v
Evaluación del motor de reglas
       |
       v
Decisión del sistema
       |
       +----> Aprobada según las reglas
       |
       +----> Bloqueada por una regla
       |
       +----> Pendiente de aprobación humana
```

**Importante:** aprobar una factura dentro del flujo de decisión no significa necesariamente que el dinero haya sido transferido. La ejecución real de pagos requiere una integración específica y sus correspondientes controles de autorización.

## Arquitectura y tecnologías

Triple Firma utiliza tecnologías modernas para construir una aplicación web con lógica de negocio validable y una interfaz orientada a la toma de decisiones.

| Tecnología | Uso |
|---|---|
| Next.js | Framework de la aplicación web |
| React | Construcción de la interfaz |
| TypeScript | Tipado y mayor seguridad durante el desarrollo |
| Tailwind CSS | Estilos y diseño de la interfaz |
| Anthropic SDK | Integración con modelos de inteligencia artificial |
| Zod | Validación de datos y estructuras |
| LibSQL | Acceso a datos mediante una base de datos compatible |
| Vitest | Pruebas automatizadas |

## Estructura del proyecto

```text
triple-firma/
├── src/
│   ├── app/
│   │   ├── decisions/
│   │   ├── inbox/
│   │   ├── rules/
│   │   └── page.tsx
│   ├── components/
│   ├── contracts/
│   ├── engine/
│   │   └── rules/
│   └── extraction/
├── package.json
└── README.md
```

- `src/app/`: rutas y páginas de la aplicación.
- `src/components/`: componentes reutilizables de la interfaz.
- `src/contracts/`: contratos y estructuras de datos.
- `src/engine/`: lógica central para evaluar y tomar decisiones.
- `src/engine/rules/`: reglas que determinan el resultado de las evaluaciones.
- `src/extraction/`: lógica relacionada con la extracción de información de las facturas.

La estructura puede evolucionar a medida que se integren las distintas partes del sistema.

## Instalación y ejecución

### Requisitos previos

- Node.js en la versión 24 o superior.
- npm.
- Una clave de API de Anthropic si la funcionalidad de extracción utiliza ese proveedor.

### 1. Clonar el repositorio

```bash
git clone https://github.com/JohanMantilla/triple-firma.git
cd triple-firma
```

### 2. Instalar las dependencias

```bash
npm install
```

### 3. Configurar las variables de entorno

Crea un archivo `.env.local` en la raíz del proyecto y añade las variables que requiera la aplicación.

Por ejemplo, si el código utiliza Anthropic, podría necesitar una clave como `ANTHROPIC_API_KEY`. Confirma el nombre exacto en el archivo de ejemplo de variables de entorno o en la configuración del proyecto.

No subas claves privadas, contraseñas ni credenciales al repositorio.

### 4. Iniciar el servidor de desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

### 5. Ejecutar las pruebas

```bash
npm run test
```

### 6. Comprobar la compilación

```bash
npm run build
```

Consulta `package.json` para verificar los scripts disponibles en la versión actual.

## Principios de diseño

Triple Firma se desarrolla alrededor de cuatro principios:

- **Control:** las decisiones financieras deben respetar reglas explícitas.
- **Transparencia:** cada resultado debe tener una explicación comprensible.
- **Supervisión humana:** las operaciones que requieren autorización no deben ejecutarse automáticamente.
- **Separación de responsabilidades:** la inteligencia artificial interpreta la información, mientras que el código aplica las reglas de negocio.

## Estado del proyecto

Triple Firma está en desarrollo. El objetivo es integrar el motor de decisiones, la extracción de información y la interfaz de usuario en un flujo coherente que permita probar las decisiones sobre un conjunto de facturas.

Las funcionalidades disponibles deben verificarse en el código y en la aplicación antes de considerarlas terminadas.

## Contribuciones

Las mejoras, sugerencias y contribuciones son bienvenidas. Para colaborar:

1. Crea una rama para tu cambio.
2. Implementa y prueba la funcionalidad.
3. Verifica que la aplicación compile correctamente.
4. Envía tus cambios mediante un pull request.

## Licencia

La licencia del proyecto debe definirse explícitamente en el repositorio antes de establecer las condiciones de uso y distribución.

---

**Triple Firma — Automatización financiera con reglas claras, decisiones explicables y supervisión humana.**

- Ningún dato real de clientes ni de empresas: todo el set es ficticio.
- No se mueve dinero real ni se conecta a ninguna plataforma de pagos.
- No es detección de fraude, cumplimiento ni verificación de identidad.

## Límites conocidos

Los encontramos al auditar el motor y decidimos no cambiar las reglas antes de la demo.

- **La misma factura con una etiqueta en la referencia.** Una factura es duplicada si coinciden beneficiario, monto, moneda y referencia. La referencia ignora mayúsculas, espacios, guiones, barras y puntos ("FAC-1041" es "fac 1041"), pero no una etiqueta pegada al número: "N° FAC-1041" y "FAC-1041" no se reconocen como la misma factura, que podría pagarse otra vez. En nuestro set el Lector copia solo el número ("Factura N°: FAC-1041" → "FAC-1041"), y si sus dos lecturas no coinciden, la factura se escala.
- **Una copia con un nombre parecido.** "Acmé Corp" frente a "Acme Corp", o con una letra cirílica, no se marca como duplicado, pero se escala por nombre parecido y la decide una persona.
- **Números distintos son facturas distintas.** "FAC-41" y "FAC-1041", o "FAC-1041" y "ED_1041", no son duplicados. El mismo número con otro monto tampoco: si no coincide con lo acordado, se frena o se escala.
