import 'server-only';
import ExcelJS from 'exceljs';

/**
 * Professional report workbook builder (shared by every admin export).
 *
 * Turns a declarative spec — title, metadata band (date range / filters / when
 * generated), and one or more typed sheets — into a styled .xlsx or a .csv.
 * Every exported sheet gets: a title, a metadata band, a bold navy frozen header
 * row with an auto-filter, typed number/date/currency formatting, auto-sized
 * columns, and an optional bold totals row. The same spec drives the CSV path so
 * the two never diverge.
 *
 * Design goals: management-readable output with zero technical knowledge, and a
 * single place to change styling for all reports.
 */

export type CellValue = string | number | Date | null | undefined;
export type ColumnFormat = 'text' | 'int' | 'money' | 'date' | 'datetime' | 'percent';

export interface ReportColumn {
  header: string;
  key: string;
  /** Explicit column width (characters). Auto-sized from content when omitted. */
  width?: number;
  format?: ColumnFormat;
  /** Include a SUM of this column in the bold totals row. */
  total?: boolean;
}

export interface ReportSheet {
  name: string;
  columns: ReportColumn[];
  rows: Record<string, CellValue>[];
  /** Optional note printed under the metadata band (e.g. an empty-result hint). */
  note?: string;
}

export interface ReportWorkbookSpec {
  title: string;
  /** Shown at the top of the first sheet: date range, filters applied, generated-at. */
  meta: { label: string; value: string }[];
  sheets: ReportSheet[];
}

// Brand palette (Crown Island navy / gold).
const NAVY = 'FF1C2B40';
const HEADER_FILL = 'FF1C2B40';
const HEADER_FONT = 'FFFFFFFF';
const META_FONT = 'FF64748B';
const BORDER = 'FFD9DEE4';
const TOTAL_FILL = 'FFF3F0E6';

const NUM_FMT: Record<ColumnFormat, string | undefined> = {
  text: undefined,
  int: '#,##0',
  money: '#,##0.00',
  date: 'yyyy-mm-dd',
  datetime: 'yyyy-mm-dd hh:mm',
  percent: '0"%"',
};

const thinBorder = {
  top: { style: 'thin' as const, color: { argb: BORDER } },
  left: { style: 'thin' as const, color: { argb: BORDER } },
  bottom: { style: 'thin' as const, color: { argb: BORDER } },
  right: { style: 'thin' as const, color: { argb: BORDER } },
};

/**
 * Neutralize spreadsheet formula injection: Excel executes cells beginning with
 * `=`, `+`, `-` or `@`, so user-controlled strings get a leading apostrophe.
 */
function safeText(v: string): string {
  return /^\s*[=+\-@]/.test(v) ? `'${v}` : v;
}

/** Coerce a spec value to the concrete cell value Excel should store. */
function toCell(v: CellValue, format?: ColumnFormat): string | number | Date | null {
  if (v === null || v === undefined) return format && format !== 'text' ? null : '—';
  if (v instanceof Date) return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return safeText(String(v));
}

/** Character width from the header + the longest rendered cell, clamped. */
function autoWidth(col: ReportColumn, rows: Record<string, CellValue>[]): number {
  if (col.width) return col.width;
  let max = col.header.length;
  for (const row of rows) {
    const v = row[col.key];
    let len: number;
    if (v instanceof Date) len = 16;
    else if (typeof v === 'number') len = String(Math.round(v)).length + (col.format === 'money' ? 3 : 0);
    else len = v == null ? 1 : String(v).length;
    if (len > max) max = len;
  }
  return Math.min(60, Math.max(10, max + 2));
}

function renderSheet(ws: ExcelJS.Worksheet, sheet: ReportSheet, spec: ReportWorkbookSpec, isFirst: boolean) {
  const colCount = Math.max(1, sheet.columns.length);
  let cursor = 1;

  // Title.
  const titleCell = ws.getCell(cursor, 1);
  titleCell.value = spec.title;
  titleCell.font = { bold: true, size: 15, color: { argb: NAVY } };
  ws.mergeCells(cursor, 1, cursor, colCount);
  cursor += 1;

  // Metadata band (date range / filters / generated-at) — on the first sheet.
  if (isFirst) {
    for (const m of spec.meta) {
      const c = ws.getCell(cursor, 1);
      c.value = `${m.label}: ${m.value}`;
      c.font = { size: 10, color: { argb: META_FONT } };
      ws.mergeCells(cursor, 1, cursor, colCount);
      cursor += 1;
    }
  }
  if (sheet.note) {
    const c = ws.getCell(cursor, 1);
    c.value = sheet.note;
    c.font = { size: 10, italic: true, color: { argb: META_FONT } };
    ws.mergeCells(cursor, 1, cursor, colCount);
    cursor += 1;
  }
  cursor += 1; // spacer

  // Header row.
  const headerRowIdx = cursor;
  const headerRow = ws.getRow(headerRowIdx);
  sheet.columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: HEADER_FONT } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = thinBorder;
  });
  headerRow.height = 20;
  cursor += 1;

  // Data rows.
  for (const row of sheet.rows) {
    const r = ws.getRow(cursor);
    sheet.columns.forEach((col, i) => {
      const cell = r.getCell(i + 1);
      cell.value = toCell(row[col.key], col.format);
      const fmt = col.format ? NUM_FMT[col.format] : undefined;
      if (fmt) cell.numFmt = fmt;
      cell.border = thinBorder;
      if (col.format === 'money' || col.format === 'int' || col.format === 'percent') {
        cell.alignment = { horizontal: 'right' };
      }
    });
    cursor += 1;
  }

  // Totals row.
  if (sheet.rows.length > 0 && sheet.columns.some((c) => c.total)) {
    const totalRow = ws.getRow(cursor);
    sheet.columns.forEach((col, i) => {
      const cell = totalRow.getCell(i + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } };
      cell.font = { bold: true };
      cell.border = { ...thinBorder, top: { style: 'medium', color: { argb: NAVY } } };
      if (i === 0) {
        cell.value = 'TOTAL';
      } else if (col.total) {
        const sum = sheet.rows.reduce((a, row) => {
          const v = row[col.key];
          return a + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        }, 0);
        cell.value = sum;
        const fmt = col.format ? NUM_FMT[col.format] : undefined;
        if (fmt) cell.numFmt = fmt;
        cell.alignment = { horizontal: 'right' };
      }
    });
    cursor += 1;
  }

  // Column widths + freeze header + auto-filter.
  sheet.columns.forEach((col, i) => {
    ws.getColumn(i + 1).width = autoWidth(col, sheet.rows);
  });
  ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];
  if (sheet.rows.length > 0) {
    ws.autoFilter = {
      from: { row: headerRowIdx, column: 1 },
      to: { row: headerRowIdx, column: colCount },
    };
  }
}

/** Build a styled .xlsx workbook from the spec. Returns raw bytes (a valid
 *  `BodyInit` for the Next.js response, no Buffer→BodyInit cast needed). */
export async function buildReportWorkbook(spec: ReportWorkbookSpec): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Crown Island';
  wb.created = new Date();

  const sheets = spec.sheets.length > 0 ? spec.sheets : [{ name: 'Data', columns: [], rows: [] }];
  sheets.forEach((sheet, idx) => {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31) || `Sheet${idx + 1}`);
    renderSheet(ws, sheet, spec, idx === 0);
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

/** Serialize a single value for CSV. */
function csvValue(v: CellValue, format?: ColumnFormat): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) {
    s = format === 'date' ? v.toISOString().slice(0, 10) : v.toISOString();
  } else if (typeof v === 'number') {
    s = String(v);
  } else {
    s = safeText(String(v));
  }
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV of the primary (first) sheet — a metadata preamble, the header, then the
 * rows. UTF-8 BOM is added by the caller so Excel decodes Arabic correctly.
 */
export function buildReportCsv(spec: ReportWorkbookSpec): string {
  const lines: string[] = [];
  lines.push(csvValue(spec.title));
  for (const m of spec.meta) lines.push(`${csvValue(m.label)},${csvValue(m.value)}`);
  lines.push('');
  const sheet = spec.sheets[0];
  if (!sheet) return lines.join('\r\n');
  lines.push(sheet.columns.map((c) => csvValue(c.header)).join(','));
  for (const row of sheet.rows) {
    lines.push(sheet.columns.map((c) => csvValue(row[c.key], c.format)).join(','));
  }
  return lines.join('\r\n');
}
