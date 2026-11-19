import { Document, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { calculateQuote } from "../../lib/calculate";
import { formatCurrency } from "../../lib/currency";
import { addDays, formatDateDMY } from "../../lib/date";
import type { FreelancerProfile } from "../settings/db";
import type { QuoteFormValues } from "../quote/schema";
import {
  COMPLEXITY_MULTIPLIERS,
  sumComplexityMultipliers,
} from "../quote/complexityMultipliers";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS, registerPdfFonts } from "./fonts";
import { QUOTE_VALIDITY_DAYS } from "./quoteConditions";

registerPdfFonts();

const color = {
  white: "#ffffff",
  ink: "#172528",
  soft: "#465b60",
  accent: "#16596a",
  accentLight: "#e9f3f4",
  line: "#d6e1e3",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 34,
    paddingBottom: 56,
    paddingHorizontal: 44,
    backgroundColor: color.white,
    color: color.ink,
    fontFamily: FONT_SANS,
    fontSize: 10,
  },
  header: { flexDirection: "row", gap: 17 },
  titleBlock: { flex: 1, gap: 5 },
  title: { fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, lineHeight: 1.07 },
  subtitle: { fontSize: 11, color: color.soft },
  metadata: { width: 162, borderLeftWidth: 1, borderLeftColor: color.line, paddingLeft: 13, gap: 4 },
  metadataLabel: { color: color.accent, fontWeight: 600 },
  metadataText: { fontSize: 9, color: color.soft },
  quoteNumber: { fontFamily: FONT_MONO, fontSize: 8 },
  identity: { marginTop: 16, flexDirection: "row", gap: 20 },
  identityColumn: { flex: 1, gap: 2 },
  label: { color: color.soft, fontSize: 9, fontWeight: 600 },
  identityName: { fontWeight: 600, fontSize: 11 },
  detail: { color: color.soft, fontSize: 9.5 },
  link: { color: color.accent, textDecoration: "none" },
  summary: { marginTop: 19, flexDirection: "row", gap: 12 },
  price: { flex: 1.55, padding: 11, backgroundColor: color.accentLight, gap: 3 },
  priceValue: { fontFamily: FONT_DISPLAY, color: color.accent, fontSize: 22, fontWeight: 700 },
  term: { flex: 1, paddingTop: 12, borderTopWidth: 1, borderTopColor: color.line, gap: 5 },
  scope: { marginTop: 16, gap: 4 },
  sectionTitle: { color: color.accent, fontSize: 12, fontWeight: 600 },
  bodyText: { color: color.soft },
  table: { marginTop: 15 },
  tableHeader: { flexDirection: "row", backgroundColor: color.accentLight, paddingVertical: 8, paddingHorizontal: 9 },
  tableHeaderText: { color: color.accent, fontSize: 9, fontWeight: 600 },
  tableRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderBottomWidth: 0.6,
    borderBottomColor: color.line,
    paddingVertical: 6,
    paddingHorizontal: 9,
  },
  colName: { flex: 1, paddingRight: 10 },
  colHours: { width: 54, textAlign: "right" },
  colRate: { width: 98, textAlign: "right" },
  colSubtotal: { width: 108, textAlign: "right" },
  itemName: { fontWeight: 500 },
  itemNote: { fontSize: 8.75, color: color.soft, marginTop: 2 },
  figures: { fontFamily: FONT_MONO, fontSize: 9 },
  totals: { marginTop: 16, alignSelf: "flex-end", width: "62%", gap: 5 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  totalLabel: { flex: 1, color: color.soft },
  totalAmount: { fontFamily: FONT_MONO, textAlign: "right", fontSize: 9 },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: color.line,
    paddingTop: 8,
    marginTop: 3,
  },
  grandTotalValue: { fontWeight: 600, color: color.accent, fontSize: 14, textAlign: "right" },
  footer: {
    position: "absolute",
    left: 44,
    right: 44,
    top: 749,
    borderTopWidth: 0.6,
    borderTopColor: color.line,
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    color: color.soft,
    fontSize: 8.5,
  },
});

function toUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

interface QuoteDocumentProps {
  quote: QuoteFormValues;
  freelancer: FreelancerProfile;
  quoteNumber: string;
  date: Date;
}

export function QuoteDocument({ quote, freelancer, quoteNumber, date }: QuoteDocumentProps) {
  const complexityMultiplierPercent = sumComplexityMultipliers(quote.complexityMultiplierIds);
  const selectedMultipliers = COMPLEXITY_MULTIPLIERS.filter((multiplier) =>
    quote.complexityMultiplierIds.includes(multiplier.id),
  );
  const result = calculateQuote({
    items: quote.items,
    hourlyRate: quote.hourlyRate,
    complexityMultiplierPercent,
    additionalCharges: quote.additionalCharges,
    discountPercent: quote.discountPercent,
  });
  const validUntil = addDays(date, QUOTE_VALIDITY_DAYS);
  const money = (amount: number) => formatCurrency(amount, quote.currency);
  const name = freelancer.name.trim();
  const tagline = freelancer.tagline.trim();
  const email = freelancer.email.trim();
  const phone = freelancer.phone.trim();
  const portfolio = freelancer.portfolio.trim();
  const handle = freelancer.handle.trim();
  const hasFreelancer = name || tagline || email || phone || portfolio || handle;
  const terms = quote.paymentTerms.trim();
  const delivery = quote.estimatedDelivery.trim();
  const description = quote.description.trim();
  const totalAmount = money(result.total);
  const total = `${totalAmount} ${quote.currency}`;

  return (
    <Document title={`Cotización - ${quote.projectName}`} author={name || undefined} language="es-DO" creationDate={date}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{quote.projectName}</Text>
            <Text style={styles.subtitle}>Preparada para {quote.clientName}</Text>
          </View>
          <View style={styles.metadata}>
            <Text style={styles.metadataLabel}>Cotización</Text>
            <Text style={styles.quoteNumber}>{quoteNumber}</Text>
            <Text style={styles.metadataText}>Emitida el {formatDateDMY(date)}</Text>
            <Text style={styles.metadataText}>Válida hasta el {formatDateDMY(validUntil)}</Text>
            {quote.revisionOf && (
              <>
                <Text style={styles.metadataText}>Revisión de</Text>
                <Text style={styles.quoteNumber}>{quote.revisionOf}</Text>
              </>
            )}
          </View>
        </View>

        <View style={styles.summary}>
          <View style={styles.price}>
            <Text style={styles.label}>Total de la cotización · {quote.currency}</Text>
            <Text style={[styles.priceValue, { fontSize: Math.min(22, 290 / totalAmount.length) }]}>
              {totalAmount}
            </Text>
          </View>
          {delivery && <SummaryTerm label="Entrega estimada" value={delivery} />}
          {terms && <SummaryTerm label="Forma de pago" value={terms} />}
        </View>

        {(hasFreelancer || quote.clientContact.trim()) && (
          <View style={styles.identity}>
            {hasFreelancer && (
              <View style={styles.identityColumn}>
                <Text style={styles.label}>Emitida por</Text>
                {name && <Text style={styles.identityName}>{name}</Text>}
                {tagline && <Text style={styles.detail}>{tagline}</Text>}
                {email && <Link src={`mailto:${email}`} style={[styles.detail, styles.link]}>{email}</Link>}
                {phone && <Text style={styles.detail}>{phone}</Text>}
                {portfolio && <Link src={toUrl(portfolio)} style={[styles.detail, styles.link]}>{portfolio}</Link>}
                {handle && <Text style={styles.detail}>{handle}</Text>}
              </View>
            )}
            {quote.clientContact.trim() && (
              <View style={styles.identityColumn}>
                <Text style={styles.label}>Contacto del cliente</Text>
                <Text style={styles.detail}>{quote.clientContact}</Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.scope}>
          <Text style={styles.sectionTitle} minPresenceAhead={17}>Alcance del proyecto</Text>
          <Text style={styles.label}>Tipo de proyecto · {quote.projectType}</Text>
          {description && <Text style={styles.bodyText}>{description}</Text>}
        </View>

        <View style={styles.table} minPresenceAhead={42}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.tableHeaderText, styles.colName]}>Funcionalidad / módulo</Text>
            <Text style={[styles.tableHeaderText, styles.colHours]}>Horas</Text>
            <Text style={[styles.tableHeaderText, styles.colRate]}>Tarifa/h</Text>
            <Text style={[styles.tableHeaderText, styles.colSubtotal]}>Importe</Text>
          </View>
          {quote.items.map((item, index) => (
            <View style={styles.tableRow} key={index} wrap={item.name.length > 500}>
              <View style={styles.colName}>
                <Text style={styles.itemName}>{item.name}</Text>
                {item.complexity !== "Personalizado" && (
                  <Text style={styles.itemNote}>Complejidad · {item.complexity}</Text>
                )}
              </View>
              <Text style={[styles.figures, styles.colHours]}>{item.hours}</Text>
              <Text style={[styles.figures, styles.colRate]}>{money(quote.hourlyRate)}</Text>
              <Text style={[styles.figures, styles.colSubtotal]}>{money(item.hours * quote.hourlyRate)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals} wrap={quote.additionalCharges.length > 8 || quote.additionalCharges.some(({ name }) => name.length > 200)}>
          <Text style={styles.sectionTitle} minPresenceAhead={26}>Desglose del precio</Text>
          <TotalLine label="Mano de obra" amount={money(result.laborSubtotal)} />
          {complexityMultiplierPercent > 0 && (
            <>
              <TotalLine label={`Recargo por complejidad (+${complexityMultiplierPercent} %)`} amount={money(result.complexityAmount)} />
              <Text style={styles.itemNote}>
                {selectedMultipliers.map((multiplier) => `${multiplier.label} (+${multiplier.percent} %)`).join(" · ")}
              </Text>
            </>
          )}
          {quote.additionalCharges.map((charge, index) => (
            <TotalLine key={index} label={charge.name} amount={money(charge.amount)} />
          ))}
          <View wrap={false}>
            {quote.discountPercent > 0 && (
              <>
                <TotalLine label="Subtotal antes de descuento" amount={money(result.subtotal)} />
                <TotalLine label={`Descuento (${quote.discountPercent} %)`} amount={`- ${money(result.discountAmount)}`} />
              </>
            )}
            <View style={styles.grandTotal}>
              <Text style={styles.sectionTitle}>Total</Text>
              <Text style={styles.grandTotalValue}>{total}</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>{quoteNumber}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

function SummaryTerm({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.term}>
      <Text style={styles.label}>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}

function TotalLine({ label, amount }: { label: string; amount: string }) {
  return (
    <View style={styles.totalsRow} wrap={label.length > 500}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={styles.totalAmount}>{amount}</Text>
    </View>
  );
}
