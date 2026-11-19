/** Identificador de cotización basado en la fecha, con un sufijo único por documento. */
export function generateQuoteNumber(date: Date = new Date()): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  const datePart = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `COT-${datePart}-${timePart}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}
