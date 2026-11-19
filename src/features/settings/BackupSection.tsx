import { useId, useState, type ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SectionHeading, inputClassName } from "../../components/FormField";

type Theme = "light" | "dark";

interface BackupSummary {
  quotes: number;
  clients: number;
  drafts: number;
  templates: number;
  pdfs: number;
}

interface BackupProps {
  theme: Theme;
  flushDrafts: () => Promise<boolean>;
  onBusy: (busy: boolean) => void;
  onRestored: (result: { precaution_path: string; theme: Theme }) => void;
}

const sizeLimit = 64 * 1024 * 1024;

export function BackupSection({ theme, flushDrafts, onBusy, onRestored }: BackupProps) {
  const id = useId();
  const [task, setTask] = useState<"export" | "inspect" | "restore" | null>(null);
  const [incoming, setIncoming] = useState<{ content: string; name: string; summary: BackupSummary }>();
  const [status, setStatus] = useState<{ text: string; error?: boolean }>();

  async function createBackup() {
    setTask("export");
    onBusy(true);
    setStatus(undefined);
    try {
      if (!await flushDrafts()) throw new Error("Hay borradores pendientes. Guarda los cambios antes de crear el respaldo.");
      const path = await invoke<string>("export_backup", { theme });
      setStatus({ text: `Respaldo guardado en ${path}` });
    } catch (error) {
      setStatus({ text: String(error), error: true });
    } finally {
      onBusy(false);
      setTask(null);
    }
  }

  async function inspect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setIncoming(undefined);
    setTask("inspect");
    setStatus(undefined);
    try {
      if (file.size > sizeLimit) throw new Error("El respaldo supera el límite de 64 MB.");
      const content = await file.text();
      const summary = await invoke<BackupSummary>("inspect_backup", { content });
      setIncoming({ content, name: file.name, summary });
    } catch (error) {
      setStatus({ text: String(error), error: true });
    } finally {
      setTask(null);
    }
  }

  async function restore() {
    if (!incoming) return;
    setTask("restore");
    onBusy(true);
    setStatus(undefined);
    try {
      if (!await flushDrafts()) throw new Error("Hay borradores pendientes. Guarda los cambios antes de restaurar.");
      const result = await invoke<{ precaution_path: string; theme: Theme }>("restore_backup", {
        content: incoming.content,
        currentTheme: theme,
      });
      onRestored(result);
    } catch (error) {
      setStatus({ text: String(error), error: true });
    } finally {
      onBusy(false);
      setTask(null);
    }
  }

  return (
    <section className="mt-7 max-w-5xl space-y-3 border-t border-border pt-6">
      <SectionHeading>Respaldo y restauración</SectionHeading>
      <p className="text-sm text-text-soft">
        El respaldo reúne tus cotizaciones y sus PDF disponibles, clientes, borradores, plantillas y configuración.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <button type="button" className="secondary-action" disabled={Boolean(task)} onClick={() => void createBackup()}>
          {task === "export" ? "Creando respaldo…" : "Crear respaldo"}
        </button>
        <div className="min-w-0">
          <label htmlFor={id} className="mb-1 block text-sm font-medium">Elegir archivo para restaurar</label>
          <input id={id} className={inputClassName} type="file" accept=".json,application/json" disabled={Boolean(task)}
            onChange={(event) => void inspect(event)} />
        </div>
      </div>
      {task === "inspect" && <p role="status">Revisando el respaldo…</p>}
      {incoming && (
        <div className="space-y-2 rounded-md border border-border bg-well p-3">
          <p className="font-semibold wrap-anywhere">{incoming.name}</p>
          <p>{incoming.summary.quotes} cotizaciones · {incoming.summary.pdfs} PDF · {incoming.summary.clients} clientes · {incoming.summary.drafts} borradores · {incoming.summary.templates} plantillas</p>
          <p className="text-sm text-text-soft">
            Restaurar reemplazará los datos de esta instalación. Antes se guardará un respaldo de los datos actuales en Documentos/Cotizaciones.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="primary-action" disabled={Boolean(task)} onClick={() => void restore()}>
              {task === "restore" ? "Restaurando…" : "Reemplazar datos y restaurar"}
            </button>
            <button type="button" className="secondary-action" disabled={Boolean(task)} onClick={() => setIncoming(undefined)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {status && <p role={status.error ? "alert" : "status"} className={`wrap-anywhere ${status.error ? "text-danger" : "text-success"}`}>{status.text}</p>}
    </section>
  );
}
