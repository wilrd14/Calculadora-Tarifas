import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { QuoteFormInput } from "../quote/schema";
import { listDrafts, removeDraft, serializeDraft, writeDraft } from "./db";

interface Draft {
  id: string;
  initialValues?: QuoteFormInput;
  projectName: string;
  clientName: string;
  savedAt: string | null;
  status: "idle" | "pending" | "error" | "discarding" | "discard-error";
}

type SaveOperation = { kind: "save"; payload: string };
type PendingOperation = SaveOperation | { kind: "discard"; previousSave?: SaveOperation };

type LoadState = "loading" | "ready" | "error";

const saveDelayMs = 350;

function createDraftEntry(initialValues?: QuoteFormInput): Draft {
  return {
    id: crypto.randomUUID(),
    initialValues,
    projectName: initialValues?.projectName ?? "",
    clientName: initialValues?.clientName ?? "",
    savedAt: null,
    status: "idle",
  };
}

export function useDrafts() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeId, setActiveId] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef(new Map<string, PendingOperation>());
  const savedPayloads = useRef(new Map<string, string>());
  const discardedIds = useRef(new Set<string>());
  const invalidDrafts = useRef(new Set<string>());
  const flushTask = useRef<Promise<boolean> | null>(null);
  const closing = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const records = isTauri() ? listDrafts() : Promise.resolve({ records: [], skipped: 0 });
    void records
      .then(({ records, skipped: skippedRecords }) => {
        if (cancelled) return;
        const restored = records.map(({ id, values, savedAt }): Draft => {
          const payload = serializeDraft(values);
          if (payload && !savedPayloads.current.has(id)) savedPayloads.current.set(id, payload);
          return {
            id,
            initialValues: values,
            projectName: values.projectName,
            clientName: values.clientName,
            savedAt,
            status: "idle",
          };
        });
        const first = restored[0] ?? createDraftEntry();
        setDrafts((current) => {
          const merged = new Map(restored.map((draft) => [draft.id, draft]));
          // Keep mounted editors and their unsaved changes through a storage retry.
          for (const draft of current) merged.set(draft.id, draft);
          return merged.size > 0 ? [...merged.values()] : [first];
        });
        setActiveId((current) => current || first.id);
        setSkipped(skippedRecords);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("Error cargando los borradores:", error);
        setLoadState("error");
      });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  useEffect(() => {
    if (loadState === "loading" || drafts.some(({ id }) => id === activeId)) return;
    if (drafts.length > 0) {
      setActiveId(drafts[0].id);
    } else {
      const blank = createDraftEntry();
      setDrafts([blank]);
      setActiveId(blank.id);
    }
  }, [activeId, drafts, loadState]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (flushTask.current) return flushTask.current;

    async function run() {
      const failedOperations = new Set<PendingOperation>();
      for (;;) {
        const next = Array.from(pending.current.entries()).find(([, operation]) => !failedOperations.has(operation));
        if (!next) return pending.current.size === 0 && invalidDrafts.current.size === 0;

        const [id, operation] = next;
        try {
          const savedAt = new Date().toISOString();
          if (operation.kind === "save") {
            await writeDraft(id, operation.payload, savedAt);
            savedPayloads.current.set(id, operation.payload);
          } else {
            if (isTauri()) await removeDraft(id);
            discardedIds.current.add(id);
            savedPayloads.current.delete(id);
            invalidDrafts.current.delete(id);
          }

          // A newer change may have arrived while SQLite was writing.
          if (pending.current.get(id) !== operation) continue;
          pending.current.delete(id);
          if (operation.kind === "save") {
            setDrafts((current) => current.map((draft) =>
              draft.id === id
                ? {
                    ...draft,
                    savedAt,
                    status: draft.status === "discard-error" ? draft.status : invalidDrafts.current.has(id) ? "error" : "idle",
                  }
                : draft,
            ));
          } else {
            setDrafts((current) => current.filter((draft) => draft.id !== id));
          }
        } catch (error) {
          console.error("Error al guardar o descartar el borrador:", error);
          failedOperations.add(operation);
          if (pending.current.get(id) !== operation) continue;

          if (operation.kind === "discard") {
            // A failed discard must never turn into a silent retry later.
            pending.current.delete(id);
            if (operation.previousSave) {
              pending.current.set(id, operation.previousSave);
              failedOperations.add(operation.previousSave);
            }
          }

          setDrafts((current) => current.map((draft) => {
            if (draft.id !== id) return draft;
            if (operation.kind === "discard") return { ...draft, status: "discard-error" };
            return draft.status === "discard-error" ? draft : { ...draft, status: "error" };
          }));
        }
      }
    }

    flushTask.current = run().finally(() => { flushTask.current = null; });
    return flushTask.current;
  }, []);

  useEffect(() => {
    if (loadState === "ready" && pending.current.size > 0) void flush();
  }, [flush, loadState]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const registration = getCurrentWindow().onCloseRequested(async (event) => {
      if (cancelled || closing.current) {
        event.preventDefault();
        return;
      }

      closing.current = true;
      const saved = await flush();
      if (!saved && !window.confirm("Hay cambios que no se pudieron guardar. ¿Quieres cerrar la aplicación de todos modos?")) {
        event.preventDefault();
        closing.current = false;
      }
    }).catch((error: unknown) => {
      console.error("Error preparando el guardado al cerrar:", error);
    });
    return () => {
      cancelled = true;
      void registration.then((unlisten) => unlisten?.());
    };
  }, [flush]);

  const schedule = useCallback((id: string, values: QuoteFormInput) => {
    const queued = pending.current.get(id);
    if (discardedIds.current.has(id) || queued?.kind === "discard") return;
    const payload = serializeDraft(values);
    if (payload === null) {
      invalidDrafts.current.add(id);
      setDrafts((current) => current.map((draft) =>
        draft.id === id ? { ...draft, status: "error" } : draft,
      ));
      return;
    }

    invalidDrafts.current.delete(id);
    if (queued?.payload === payload) return;
    if (!queued && savedPayloads.current.get(id) === payload) {
      setDrafts((current) => current.map((draft) =>
        draft.id === id && draft.status === "error" ? { ...draft, status: "idle" } : draft,
      ));
      return;
    }

    const persistent = isTauri();
    setDrafts((current) => current.map((draft) => draft.id === id
      ? { ...draft, projectName: values.projectName, clientName: values.clientName, status: persistent ? "pending" : "idle" }
      : draft,
    ));
    if (persistent) {
      pending.current.set(id, { kind: "save", payload });
      if (loadState === "ready") {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => { void flush(); }, saveDelayMs);
      }
    }
  }, [flush, loadState]);

  function create(initialValues?: QuoteFormInput) {
    const draft = createDraftEntry(initialValues);
    setDrafts((current) => [
      ...current.filter(({ id, savedAt, initialValues: savedValues, status }) =>
        savedAt || savedValues || status !== "idle" || pending.current.has(id)),
      draft,
    ]);
    setActiveId(draft.id);
    if (initialValues) schedule(draft.id, initialValues);
  }

  function discard(id: string) {
    const draft = drafts.find((entry) => entry.id === id);
    if (!draft || draft.status === "discarding") return;

    if (loadState !== "ready" && !savedPayloads.current.has(id) && !flushTask.current) {
      pending.current.delete(id);
      invalidDrafts.current.delete(id);
      discardedIds.current.add(id);
      setDrafts((current) => current.filter((entry) => entry.id !== id));
      return;
    }

    const previousOperation = pending.current.get(id);
    const previousSave = previousOperation?.kind === "discard"
      ? previousOperation.previousSave
      : previousOperation;
    pending.current.set(id, { kind: "discard", previousSave });
    setDrafts((current) => current.map((entry) =>
      entry.id === id ? { ...entry, status: "discarding" } : entry,
    ));

    void flush();
  }

  function keep(id: string) {
    const hasPendingSave = pending.current.get(id)?.kind === "save";
    setDrafts((current) => current.map((draft) =>
      draft.id === id && draft.status === "discard-error"
        ? { ...draft, status: invalidDrafts.current.has(id) ? "error" : hasPendingSave ? "pending" : "idle" }
        : draft,
    ));
    if (hasPendingSave) void flush();
  }

  function reload() {
    setLoadState("loading");
    setLoadAttempt((attempt) => attempt + 1);
  }

  return { drafts, activeId, setActiveId, loadState, skipped, reload, create, discard, keep, schedule, flush };
}

export function draftTitle(draft: Draft): string {
  return draft.projectName.trim() || (draft.clientName.trim() ? `Borrador de ${draft.clientName.trim()}` : "Sin título");
}

const draftDateFormat = new Intl.DateTimeFormat("es-DO", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Santo_Domingo",
});

export function formatDraftTime(value: string): string {
  return draftDateFormat.format(new Date(value));
}
