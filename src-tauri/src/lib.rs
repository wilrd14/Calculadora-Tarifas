use sqlx::{
    migrate::{Migrate, Migration as SqlxMigration, Migrator},
    sqlite::SqliteConnectOptions,
    Connection, SqliteConnection,
};
use std::borrow::Cow;
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

// SHA-384 of the settings migration in existing installations.
const LEGACY_SETTINGS_CHECKSUM: [u8; 48] = [
    0xfb, 0x05, 0x62, 0xa9, 0x7f, 0x40, 0x88, 0x32, 0x12, 0x40, 0xdf, 0xff, 0x04, 0xcc, 0xd6, 0x88,
    0xa8, 0xd0, 0x8d, 0xd9, 0x84, 0x1e, 0xa7, 0x2e, 0xb5, 0xd5, 0x92, 0x45, 0x5c, 0xd7, 0x89, 0x3e,
    0x34, 0xcf, 0xb2, 0xd7, 0x71, 0xcf, 0x41, 0xbc, 0x9c, 0xa3, 0x23, 0x77, 0xce, 0xd6, 0xd5, 0x38,
];

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn database_migrations() -> Vec<SqlxMigration> {
    [
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
    ]
    .into_iter()
    .map(|migration| {
        SqlxMigration::new(
            migration.version,
            migration.description.into(),
            migration.kind.into(),
            migration.sql.into(),
            false,
        )
    })
    .collect()
}

fn database_migrator(migrations: Vec<SqlxMigration>) -> Migrator {
    Migrator {
        migrations: Cow::Owned(migrations),
        ..Migrator::DEFAULT
    }
}

async fn migrate_database(conn: &mut SqliteConnection) -> Result<(), sqlx::migrate::MigrateError> {
    conn.ensure_migrations_table().await?;
    let applied_checksum: Option<Vec<u8>> =
        sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version = 2")
            .fetch_optional(&mut *conn)
            .await?;
    let mut migrations = database_migrations();
    if applied_checksum.as_deref() == Some(LEGACY_SETTINGS_CHECKSUM.as_slice()) {
        // SQLx must validate the original checksum for databases that already applied v2.
        // New installations execute the empty seed and store its own checksum.
        let settings = migrations
            .iter_mut()
            .find(|migration| migration.version == 2)
            .expect("settings migration exists");
        settings.checksum = Cow::Borrowed(&LEGACY_SETTINGS_CHECKSUM);
    }
    database_migrator(migrations).run_direct(conn).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            tauri::async_runtime::block_on(async {
                let mut conn = SqliteConnection::connect_with(
                    &SqliteConnectOptions::new()
                        .filename(config_dir.join("cotizaciones.db"))
                        .create_if_missing(true),
                )
                .await?;
                migrate_database(&mut conn).await?;
                Ok::<(), Box<dyn std::error::Error>>(())
            })
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod migration_tests {
    use super::*;

    #[test]
    fn fresh_database_has_no_seeded_profile_or_records() {
        tauri::async_runtime::block_on(async {
            let mut conn = SqliteConnection::connect("sqlite::memory:").await.unwrap();
            migrate_database(&mut conn).await.unwrap();
            migrate_database(&mut conn).await.unwrap();

            let fields: [String; 6] = {
                let (name, tagline, email, phone, portfolio, handle) = sqlx::query_as(
                    "SELECT freelancer_name, freelancer_tagline, freelancer_email,
                                freelancer_phone, freelancer_portfolio, freelancer_handle
                         FROM settings WHERE id = 'default'",
                )
                .fetch_one(&mut conn)
                .await
                .unwrap();
                [name, tagline, email, phone, portfolio, handle]
            };
            assert!(fields.iter().all(String::is_empty));

            for table in ["clients", "quotes"] {
                let rows: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                    .fetch_one(&mut conn)
                    .await
                    .unwrap();
                assert_eq!(rows, 0, "{table}");
            }
        });
    }

    #[test]
    fn legacy_database_keeps_user_data_and_checksum() {
        tauri::async_runtime::block_on(async {
            let mut conn = SqliteConnection::connect("sqlite::memory:").await.unwrap();
            let mut legacy_migrations = database_migrations();
            legacy_migrations.retain(|migration| (1..=5).contains(&migration.version));
            legacy_migrations[1].checksum = Cow::Borrowed(&LEGACY_SETTINGS_CHECKSUM);
            database_migrator(legacy_migrations)
                .run_direct(&mut conn)
                .await
                .unwrap();
            sqlx::raw_sql(
                "UPDATE settings SET freelancer_name = 'Perfil existente', hourly_rate = 42;
                 INSERT INTO clients (id, name, created_at)
                 VALUES ('cliente-1', 'Cliente de prueba', '2026-01-01');",
            )
            .execute(&mut conn)
            .await
            .unwrap();

            migrate_database(&mut conn).await.unwrap();
            let settings: (String, f64) = sqlx::query_as(
                "SELECT freelancer_name, hourly_rate FROM settings WHERE id = 'default'",
            )
            .fetch_one(&mut conn)
            .await
            .unwrap();
            assert_eq!(settings, ("Perfil existente".into(), 42.0));

            let clients: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM clients")
                .fetch_one(&mut conn)
                .await
                .unwrap();
            assert_eq!(clients, 1);

            let checksum: Vec<u8> =
                sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version = 2")
                    .fetch_one(&mut conn)
                    .await
                    .unwrap();
            assert_eq!(checksum, LEGACY_SETTINGS_CHECKSUM);
        });
    }
}
