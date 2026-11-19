import { pdf } from "@react-pdf/renderer";
import { documentDir, join } from "@tauri-apps/api/path";
import { mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { calculateQuote } from "../../lib/calculate";
import { generateQuoteNumber } from "../../lib/quoteNumber";
import { getSettings, settingsToFreelancerProfile } from "../settings/db";
import { sumComplexityMultipliers } from "../quote/complexityMultipliers";
import type { QuoteFormValues } from "../quote/schema";
import { QuoteDocument } from "./QuoteDocument";

const QUOTES_SUBFOLDER = "Cotizaciones";

function sanitizeFileNamePart(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|\x00-\x1f\x7f]+/g, "-");
  // Bound by UTF-16 length on Windows, keeping each Unicode character intact.
  const bounded = cleaned.match(/^(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\uD800-\uDFFF]){0,72}/)?.[0] ?? "";
  return bounded.replace(/[. ]+$/, "") || "cotizacion";
}

export interface PreparedQuotePdf {
  blob: Blob;
  quoteNumber: string;
  date: Date;
  total: number;
}

export interface GeneratedQuotePdf {
  path: string;
  quoteNumber: string;
  total: number;
}

/** Renderiza la cotización sin escribir archivos ni agregarla al historial. */
export async function prepareQuotePdf(quote: QuoteFormValues): Promise<PreparedQuotePdf> {
  const date = new Date();
  const quoteNumber = generateQuoteNumber(date);
  const settings = await getSettings();
  const blob = await pdf(
    <QuoteDocument
      quote={quote}
      freelancer={settingsToFreelancerProfile(settings)}
      quoteNumber={quoteNumber}
      date={date}
    />,
  ).toBlob();

  const { total } = calculateQuote({
    items: quote.items,
    hourlyRate: quote.hourlyRate,
    complexityMultiplierPercent: sumComplexityMultipliers(quote.complexityMultiplierIds),
    additionalCharges: quote.additionalCharges,
    discountPercent: quote.discountPercent,
  });

  return { blob, quoteNumber, date, total };
}

/** Guarda exactamente el PDF previsualizado, o prepara uno para una exportación directa. */
export async function generateAndSaveQuotePdf(
  quote: QuoteFormValues,
  prepared?: PreparedQuotePdf,
): Promise<GeneratedQuotePdf> {
  const { blob, quoteNumber, total } = prepared ?? await prepareQuotePdf(quote);
  const quotesDir = await join(await documentDir(), QUOTES_SUBFOLDER);
  await mkdir(quotesDir, { recursive: true });

  const fileName = `${quoteNumber} - ${sanitizeFileNamePart(quote.clientName)}.pdf`;
  const path = await join(quotesDir, fileName);
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));

  return { path, quoteNumber, total };
}
