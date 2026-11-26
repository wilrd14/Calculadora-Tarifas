import { lazy, Suspense, useEffect, useLayoutEffect, useState } from "react";
import { FormField, SectionHeading, inputClassName } from "../components/FormField";
import { draftTitle, formatDraftTime, useDrafts } from "../features/drafts/useDrafts";
import { BackupSection } from "../features/settings/BackupSection";
import { QuoteForm } from "../features/quote/QuoteForm";
import type { QuoteFormValues } from "../features/quote/schema";

const HistoryList = lazy(() =>
  import("../features/history/HistoryList").then(({ HistoryList }) => ({ default: HistoryList })),
);
const SettingsPage = lazy(() =>
  import("../features/settings/SettingsPage").then(({ SettingsPage }) => ({ default: SettingsPage })),
);
const ClientsPage = lazy(() =>
  import("../features/clients/ClientsPage").then(({ ClientsPage }) => ({ default: ClientsPage })),
);

const tabs = {
  quote: "Nueva cotización",
  history: "Historial",
  clients: "Clientes",
  settings: "Configuración",
} as const;

type Tab = keyof typeof tabs;
type Theme = "light" | "dark";

const themeStorageKey = "calculadora-tarifas.theme";
const restoreNoticeKey = "calculadora-tarifas.restore-notice";

function readTheme(): Theme {
  try {
    return localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState(() => {
    try { return sessionStorage.getItem(restoreNoticeKey) ?? ""; }
    catch { return ""; }
  });
  const [tab, setTab] = useState<Tab>("quote");
  const { drafts, activeId, setActiveId, loadState, skipped, reload, create, discard, keep, schedule, flush } = useDrafts();
  const [visitedDraftIds, setVisitedDraftIds] = useState<string[]>([]);
  const activeDraft = drafts.find(({ id }) => id === activeId);
  const recoverableDrafts = drafts
    .filter(({ savedAt, status }) => savedAt || status !== "idle")
    .sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));


  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (activeId) {
      setVisitedDraftIds((current) => current.includes(activeId) ? current : [...current, activeId]);
    }
  }, [activeId]);

  function changeTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    try {
      localStorage.setItem(themeStorageKey, nextTheme);
    } catch {
      // The selected theme still applies to the current session.
    }
  }

  function finishRestore(result: { precaution_path: string; theme: Theme }) {
    changeTheme(result.theme);
    try { sessionStorage.setItem(restoreNoticeKey, result.precaution_path); } catch { /* Storage is optional. */ }
    window.location.reload();
  }

  function handleHistoryDraft(values: QuoteFormValues) {
    create(values);
    setTab("quote");
  }

  function openDraft(id: string) {
    setActiveId(id);
    setTab("quote");
  }

  function discardActiveDraft() {
    if (activeDraft && window.confirm("¿Descartar este borrador? Sus cambios se eliminarán.")) {
      discard(activeDraft.id);
    }
  }

  const draftLoadNotice = loadState === "loading" ? (
    <p role="status" className="text-sm text-text-soft">Cargando borradores…</p>
  ) : loadState === "error" ? (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-well p-3">
      <p role="alert" className="text-sm text-danger">
        No se pudieron cargar los borradores. Puedes seguir editando en esta sesión. Reintenta para recuperar el guardado automático.
      </p>
      <button type="button" className="secondary-action" onClick={reload}>Reintentar</button>
    </div>
  ) : skipped > 0 ? (
    <p role="alert" className="text-sm text-danger">Algunos borradores guardados no se pudieron recuperar.</p>
  ) : null;

  return (
    <div className="app-shell">
      <header className="app-brand">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">
          <rect x="4.5" y="3" width="15" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 8h8m-8 5h2m4 0h2m-8 4h2m4 0h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span>Cotizo</span>
      </header>
      <nav className="app-nav" aria-label="Secciones">
        {(Object.keys(tabs) as Tab[]).map((id) => (
          <button key={id} type="button" aria-current={tab === id ? "page" : undefined} disabled={backupBusy} onClick={() => setTab(id)}>
            {tabs[id]}
          </button>
        ))}
      </nav>
      <main className="app-sheet" id="main-content">
        <h1 className="page-title">{tabs[tab]}</h1>
        {restoreNotice && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <p role="status" className="text-success wrap-anywhere">Respaldo restaurado. Copia previa: {restoreNotice}</p>
            <button type="button" className="secondary-action" onClick={() => {
              setRestoreNotice("");
              try { sessionStorage.removeItem(restoreNoticeKey); } catch { /* Storage is optional. */ }
            }}>Cerrar aviso</button>
          </div>
        )}
        {tab === "quote" && (
          <>
            {draftLoadNotice}
            {activeDraft && (drafts.length > 1 || recoverableDrafts.length > 0) && (
              <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
                {drafts.length > 1 && (
                  <FormField label="Borrador" htmlFor="activeDraft" className="min-w-0 max-w-full">
                    <select
                      id="activeDraft"
                      className={inputClassName}
                      value={activeId}
                      onChange={(event) => setActiveId(event.target.value)}
                    >
                      {drafts.map((draft) => (
                        <option key={draft.id} value={draft.id}>{draftTitle(draft)}</option>
                      ))}
                    </select>
                  </FormField>
                )}
                {recoverableDrafts.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 self-end">
                    <button type="button" className="secondary-action" onClick={() => create()}>
                      Nuevo borrador
                    </button>
                    {(activeDraft.savedAt || activeDraft.status !== "idle") && (
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={discardActiveDraft}
                        disabled={activeDraft.status === "discarding"}
                      >
                        {activeDraft.status === "discard-error" ? "Reintentar descarte" : "Descartar"}
                      </button>
                    )}
                  </div>
                )}
                <p role="status" className={`text-sm ${activeDraft.status.endsWith("error") ? "text-danger" : "text-text-soft"}`}>
                  {activeDraft.status === "pending" ? (loadState === "ready" ? "Guardando borrador…" : "Cambios en memoria") :
                    activeDraft.status === "discarding" ? "Descartando borrador…" :
                    activeDraft.status === "discard-error" ? "No se pudo descartar el borrador." :
                    activeDraft.status === "error" ? "No se pudo guardar el borrador." :
                    activeDraft.savedAt ? `Guardado · ${formatDraftTime(activeDraft.savedAt)}` : null}
                </p>
                {activeDraft.status === "discard-error" && (
                  <button type="button" className="secondary-action" onClick={() => keep(activeDraft.id)}>Conservar borrador</button>
                )}
                {activeDraft.status === "error" && (
                  <button type="button" className="secondary-action" onClick={() => void flush()}>Reintentar</button>
                )}
              </div>
            )}
          </>
        )}
        {drafts.filter(({ id }) => id === activeId || visitedDraftIds.includes(id)).map(({ id, initialValues, status }) => (
          <div key={id} hidden={tab !== "quote" || activeId !== id} inert={status === "discarding" || status === "discard-error"}>
            <QuoteForm
              initialValues={initialValues}
              active={tab === "quote" && activeId === id}
              onDraftChange={(values) => schedule(id, values)}
            />
          </div>
        ))}
        {tab === "history" && (draftLoadNotice || recoverableDrafts.length > 0) && (
          <section aria-labelledby="stored-drafts-heading" className="mb-7 space-y-3">
            <h2 id="stored-drafts-heading" className="text-base font-semibold">Borradores</h2>
            {draftLoadNotice}
            {recoverableDrafts.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {recoverableDrafts.map((draft) => (
                  <li key={draft.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 [overflow-wrap:anywhere]">
                      <p className="font-medium">{draftTitle(draft)}</p>
                      {draft.projectName.trim() && draft.clientName.trim() && (
                        <p className="text-sm text-text-soft">{draft.clientName.trim()}</p>
                      )}
                      {draft.savedAt && (
                        <p className="text-xs text-text-soft">Guardado · {formatDraftTime(draft.savedAt)}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="secondary-action"
                      aria-label={`Abrir borrador ${draftTitle(draft)}`}
                      onClick={() => openDraft(draft.id)}
                      disabled={draft.status === "discarding"}
                    >
                      Abrir borrador
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {tab === "settings" && (
          <section className="mb-7 grid max-w-5xl items-start gap-3 border-b border-border pb-7 lg:grid-cols-[minmax(10rem,1fr)_minmax(0,2fr)] lg:gap-6">
            <SectionHeading>Apariencia</SectionHeading>
            <div className="rounded-lg border border-border bg-well p-4">
              <FormField label="Tema" htmlFor="app-theme">
                <select
                  id="app-theme"
                  className={inputClassName}
                  value={theme}
                  disabled={backupBusy}
                  onChange={(event) => changeTheme(event.target.value === "dark" ? "dark" : "light")}
                >
                  <option value="light">Claro</option>
                  <option value="dark">Oscuro</option>
                </select>
              </FormField>
            </div>
          </section>
        )}
        <Suspense fallback={<p role="status" className="text-sm text-text-soft">Cargando {tabs[tab].toLowerCase()}…</p>}>
          {tab === "history" && <HistoryList onCreateDraft={handleHistoryDraft} />}
          {tab === "clients" && <ClientsPage />}
          {tab === "settings" && <div inert={backupBusy}><SettingsPage /></div>}
        </Suspense>
        {tab === "settings" && (
          <BackupSection theme={theme} flushDrafts={flush} onBusy={setBackupBusy} onRestored={finishRestore} />
        )}
      </main>
    </div>
  );
}
