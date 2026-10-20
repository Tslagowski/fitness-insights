/**
 * RFC 4180 CSV parsing: optional UTF-8 BOM, quoted fields with embedded commas, quotes ("")
 * and line breaks, and LF or CRLF row endings. Every field is returned as the exact text;
 * an empty field is an empty string. Interpretation (numbers, dates) happens elsewhere.
 */
export class CsvParseError extends Error {}

export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"' && !fieldStarted) { quoted = true; fieldStarted = true; continue; }
    if (character === ',') { row.push(field); field = ''; fieldStarted = false; continue; }
    if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = []; field = ''; fieldStarted = false;
      continue;
    }
    field += character;
    fieldStarted = true;
  }
  if (quoted) throw new CsvParseError('The CSV file ends inside a quoted field; it may be truncated.');
  if (fieldStarted || field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
