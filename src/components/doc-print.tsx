"use client";
import { FileBadge, Printer, ReceiptText } from "lucide-react";
import type { Entity } from "@/lib/types";

type DocKind = "quotation" | "invoice" | "tax_invoice" | "receipt";
const url = (kind: DocKind, id: string) => `/print/${kind}/${id}`;

/** Which printable documents a record offers (catalog kind → buttons). */
export function docButtons(kind: string, record: Pick<Entity, "id" | "data" | "archived_at">) {
  const out: { doc: DocKind; label: string }[] = [];
  if (record.archived_at) return out;
  const d = record.data;
  if (kind === "quotations") out.push({ doc: "quotation", label: "พิมพ์ใบเสนอราคา" });
  if (kind === "invoices") {
    out.push({ doc: "invoice", label: "พิมพ์ใบแจ้งหนี้" }, { doc: "tax_invoice", label: "ออกใบกำกับภาษี" });
    if (d.status === "paid") out.push({ doc: "receipt", label: "ออกใบเสร็จรับเงิน" });
  }
  if (kind === "payments" && d.direction === "income") out.push({ doc: "receipt", label: "ออกใบเสร็จรับเงิน" });
  return out;
}

const icons = { quotation: Printer, invoice: Printer, tax_invoice: FileBadge, receipt: ReceiptText };

/** Buttons that open the record's A4 document in a new tab (print / save as PDF from there). */
export function DocPrintButtons({ kind, record }: { kind: string; record: Pick<Entity, "id" | "data" | "archived_at"> }) {
  const buttons = docButtons(kind, record);
  if (!buttons.length) return null;
  return (
    <div className="doc-print">
      {buttons.map((b) => {
        const Icon = icons[b.doc];
        return (
          <a key={b.doc} className={`doc-print-btn doc-${b.doc}`} href={url(b.doc, record.id)} target="_blank" rel="noopener">
            <Icon size={15} aria-hidden />
            {b.label}
          </a>
        );
      })}
    </div>
  );
}
