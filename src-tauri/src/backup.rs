use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{sqlite::SqliteConnectOptions, Connection, Row, SqliteConnection};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const TABLES: [&str; 5] = [
    "settings",
    "clients",
    "quotes",
    "quote_drafts",
    "quote_templates",
];
const LIMIT: usize = 64 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct Backup {
    format: String,
    version: u32,
    theme: String,
    tables: BTreeMap<String, Vec<Value>>,
    pdfs: BTreeMap<String, String>,
}

#[derive(Serialize)]
pub struct BackupSummary {
    quotes: usize,
    clients: usize,
    drafts: usize,
    templates: usize,
    pdfs: usize,
}

async fn connect(app: &AppHandle) -> Result<SqliteConnection, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(message)?
        .join("cotizaciones.db");
    SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(path)
            .busy_timeout(Duration::from_secs(5)),
    )
    .await
    .map_err(message)
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn stamp() -> Result<u128, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(message)?
        .as_nanos())
}

fn output_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .document_dir()
        .map_err(message)?
        .join("Cotizaciones"))
}

async fn columns(
    conn: &mut SqliteConnection,
    table: &str,
) -> Result<Vec<(String, String, bool)>, String> {
    let columns = sqlx::query(&format!("PRAGMA table_info({table})"))
        .fetch_all(conn)
        .await
        .map_err(message)?
        .into_iter()
        .map(|column| {
            (
                column.get("name"),
                column.get("type"),
                column.get::<i64, _>("notnull") == 0 && column.get::<i64, _>("pk") == 0,
            )
        })
        .collect::<Vec<_>>();
    if columns.is_empty() {
        return Err("La base local requiere una actualización.".into());
    }
    Ok(columns)
}

async fn snapshot(
    conn: &mut SqliteConnection,
    theme: String,
    dir: &Path,
) -> Result<Backup, String> {
    let mut tx = conn.begin().await.map_err(message)?;
    let mut tables = BTreeMap::new();
    for table in TABLES {
        let fields = columns(&mut tx, table)
            .await?
            .into_iter()
            .map(|(name, _, _)| format!("'{name}', \"{name}\""))
            .collect::<Vec<_>>()
            .join(", ");
        let rows =
            sqlx::query_scalar::<_, String>(&format!("SELECT json_object({fields}) FROM {table}"))
                .fetch_all(&mut *tx)
                .await
                .map_err(message)?;
        let values = rows
            .iter()
            .map(|row| serde_json::from_str::<Value>(row))
            .collect::<Result<Vec<_>, _>>()
            .map_err(message)?;
        tables.insert(table.into(), values);
    }
    tx.commit().await.map_err(message)?;

    let mut pdfs = BTreeMap::new();
    let mut encoded_size = 0;
    if let Ok(root) = dir.canonicalize() {
        for record in &tables["quotes"] {
            let id = record["id"]
                .as_str()
                .ok_or("Identificador de cotización inválido.")?;
            let Some(path) = record["pdf_path"].as_str() else {
                continue;
            };
            let Ok(path) = Path::new(path).canonicalize() else {
                continue;
            };
            if path.parent() != Some(root.as_path())
                || !path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
            {
                continue;
            }

            let mut bytes = Vec::new();
            fs::File::open(&path)
                .map_err(message)?
                .take(LIMIT as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(message)?;
            if !bytes.starts_with(b"%PDF-") {
                continue;
            }
            encoded_size += bytes.len().div_ceil(3) * 4;
            if encoded_size > LIMIT {
                return Err("Los PDF exceden el límite de 64 MB del respaldo.".into());
            }
            pdfs.insert(id.into(), STANDARD.encode(bytes));
        }
    }
    Ok(Backup {
        format: "calculadora-tarifas".into(),
        version: 1,
        theme,
        tables,
        pdfs,
    })
}

fn save_backup(backup: &Backup, dir: &Path, prefix: &str) -> Result<String, String> {
    let data = serde_json::to_vec(backup).map_err(message)?;
    if data.len() > LIMIT {
        return Err("El respaldo excede el límite de 64 MB.".into());
    }
    fs::create_dir_all(dir).map_err(message)?;
    let path = dir.join(format!("{prefix}-{}.tarifas.json", stamp()?));
    write_new(&path, &data)?;
    Ok(path.to_string_lossy().into_owned())
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(message)?;
    if let Err(err) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(message(err));
    }
    Ok(())
}

async fn validate(
    conn: &mut SqliteConnection,
    content: &str,
) -> Result<(Backup, BackupSummary), String> {
    if content.len() > LIMIT {
        return Err("El respaldo excede el límite de 64 MB.".into());
    }
    let backup: Backup = serde_json::from_str(content)
        .map_err(|_| "El archivo no es un respaldo de Calculadora de Tarifas.".to_string())?;
    if backup.format != "calculadora-tarifas"
        || backup.version != 1
        || backup.tables.len() != TABLES.len()
        || !matches!(backup.theme.as_str(), "light" | "dark")
    {
        return Err("El formato o la versión del respaldo no es compatible.".into());
    }
    for table in TABLES {
        let rows = backup
            .tables
            .get(table)
            .ok_or("Faltan datos en el respaldo.")?;
        let fields = columns(conn, table).await?;
        for row in rows {
            let object = row
                .as_object()
                .ok_or("El respaldo contiene registros inválidos.")?;
            if object.len() != fields.len() {
                return Err("El esquema del respaldo no coincide.".into());
            }
            for (col, kind, nullable) in &fields {
                let value = object.get(col).ok_or("Faltan campos en el respaldo.")?;
                let valid = if value.is_null() {
                    *nullable
                } else {
                    match kind.as_str() {
                        "TEXT" => value.is_string(),
                        "REAL" => value.is_number(),
                        "INTEGER" => value.is_i64(),
                        _ => false,
                    }
                };
                if !valid {
                    return Err("El respaldo contiene campos inválidos.".into());
                }
                if col.ends_with("_json")
                    && !value.is_null()
                    && serde_json::from_str::<Value>(value.as_str().unwrap_or_default()).is_err()
                {
                    return Err("El respaldo contiene datos internos inválidos.".into());
                }
            }
        }
    }
    let settings = &backup.tables["settings"];
    if settings.len() != 1 || settings[0]["id"] != "default" {
        return Err("El respaldo no tiene una configuración válida.".into());
    }
    let quotes = &backup.tables["quotes"];
    let ids: std::collections::HashSet<_> =
        quotes.iter().filter_map(|row| row["id"].as_str()).collect();
    for (id, pdf) in &backup.pdfs {
        if !ids.contains(id.as_str()) || !decode_pdf(pdf)?.starts_with(b"%PDF-") {
            return Err("El respaldo contiene un PDF inválido.".into());
        }
    }
    let summary = BackupSummary {
        quotes: quotes.len(),
        clients: backup.tables["clients"].len(),
        drafts: backup.tables["quote_drafts"].len(),
        templates: backup.tables["quote_templates"].len(),
        pdfs: backup.pdfs.len(),
    };
    Ok((backup, summary))
}

fn decode_pdf(encoded: &str) -> Result<Vec<u8>, String> {
    STANDARD
        .decode(encoded)
        .map_err(|_| "El respaldo contiene un PDF inválido.".into())
}

#[tauri::command]
pub async fn export_backup(app: AppHandle, theme: String) -> Result<String, String> {
    let mut conn = connect(&app).await?;
    let dir = output_dir(&app)?;
    let backup = snapshot(&mut conn, theme, &dir).await?;
    save_backup(&backup, &dir, "Respaldo")
}

#[tauri::command]
pub async fn inspect_backup(app: AppHandle, content: String) -> Result<BackupSummary, String> {
    let mut conn = connect(&app).await?;
    Ok(validate(&mut conn, &content).await?.1)
}

#[derive(Serialize)]
pub struct RestoreResult {
    precaution_path: String,
    theme: String,
}

#[tauri::command]
pub async fn restore_backup(
    app: AppHandle,
    content: String,
    current_theme: String,
) -> Result<RestoreResult, String> {
    let mut conn = connect(&app).await?;
    let (mut backup, _) = validate(&mut conn, &content).await?;
    let dir = output_dir(&app)?;
    let current = snapshot(&mut conn, current_theme, &dir).await?;
    let precaution_path = save_backup(&current, &dir, "Antes-de-restaurar")?;
    if let Err(error) = restore_data(&mut conn, &mut backup, &dir).await {
        return Err(format!(
            "No se pudo restaurar. Respaldo previo: {precaution_path}. {error}"
        ));
    }
    Ok(RestoreResult {
        precaution_path,
        theme: backup.theme,
    })
}

async fn restore_data(
    conn: &mut SqliteConnection,
    backup: &mut Backup,
    dir: &Path,
) -> Result<(), String> {
    let mut created = Vec::new();
    let result = async {
        let suffix = stamp()?;
        for (index, row) in backup
            .tables
            .get_mut("quotes")
            .ok_or("Faltan cotizaciones.")?
            .iter_mut()
            .enumerate()
        {
            let id = row["id"]
                .as_str()
                .ok_or("Identificador de cotización inválido.")?;
            row["pdf_path"] = if let Some(encoded) = backup.pdfs.get(id) {
                let path = dir.join(format!("Restaurado-{suffix}-{index}.pdf"));
                write_new(&path, &decode_pdf(encoded)?)?;
                let path_string = path.to_string_lossy().into_owned();
                created.push(path);
                Value::String(path_string)
            } else {
                Value::String(String::new())
            };
        }
        let mut tx = conn.begin().await.map_err(message)?;
        sqlx::query("PRAGMA defer_foreign_keys = ON")
            .execute(&mut *tx)
            .await
            .map_err(message)?;
        for table in TABLES {
            sqlx::query(&format!("DELETE FROM {table}"))
                .execute(&mut *tx)
                .await
                .map_err(message)?;
        }
        for table in TABLES {
            let cols = columns(&mut tx, table).await?;
            let names = cols
                .iter()
                .map(|(name, _, _)| format!("\"{name}\""))
                .collect::<Vec<_>>()
                .join(", ");
            let extract = cols
                .iter()
                .map(|(name, _, _)| format!("json_extract(value, '$.{name}')"))
                .collect::<Vec<_>>()
                .join(", ");
            sqlx::query(&format!(
                "INSERT INTO {table} ({names}) SELECT {extract} FROM json_each(?)"
            ))
            .bind(serde_json::to_string(&backup.tables[table]).map_err(message)?)
            .execute(&mut *tx)
            .await
            .map_err(message)?;
        }
        tx.commit().await.map_err(message)
    }
    .await;
    if let Err(error) = result {
        for path in created {
            let _ = fs::remove_file(path);
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn database() -> SqliteConnection {
        let mut db = SqliteConnection::connect(":memory:").await.unwrap();
        sqlx::raw_sql(
            "CREATE TABLE settings (id TEXT PRIMARY KEY, theme_note TEXT NOT NULL);
             INSERT INTO settings VALUES ('default', 'actual');
             CREATE TABLE quotes (id TEXT PRIMARY KEY, pdf_path TEXT NOT NULL, revision_of TEXT REFERENCES quotes(id));
             CREATE TABLE clients (id TEXT PRIMARY KEY);
             CREATE TABLE quote_drafts (id TEXT PRIMARY KEY);
             CREATE TABLE quote_templates (id TEXT PRIMARY KEY);"
        ).execute(&mut db).await.unwrap();
        db
    }

    #[test]
    fn backup_roundtrip_and_rollback() {
        tauri::async_runtime::block_on(async {
            let root =
                std::env::temp_dir().join(format!("tarifas-backup-test-{}", stamp().unwrap()));
            let source_dir = root.join("source");
            let dest_dir = root.join("dest");
            fs::create_dir_all(&source_dir).unwrap();
            fs::create_dir_all(&dest_dir).unwrap();
            let source_pdf = source_dir.join("original.pdf");
            write_new(&source_pdf, b"%PDF-1.4 test fixture").unwrap();

            let mut source = database().await;
            sqlx::query("INSERT INTO quotes VALUES ('initial', ?, NULL), ('revision', 'missing.pdf', 'initial')")
                .bind(source_pdf.to_string_lossy().as_ref()).execute(&mut source).await.unwrap();
            sqlx::raw_sql("INSERT INTO clients VALUES ('c'); INSERT INTO quote_drafts VALUES ('b'); INSERT INTO quote_templates VALUES ('p');")
                .execute(&mut source).await.unwrap();
            let source_backup = snapshot(&mut source, "dark".into(), &source_dir)
                .await
                .unwrap();
            let portable = serde_json::to_string(&source_backup).unwrap();

            let mut destination = database().await;
            sqlx::query("INSERT INTO clients VALUES ('previous')")
                .execute(&mut destination)
                .await
                .unwrap();
            assert!(validate(&mut destination, "{}").await.is_err());
            let (mut imported, summary) = validate(&mut destination, &portable).await.unwrap();
            assert_eq!(
                (
                    summary.quotes,
                    summary.pdfs,
                    summary.clients,
                    summary.drafts,
                    summary.templates
                ),
                (2, 1, 1, 1, 1)
            );
            restore_data(&mut destination, &mut imported, &dest_dir)
                .await
                .unwrap();
            let path: String =
                sqlx::query_scalar("SELECT pdf_path FROM quotes WHERE id = 'initial'")
                    .fetch_one(&mut destination)
                    .await
                    .unwrap();
            assert_eq!(fs::read(&path).unwrap(), b"%PDF-1.4 test fixture");
            assert_eq!(Path::new(&path).parent(), Some(dest_dir.as_path()));
            let missing: String =
                sqlx::query_scalar("SELECT pdf_path FROM quotes WHERE id = 'revision'")
                    .fetch_one(&mut destination)
                    .await
                    .unwrap();
            assert!(missing.is_empty());

            let (mut invalid, _) = validate(&mut destination, &portable).await.unwrap();
            let clients = invalid.tables.get_mut("clients").unwrap();
            clients.push(clients[0].clone());
            assert!(restore_data(&mut destination, &mut invalid, &dest_dir)
                .await
                .is_err());
            let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM quotes ORDER BY id")
                .fetch_all(&mut destination)
                .await
                .unwrap();
            assert_eq!(ids, ["initial", "revision"]);
            assert_eq!(fs::read_dir(&dest_dir).unwrap().count(), 1);
            fs::remove_file(path).unwrap();
            fs::remove_file(source_pdf).unwrap();
            fs::remove_dir(dest_dir).unwrap();
            fs::remove_dir(source_dir).unwrap();
            fs::remove_dir(root).unwrap();
        });
    }
}
