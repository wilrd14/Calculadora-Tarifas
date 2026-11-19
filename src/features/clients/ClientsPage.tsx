import { useEffect, useState, type FormEvent } from "react";
import { FormField, inputClassName } from "../../components/FormField";
import { addClient, deleteClient, listClients, type Client } from "./db";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

/**
 * Clientes guardados: nombre + contacto, reutilizables al armar una nueva
 * cotización sin volver a escribirlos. También se guardan/actualizan solos
 * cada vez que se genera un PDF (ver `clients/db.ts`); esta pantalla es
 * para verlos, agregar uno a mano, o borrar alguno.
 */
export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    try {
      const rows = await listClients();
      setClients(rows);
      setState({ kind: "ready" });
    } catch (error) {
      console.error("Error cargando clientes:", error);
      setState({
        kind: "error",
        message: "No se pudo cargar la lista de clientes.",
      });
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setFormError("");
    setNotice("");
    try {
      await addClient(name, contact);
      setName("");
      setContact("");
      await refresh();
      setNotice("Cliente guardado.");
    } catch (error) {
      console.error("Error guardando el cliente:", error);
      setFormError("No se pudo guardar el cliente. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    setDeleteError("");
    setNotice("");
    try {
      await deleteClient(id);
      await refresh();
      setNotice("Cliente eliminado.");
    } catch (error) {
      console.error("Error eliminando el cliente:", error);
      setDeleteError("No se pudo eliminar el cliente. Intenta de nuevo.");
    } finally {
      setDeleting(null);
    }
  }

  if (state.kind === "loading") {
    return <p role="status" className="text-sm text-text-soft">Cargando clientes…</p>;
  }

  if (state.kind === "error") {
    return (
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p role="alert" className="text-sm text-danger">{state.message}</p>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface-raised"
          onClick={() => { setState({ kind: "loading" }); void refresh(); }}
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <form
        onSubmit={handleAdd}
        className="space-y-3 rounded-lg border border-border bg-surface-raised p-4"
      >
        <h2 className="font-semibold">Agregar cliente</h2>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <FormField label="Nombre o empresa" htmlFor="newClientName">
            <input
              id="newClientName"
              className={inputClassName}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>

          <FormField label="Contacto" htmlFor="newClientContact">
            <input
              id="newClientContact"
              className={inputClassName}
              placeholder="Email o teléfono"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
            />
          </FormField>

          <button
            type="submit"
            disabled={saving || deleting !== null || !name.trim()}
            className="rounded-md bg-text px-4 py-2 text-sm font-medium text-surface hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Guardando…" : "Agregar"}
          </button>
        </div>
        {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
      </form>

      <section aria-labelledby="saved-clients-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="saved-clients-heading" className="font-semibold">Clientes guardados</h2>
          <p className="text-sm text-text-soft">
            {clients.length === 1 ? "1 cliente" : `${clients.length} clientes`}
          </p>
        </div>
        {notice && <p role="status" className="text-sm text-success">{notice}</p>}
        {deleteError && <p role="alert" className="text-sm text-danger">{deleteError}</p>}
        {clients.length === 0 ? (
          <p className="rounded-lg border border-border p-4 text-sm text-text-soft">
            Los clientes que cotices aparecerán aquí. También puedes agregar uno ahora.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {clients.map((client) => (
              <li
                key={client.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
              >
                <div className="min-w-0 flex-[1_1_10rem]">
                  <p className="break-words text-sm font-semibold">{client.name}</p>
                  <p className="mt-1 break-words text-sm text-text-soft">
                    {client.contact || "Sin contacto"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Eliminar a ${client.name}`}
                  disabled={saving || deleting !== null}
                  onClick={() => handleDelete(client.id)}
                  className="rounded-md px-3 py-2 text-sm text-text-soft hover:bg-surface-raised hover:text-danger disabled:opacity-60"
                >
                  {deleting === client.id ? "Eliminando…" : "Eliminar"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
