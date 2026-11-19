import { getDb } from "../../lib/db";
import { quoteFormSchema } from "../quote/schema";
import { z } from "zod";

export const templateNameSchema = z.string().trim().min(1).max(80);

export const templateSchema = quoteFormSchema.pick({
  projectType: true,
  currency: true,
  items: true,
  complexityMultiplierIds: true,
  additionalCharges: true,
  discountPercent: true,
  paymentTerms: true,
  estimatedDelivery: true,
}).extend({
  items: quoteFormSchema.shape.items.transform((items) =>
    items.map((item) => ({ ...item, name: item.name.trim() })),
  ).refine((items) => items.every(({ name }) => name.length > 0)),
});

export interface QuoteTemplate {
  id: string;
  name: string;
  values: z.output<typeof templateSchema>;
}

export async function listTemplates(): Promise<QuoteTemplate[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string; name: string; data_json: string }[]>(
    "SELECT id, name, data_json FROM quote_templates ORDER BY name COLLATE NOCASE, id",
  );
  return rows.map(({ id, name, data_json }) => ({
    id,
    name,
    values: templateSchema.parse(JSON.parse(data_json)),
  }));
}

export async function saveTemplate(name: string, values: QuoteTemplate["values"]): Promise<QuoteTemplate> {
  const checkedName = templateNameSchema.parse(name);
  const template = { id: crypto.randomUUID(), name: checkedName, values: templateSchema.parse(values) };
  const db = await getDb();
  await db.execute(
    "INSERT INTO quote_templates (id, name, data_json) VALUES ($1, $2, $3)",
    [template.id, template.name, JSON.stringify(template.values)],
  );
  return template;
}

export async function removeTemplate(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM quote_templates WHERE id = $1", [id]);
}
