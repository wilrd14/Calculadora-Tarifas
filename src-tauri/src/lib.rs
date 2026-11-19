mod backup;

use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
async fn fetch_exchange_rates() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "No se pudo preparar la consulta a Divisa.do.")?;
    let mut request = client
        .get(
            "https://api.divisa.do/v1/rates/history/series?currency=USD&entity=bcrd&kind=reference",
        )
        .header(reqwest::header::ACCEPT, "application/json");

    if let Some(key) = std::env::var("DIVISA_API_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty())
    {
        request = request.bearer_auth(key.trim());
    }

    let response = request
        .send()
        .await
        .map_err(|_| "No se pudo conectar con Divisa.do. Revisa tu conexión e intenta de nuevo.")?;
    match response.status().as_u16() {
        200 => response
            .json()
            .await
            .map_err(|_| "Divisa.do devolvió una respuesta que no se pudo leer.".into()),
        401 | 403 => Err(
            "Configura una clave válida en la variable DIVISA_API_KEY y reinicia la aplicación."
                .into(),
        ),
        429 => Err("Divisa.do alcanzó su límite de consultas. Intenta más tarde.".into()),
        _ => Err("Divisa.do no pudo entregar la tasa. Intenta más tarde.".into()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        // Record whether settings existed before the original migrations run.
        // Keep the SQL of applied migrations unchanged for SQLx checksums.
        Migration {
            version: 0,
            description: "record_fresh_install",
            sql: "CREATE TABLE fresh_install_marker (is_fresh INTEGER NOT NULL);
                INSERT INTO fresh_install_marker
                SELECT NOT EXISTS (
                    SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'settings'
                );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 1,
            description: "create_quotes_table",
            sql: "CREATE TABLE quotes (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                client_name TEXT NOT NULL,
                client_contact TEXT NOT NULL,
                project_name TEXT NOT NULL,
                project_type TEXT NOT NULL,
                description TEXT NOT NULL,
                hourly_rate REAL NOT NULL,
                currency TEXT NOT NULL,
                discount_percent REAL NOT NULL,
                payment_terms TEXT NOT NULL,
                estimated_delivery TEXT NOT NULL,
                items_json TEXT NOT NULL,
                additional_charges_json TEXT NOT NULL,
                total REAL NOT NULL,
                pdf_path TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Enviada'
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_settings_table",
            // Fila única ("default") — app de un solo usuario, sin cuentas.
            // Se siembra con los valores que antes estaban fijos en el
            // código (DEFAULT_HOURLY_RATE/DEFAULT_CURRENCY en
            // features/quote/schema.ts y features/settings/freelancerProfile.ts)
            // para no perder los datos que Williams ya había cargado.
            sql: "CREATE TABLE settings (
                id TEXT PRIMARY KEY,
                hourly_rate REAL NOT NULL,
                currency TEXT NOT NULL,
                freelancer_name TEXT NOT NULL,
                freelancer_tagline TEXT NOT NULL,
                freelancer_email TEXT NOT NULL,
                freelancer_phone TEXT NOT NULL,
                freelancer_portfolio TEXT NOT NULL,
                freelancer_handle TEXT NOT NULL
            );
            INSERT INTO settings (
                id, hourly_rate, currency, freelancer_name, freelancer_tagline,
                freelancer_email, freelancer_phone, freelancer_portfolio, freelancer_handle
            ) VALUES (
                'default', 25, 'USD', '', '', '', '', '', ''
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_clients_table",
            // Nombre único por cliente: cotizar de nuevo para el mismo
            // cliente actualiza su contacto en vez de duplicar la fila.
            sql: "CREATE TABLE clients (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                contact TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_complexity_multipliers_to_quotes",
            // Ids de COMPLEXITY_MULTIPLIERS marcados (Kubernetes, compliance,
            // rush, etc.), serializados como JSON igual que items_json.
            // DEFAULT '[]' para que las filas existentes no queden NULL.
            sql: "ALTER TABLE quotes ADD COLUMN complexity_multiplier_ids_json TEXT NOT NULL DEFAULT '[]';",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_exchange_rate_to_settings",
            // Cuántos DOP equivalen a 1 USD — para convertir la tarifa por
            // hora al cambiar de moneda en el formulario. Default = el
            // ejemplo que dio Williams (1470.75 DOP == 25 USD).
            sql: "ALTER TABLE settings ADD COLUMN exchange_rate_dop_per_usd REAL NOT NULL DEFAULT 58.83;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add_automatic_exchange_rates",
            sql: "ALTER TABLE settings ADD COLUMN exchange_rate_mode TEXT NOT NULL DEFAULT 'manual';
                ALTER TABLE settings ADD COLUMN exchange_rate_side TEXT NOT NULL DEFAULT 'buy';
                ALTER TABLE settings ADD COLUMN exchange_rate_cache_json TEXT;
                ALTER TABLE quotes ADD COLUMN exchange_rate_json TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "clear_profile_on_fresh_install",
            sql: "UPDATE settings SET freelancer_name = '', freelancer_tagline = '',
                freelancer_email = '', freelancer_phone = '', freelancer_portfolio = '',
                freelancer_handle = ''
                WHERE id = 'default' AND (SELECT is_fresh FROM fresh_install_marker) = 1;
                DROP TABLE fresh_install_marker;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "create_quote_drafts",
            sql: "CREATE TABLE quote_drafts (
                id TEXT PRIMARY KEY,
                payload_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "create_quote_templates",
            sql: "CREATE TABLE quote_templates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                data_json TEXT NOT NULL
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "link_quote_revisions",
            sql: "ALTER TABLE quotes ADD COLUMN revision_of TEXT REFERENCES quotes(id);",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:cotizaciones.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![fetch_exchange_rates, backup::export_backup, backup::inspect_backup, backup::restore_backup])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
