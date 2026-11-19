# features/settings

Configura la tarifa por hora, la moneda por defecto y los datos que aparecen en el PDF.

## Tasa USD/DOP

En **Configuración → Tarifa y moneda**, selecciona **Automática** y elige **Compra** o **Venta**.
Usa **Actualizar tasa** para consultar la referencia del Banco Central y **Guardar configuración** para
usar esa modalidad en las cotizaciones. La variación compara las dos publicaciones más recientes
disponibles para el lado elegido.

La consulta usa [Divisa.do](https://divisa.do), que ofrece acceso anónimo durante su transición a
claves. Para configurar una clave, genera una en [Mi consola de Divisa.do](https://divisa.do/developers/console),
agrega `DIVISA_API_KEY` en las **variables de entorno de usuario** de Windows y reinicia la app.
La clave la lee el proceso nativo de Tauri.

La app conserva localmente la última publicación válida. La fecha que muestra corresponde a la
publicación de origen. Si todavía no hay una tasa guardada para la modalidad elegida, usa la tasa manual.
