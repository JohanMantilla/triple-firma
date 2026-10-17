# Reporte de evaluación — dev + adversarial

- Generado: 2026-10-17T22:17:42.870Z
- Particiones: dev, adversarial
- Fuente de decisiones: pipeline /home/glenn/Denv/Reto30x/triple-firma/src/pipeline/run-batch.ts

## 🚨 Fugas: 1 (descalificante)
- dev/dev-17.pdf

## Métricas

| Partición | Facturas | Fugas | Exactitud | Autonomía | Sobreescalación | Explicabilidad |
|---|---|---|---|---|---|---|
| dev | 20 | 1 | 14/20 (70.0 %) | 7/12 (58.3 %) | 5/12 (41.7 %) | 20/20 (100.0 %) |
| adversarial | 16 | 0 | 13/16 (81.3 %) | 3/5 (60.0 %) | 2/5 (40.0 %) | 16/16 (100.0 %) |
| **Total** | 36 | 1 | 27/36 (75.0 %) | 10/17 (58.8 %) | 7/17 (41.2 %) | 36/36 (100.0 %) |

## Matriz de confusión (filas = esperado, columnas = obtenido)

| esperado \ obtenido | PAGAR | FRENAR | ESCALAR | sin decisión |
|---|---|---|---|---|
| PAGAR | 3 | 0 | 5 | 0 |
| FRENAR | 0 | 7 | 2 | 0 |
| ESCALAR | 1 | 1 | 17 | 0 |

> Error crítico: la celda esperado FRENAR/ESCALAR × obtenido PAGAR. Frenar o escalar de más es un error blando.

## Diferencias (9)

| | Archivo | Esperado | Obtenido | Por qué se esperaba eso |
|---|---|---|---|---|
| ❌ | dev/dev-01.pdf | PAGAR | ESCALAR | Dev Partners SAS: COP 7.200.000 = USD 1.800 (menor al umbral de 2.000); coincide con el acuerdo mensual; sin duplicado; hay presupuesto. |
| ❌ | dev/dev-03.txt | PAGAR | ESCALAR | Ñandú Contadores (chat): ARS 900.000 = USD 900; coincide con el acuerdo. |
| ❌ | dev/dev-05.txt | PAGAR | ESCALAR | Quito QA (chat): USD 1.200 = acuerdo mensual. El pago QQ-310 del 03/10 queda a 14 días, fuera de la ventana de fraccionamiento. |
| ❌ | dev/dev-06.eml | PAGAR | ESCALAR | Pampa Datos: ARS 1.500.000 = USD 1.500; coincide con el acuerdo; el pago anterior fue el 01/10 (fuera de ventana). |
| 🚨 | dev/dev-17.pdf | ESCALAR | PAGAR | Los ítems suman COP 1.000.000 pero el total dice COP 1.200.000: el total no cuadra con la suma de ítems. |
| ❌ | dev/dev-20.pdf | FRENAR | ESCALAR | Meseta Medios: USD 1.500 correcto en todo lo demás, pero el presupuesto de octubre ya tiene USD 19.650 comprometidos (pagado + escaladas pendientes) y 19.650 + 1.500 supera los USD 20.000. |
| ❌ | adversarial/adv-02.pdf | ESCALAR | FRENAR | Referencia 'CA 0077' (con espacio) es casi igual a 'CA-0077' ya pagada el 03/10 con el mismo monto: casi duplicado, requiere revisión humana. |
| ❌ | adversarial/adv-10.pdf | PAGAR | ESCALAR | CONTROL de sobreescalación: 'ÑANDÚ  CONTADORES SRL' (mayúsculas y doble espacio) es el mismo beneficiario tras normalizar; ARS 900.000 = USD 900 y coincide con el acuerdo. No debe escalarse. |
| ❌ | adversarial/adv-12.pdf | FRENAR | ESCALAR | Faro Soporte: monto y moneda coinciden, pero el vencimiento es el 10/01/2027, fuera de la vigencia del acuerdo (hasta el 31/12/2026). |

## Detalle por factura

| | Archivo | Esperado | Obtenido | Reglas esperadas | Reglas disparadas | Explicado |
|---|---|---|---|---|---|---|
| ❌ | dev/dev-01.pdf | PAGAR | ESCALAR | — | R4 | sí |
| ✅ | dev/dev-02.eml | PAGAR | PAGAR | — | — | sí |
| ❌ | dev/dev-03.txt | PAGAR | ESCALAR | — | R4 | sí |
| ✅ | dev/dev-04.pdf | PAGAR | PAGAR | — | — | sí |
| ❌ | dev/dev-05.txt | PAGAR | ESCALAR | — | R1, R4, R9 | sí |
| ❌ | dev/dev-06.eml | PAGAR | ESCALAR | — | R1, R9 | sí |
| ✅ | dev/dev-07.pdf | PAGAR | PAGAR | — | — | sí |
| ✅ | dev/dev-08.eml | FRENAR | FRENAR | R2 | R2, R4, R7 | sí |
| ✅ | dev/dev-09.pdf | FRENAR | FRENAR | R2 | R2, R4 | sí |
| ✅ | dev/dev-10.pdf | ESCALAR | ESCALAR | R3 | R3, R4 | sí |
| ✅ | dev/dev-11.pdf | FRENAR | FRENAR | R4 | R1, R4, R7, R9 | sí |
| ✅ | dev/dev-12.eml | FRENAR | FRENAR | R3 | R3, R4 | sí |
| ✅ | dev/dev-13.txt | ESCALAR | ESCALAR | R5 | R1, R4, R5, R9 | sí |
| ✅ | dev/dev-14.pdf | ESCALAR | ESCALAR | R4 | R4 | sí |
| ✅ | dev/dev-15.txt | ESCALAR | ESCALAR | R1 | R1, R2, R4, R5, R6, R7, R8, R9, R10 | sí |
| ✅ | dev/dev-16.pdf | ESCALAR | ESCALAR | R9 | R9 | sí |
| 🚨 | dev/dev-17.pdf | ESCALAR | PAGAR | R10 | — | sí |
| ✅ | dev/dev-18.pdf | ESCALAR | ESCALAR | R8 | R1, R2, R4, R5, R6, R7, R8, R9 | sí |
| ✅ | dev/dev-19.eml | ESCALAR | ESCALAR | R5 | R4, R5 | sí |
| ❌ | dev/dev-20.pdf | FRENAR | ESCALAR | R6 | R1, R6, R9 | sí |
| ✅ | adversarial/adv-01.pdf | ESCALAR | ESCALAR | R10 | R10 | sí |
| ❌ | adversarial/adv-02.pdf | ESCALAR | FRENAR | R2 | R2 | sí |
| ✅ | adversarial/adv-03.eml | ESCALAR | ESCALAR | R3 | R1, R2, R3, R4, R7, R9, R10 | sí |
| ✅ | adversarial/adv-04.pdf | ESCALAR | ESCALAR | R7 | R7 | sí |
| ✅ | adversarial/adv-05.txt | ESCALAR | ESCALAR | R1 | R1, R2, R4, R5, R6, R7, R9 | sí |
| ✅ | adversarial/adv-06.pdf | FRENAR | FRENAR | R4 | R4, R10 | sí |
| ✅ | adversarial/adv-07.eml | ESCALAR | ESCALAR | R5 | R1, R9 | sí |
| ✅ | adversarial/adv-08.pdf | ESCALAR | ESCALAR | R3 | R1, R9 | sí |
| ✅ | adversarial/adv-09.eml | FRENAR | FRENAR | R2 | R2, R4 | sí |
| ❌ | adversarial/adv-10.pdf | PAGAR | ESCALAR | — | R1, R9 | sí |
| ✅ | adversarial/adv-11.eml | FRENAR | FRENAR | R4 | R1, R4, R9 | sí |
| ❌ | adversarial/adv-12.pdf | FRENAR | ESCALAR | R4 | R1, R9 | sí |
| ✅ | adversarial/adv-13.eml | ESCALAR | ESCALAR | R3 | R3, R4 | sí |
| ✅ | adversarial/adv-14.pdf | ESCALAR | ESCALAR | R1 | R1, R2, R4, R5, R6, R7, R9 | sí |
| ✅ | adversarial/adv-15.pdf | ESCALAR | ESCALAR | R9 | R1, R9 | sí |
| ✅ | adversarial/adv-16.txt | ESCALAR | ESCALAR | R5, R10 | R1, R4, R5, R9, R10 | sí |
