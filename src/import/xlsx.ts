import { unzipSync, type UnzipFileInfo } from 'fflate';

/**
 * A minimal, dependency-light .xlsx reader.
 *
 * It returns cell values exactly as stored: numbers stay numbers, blank cells stay
 * empty, and date-formatted cells become calendar dates (YYYY-MM-DD) computed with
 * integer day arithmetic, so the viewing device's time zone can never shift them.
 */

export type SpreadsheetCell =
  | { kind: 'empty' }
  | { kind: 'number'; value: number }
  | { kind: 'date'; value: string; serial: number }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'error'; value: string };

export interface SpreadsheetSheet {
  name: string;
  /** Rows in sheet order; index 0 is spreadsheet row 1. Missing rows are empty arrays. */
  rows: SpreadsheetCell[][];
}

export interface SpreadsheetWorkbook {
  sheets: SpreadsheetSheet[];
}

export class SpreadsheetReadError extends Error {}

const maximumUncompressedBytes = 60 * 1024 * 1024;
const empty: SpreadsheetCell = { kind: 'empty' };
const builtInDateFormats = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

export function readSpreadsheet(bytes: Uint8Array): SpreadsheetWorkbook {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new SpreadsheetReadError('This file is not an Excel workbook (.xlsx).');
  }
  let files: Record<string, Uint8Array>;
  let declaredBytes = 0;
  try {
    files = unzipSync(bytes, {
      filter(file: UnzipFileInfo) {
        if (!file.name.startsWith('xl/') && file.name !== '[Content_Types].xml') return false;
        declaredBytes += file.originalSize;
        if (declaredBytes > maximumUncompressedBytes) throw new SpreadsheetReadError('This workbook is too large to import.');
        return true;
      },
    });
  } catch (error) {
    if (error instanceof SpreadsheetReadError) throw error;
    throw new SpreadsheetReadError('This workbook could not be opened. It may be damaged or not an .xlsx file.');
  }
  const text = (path: string) => (files[path] ? new TextDecoder().decode(files[path]) : null);
  const workbookXml = text('xl/workbook.xml');
  if (!workbookXml) throw new SpreadsheetReadError('This file is not an Excel workbook (.xlsx).');

  const workbook = parseXml(workbookXml);
  const date1904 = elements(workbook, 'workbookPr').some((element) => ['1', 'true'].includes(element.getAttribute('date1904') ?? ''));
  const relationships = new Map<string, string>();
  const relationshipXml = text('xl/_rels/workbook.xml.rels');
  if (relationshipXml) {
    for (const relationship of elements(parseXml(relationshipXml), 'Relationship')) {
      const target = relationship.getAttribute('Target') ?? '';
      relationships.set(relationship.getAttribute('Id') ?? '', target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    }
  }
  const sharedStrings = readSharedStrings(text('xl/sharedStrings.xml'));
  const dateStyles = readDateStyles(text('xl/styles.xml'));

  const sheets: SpreadsheetSheet[] = [];
  for (const sheet of elements(workbook, 'sheet')) {
    const name = sheet.getAttribute('name') ?? '';
    const relationshipId = attributeByLocalName(sheet, 'id');
    const path = relationships.get(relationshipId ?? '');
    const sheetXml = path ? text(normalizePath(path)) : null;
    if (!sheetXml) throw new SpreadsheetReadError(`The sheet "${name}" could not be read.`);
    sheets.push({ name, rows: readRows(parseXml(sheetXml), sharedStrings, dateStyles, date1904) });
  }
  return { sheets };
}

/** Converts an Excel serial day number to a calendar date without using local time. */
export function serialToCalendarDate(serial: number, date1904 = false): string {
  const wholeDays = Math.floor(serial);
  // 1900 system: serial 60 is the nonexistent 1900-02-29; day 0 counts from 1899-12-30 for serials after it.
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : wholeDays < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  return new Date(epoch + wholeDays * 86_400_000).toISOString().slice(0, 10);
}

function readRows(document: Document, sharedStrings: string[], dateStyles: Set<number>, date1904: boolean): SpreadsheetCell[][] {
  const rows: SpreadsheetCell[][] = [];
  let nextRowIndex = 0;
  for (const row of elements(document, 'row')) {
    const declared = Number(row.getAttribute('r'));
    const rowIndex = Number.isInteger(declared) && declared > 0 ? declared - 1 : nextRowIndex;
    nextRowIndex = rowIndex + 1;
    const cells: SpreadsheetCell[] = [];
    let nextColumn = 0;
    for (const cell of childElements(row, 'c')) {
      const reference = cell.getAttribute('r');
      const column = reference ? columnIndex(reference) : nextColumn;
      nextColumn = column + 1;
      while (cells.length < column) cells.push(empty);
      cells[column] = readCell(cell, sharedStrings, dateStyles, date1904);
    }
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = cells;
  }
  return rows;
}

function readCell(cell: Element, sharedStrings: string[], dateStyles: Set<number>, date1904: boolean): SpreadsheetCell {
  const type = cell.getAttribute('t') ?? 'n';
  const valueText = childElements(cell, 'v')[0]?.textContent ?? null;
  switch (type) {
    case 's': {
      const value = sharedStrings[Number(valueText)];
      return value === undefined ? { kind: 'error', value: 'missing shared string' } : value === '' ? empty : { kind: 'text', value };
    }
    case 'inlineStr': {
      const value = richText(childElements(cell, 'is')[0]);
      return value === '' ? empty : { kind: 'text', value };
    }
    case 'str':
      return valueText === null || valueText === '' ? empty : { kind: 'text', value: valueText };
    case 'b':
      return { kind: 'boolean', value: valueText === '1' };
    case 'e':
      return { kind: 'error', value: valueText ?? '#ERROR' };
    default: {
      if (valueText === null || valueText.trim() === '') return empty;
      const value = Number(valueText);
      if (!Number.isFinite(value)) return { kind: 'error', value: valueText };
      const style = Number(cell.getAttribute('s') ?? '0');
      if (dateStyles.has(style)) return { kind: 'date', value: serialToCalendarDate(value, date1904), serial: value };
      return { kind: 'number', value };
    }
  }
}

function readSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return childElements(parseXml(xml).documentElement, 'si').map(richText);
}

function readDateStyles(xml: string | null): Set<number> {
  const styles = new Set<number>();
  if (!xml) return styles;
  const document = parseXml(xml);
  const customDateFormats = new Set<number>();
  for (const format of elements(document, 'numFmt')) {
    if (isDateFormat(format.getAttribute('formatCode') ?? '')) customDateFormats.add(Number(format.getAttribute('numFmtId')));
  }
  const cellFormats = elements(document, 'cellXfs')[0];
  if (!cellFormats) return styles;
  childElements(cellFormats, 'xf').forEach((format, index) => {
    const id = Number(format.getAttribute('numFmtId') ?? '0');
    if (builtInDateFormats.has(id) || customDateFormats.has(id)) styles.add(index);
  });
  return styles;
}

function isDateFormat(code: string): boolean {
  const unquoted = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');
  return /[dmyhs]/i.test(unquoted) && !/^[#0.,%\s]*$/.test(unquoted);
}

function richText(element: Element | undefined): string {
  if (!element) return '';
  const direct = childElements(element, 't');
  if (direct.length) return direct.map((node) => node.textContent ?? '').join('');
  return childElements(element, 'r').map((run) => childElements(run, 't').map((node) => node.textContent ?? '').join('')).join('');
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/i.exec(reference)?.[0].toUpperCase() ?? 'A';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function parseXml(xml: string): Document {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new SpreadsheetReadError('This workbook contains damaged data.');
  return document;
}

function elements(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', localName));
}

function childElements(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((child) => child.localName === localName);
}

function attributeByLocalName(element: Element, localName: string): string | null {
  for (const attribute of Array.from(element.attributes)) if (attribute.localName === localName) return attribute.value;
  return null;
}
