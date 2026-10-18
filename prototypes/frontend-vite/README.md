# Triple Firma — frontend demo

Un agente que evalúa facturas empresariales según reglas configurables. Trabaja exclusivamente con datos ficticios: no ejecuta pagos ni se conecta a bancos.

## Requisitos
- Node.js 18 o superior
- npm

## Ejecutar
```bash
npm install
npm run dev
```

## Incluye
- Dashboard con métricas calculadas desde las facturas de demo.
- Tabla de facturas, búsqueda, filtros y panel de explicación.
- Simulación de aprobación humana y rechazo.
- Reglas configurables: límite por factura, umbral de aprobación, proveedores permitidos y duplicados.
- Creación de nuevas facturas ficticias.
- Registro local de auditoría.
- Diseño responsive y navegación móvil.

## Notas para la demo
- Los datos son ficticios.
- La aprobación registra un estado local y nunca mueve dinero.
- Los cambios y el registro de auditoría viven en memoria y se pierden al recargar.
- El presupuesto del período se muestra como configuración de referencia; el prototipo no lo aplica aún como regla acumulativa.
- Para conectar el backend, acordar un contrato de API y reemplazar `evaluateInvoice` / los datos de `seedInvoices` por llamadas al servicio real.
