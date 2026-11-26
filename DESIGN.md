# Diseño de Cotizo

La interfaz es una hoja de trabajo para cotizar desarrollo de software. La edición y el desglose se mantienen cerca para que el usuario pueda relacionar cada ajuste con el total.

| Rol | Decisión |
| --- | --- |
| Marco y hoja | Marco azul grisáceo `#edf3f4`, hoja blanca y bordes discretos `#dce5e7`. |
| Texto y énfasis | Tinta `#172528` y petróleo `#1b6c80` para el total, el foco y la sección activa. |
| Tipografía | IBM Plex Sans local. Título de 24 px, texto de 14 px y cifras tabulares. |
| Densidad | Filas de alcance alineadas por nombre, complejidad y horas. Los importes se alinean a la derecha en los listados. |

En ventanas amplias, la navegación queda a la izquierda del área de trabajo y el resumen acompaña el desplazamiento de la cotización. En ventanas compactas, la navegación pasa arriba y el resumen queda en una barra inferior con acceso al desglose y a **Generar PDF**.

**Precio y ajustes** muestra la referencia aplicada a la cotización. Una actualización disponible durante la edición requiere **Aplicar tasa**. Los errores aparecen junto al campo correspondiente y el resultado de la exportación se anuncia en la zona de acciones.

El documento de entrega tiene su propia tipografía y composición en `src/features/pdf`.
