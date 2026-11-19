import { z } from "zod";
import { getDb } from "../../lib/db";
import {
  additionalChargeSchema,
  PROJECT_TYPES,
  quoteFormSchema,
  quoteItemSchema,
  type QuoteFormInput,
} from "../quote/schema";

const draftNumber = z.union([z.number(), z.string()]);
const draftSchema = quoteFormSchema.extend({
  clientName: z.string(),
  projectName: z.string(),
  projectType: z.union([z.enum(PROJECT_TYPES), z.literal("")]),
  items: z.array(quoteItemSchema.extend({ name: z.string(), hours: draftNumber })),
  hourlyRate: draftNumber,
  additionalCharges: z.array(additionalChargeSchema.extend({ name: z.string(), amount: draftNumber })),
  discountPercent: draftNumber,
});

type DraftRow = { id: string; payload_json: string; updated_at: string };

export interface StoredDraft {
  id: string;
  values: QuoteFormInput;
  savedAt: string;
}

export async function listDrafts(): Promise<{ records: StoredDraft[]; skipped: number }> {
  const db = await getDb();
  const rows = await db.select<DraftRow[]>(
    "SELECT id, payload_json, updated_at FROM quote_drafts ORDER BY updated_at DESC, id ASC",
  );
  const records: StoredDraft[] = [];
  for (const { id, payload_json, updated_at } of rows) {
    try {
      const result = draftSchema.safeParse(JSON.parse(payload_json));
      if (result.success && Number.isFinite(Date.parse(updated_at))) {
        records.push({ id, values: result.data, savedAt: updated_at });
      }
    } catch (error) {
      console.error("No se pudo leer un borrador:", error);
    }
  }
  return { records, skipped: rows.length - records.length };
}

export function serializeDraft(values: QuoteFormInput): string | null {
  const result = draftSchema.safeParse(values);
  return result.success ? JSON.stringify(result.data) : null;
}

export async function writeDraft(id: string, payload: string, savedAt: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO quote_drafts (id, payload_json, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
    [id, payload, savedAt],
  );
}

export async function removeDraft(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM quote_drafts WHERE id = $1", [id]);
}
