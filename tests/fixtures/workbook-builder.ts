import { strToU8, zipSync } from 'fflate';

/**
 * Builds small synthetic .xlsx files for tests. Values: number -> numeric cell,
 * string -> shared string, null/undefined -> no cell, { date: 'YYYY-MM-DD' } ->
 * date-styled serial (format mm-dd-yy, as MacroFactor exports), { raw: xml } -> verbatim cell XML.
 */
export type FixtureValue = number | string | null | undefined | { date: string } | { raw: string };

export interface FixtureSheet {
  name: string;
  rows: FixtureValue[][];
}

export function buildWorkbook(sheets: FixtureSheet[], options: { date1904?: boolean } = {}): Uint8Array {
  const strings: string[] = [];
  const stringIndex = (value: string) => {
    const existing = strings.indexOf(value);
    if (existing >= 0) return existing;
    strings.push(value);
    return strings.length - 1;
  };
  const files: Record<string, Uint8Array> = {};
  sheets.forEach((sheet, sheetIndex) => {
    const rows = sheet.rows.map((row, rowIndex) => {
      const cells = row.map((value, columnIndex) => {
        if (value === null || value === undefined) return '';
        const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
        if (typeof value === 'number') return `<c r="${reference}"><v>${value}</v></c>`;
        if (typeof value === 'string') return `<c r="${reference}" t="s"><v>${stringIndex(value)}</v></c>`;
        if ('raw' in value) return value.raw.replace('{ref}', reference);
        return `<c r="${reference}" s="1"><v>${dateSerial(value.date, options.date1904)}</v></c>`;
      }).join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join('');
    files[`xl/worksheets/sheet${sheetIndex + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
  });
  files['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${options.date1904 ? '<workbookPr date1904="1"/>' : ''}<sheets>${
      sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
      sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`);
  files['xl/styles.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="mm-dd-yy"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>');
  files['xl/sharedStrings.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${
      strings.map((value) => `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`).join('')}</sst>`);
  files['[Content_Types].xml'] = strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  return zipSync(files);
}

export const dailyHeaders = [
  'Date', 'Expenditure', 'Trend Weight (lb)', 'Weight (lb)', 'Calories (kcal)', 'Protein (g)', 'Fat (g)', 'Carbs (g)',
  'Target Calories (kcal)', 'Target Protein (g)', 'Target Fat (g)', 'Target Carbs (g)', 'Steps', 'Alcohol (g)', 'Fiber (g)',
];

/** One synthetic daily row in MacroFactor column order. Pass null to leave a cell blank. */
export function dailyRow(date: string, overrides: Partial<Record<string, FixtureValue>> = {}): FixtureValue[] {
  const defaults: Record<string, FixtureValue> = {
    Date: { date }, Expenditure: 2500, 'Trend Weight (lb)': 180.5, 'Weight (lb)': 181, 'Calories (kcal)': 2300, 'Protein (g)': 160,
    'Fat (g)': 70, 'Carbs (g)': 250, 'Target Calories (kcal)': 2350, 'Target Protein (g)': 165, 'Target Fat (g)': 65,
    'Target Carbs (g)': 260, Steps: 8000, 'Alcohol (g)': null, 'Fiber (g)': 30,
  };
  return dailyHeaders.map((header) => (header in overrides ? overrides[header] : defaults[header]));
}

export function syntheticWorkbook(rows: FixtureValue[][], extraSheets: FixtureSheet[] = []): Uint8Array {
  return buildWorkbook([{ name: 'Quick Export', rows: [dailyHeaders, ...rows] }, ...extraSheets]);
}

function dateSerial(date: string, date1904 = false): number {
  const [year, month, day] = date.split('-').map(Number);
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return (Date.UTC(year, month - 1, day) - epoch) / 86_400_000;
}

function columnName(index: number): string {
  let name = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
