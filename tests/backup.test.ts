import { describe, expect, test } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { backupTables, buildBackup, chunkRows, readBackup, sha256, type BackupData, type TableRows } from '../src/backup/backup';
import { capacityProblem } from '../src/backup/capacity';

async function sample() {
  const workbook = strToU8('synthetic workbook bytes');
  const hash = await sha256(workbook);
  const tables = Object.fromEntries(backupTables.map((table) => [table, []])) as unknown as TableRows;
  tables.source_files = [{ id: 'f1', sha256: hash, file_name: 'export.xlsx', byte_size: workbook.length, media_type: 'x', storage_path: `workbooks/${hash}.xlsx` }];
  tables.data_revisions = [{ id: 1, parent_id: null }];
  tables.daily_records = [
    { id: 1, record_date: '2026-09-01', domain: 'steps', fields: { Steps: 8000 }, introduced_revision_id: 1, retired_revision_id: null },
    { id: 2, record_date: '2026-09-01', domain: 'steps', fields: { Steps: 8000 }, introduced_revision_id: 1, retired_revision_id: null },
  ];
  tables.review_decisions = [{ id: 1, record_date: '2026-09-13', domain: 'scale_weight', field: 'Weight (lb)', value: 297.8, decision: 'exclude' }];
  const data: BackupData = { schemaVersion: 1, tables, workspaceState: { active_revision_id: 1, retained_from_revision_id: null } };
  const archives = new Map([[`workbooks/${hash}.xlsx`, workbook]]);
  return { data, archives, bytes: await buildBackup(data, archives, { display_density: 'compact', duration_unit: 'seconds', strength_band_percent: 2.5 }, '2026-10-21T03:00:00Z') };
}
/** Rewrites one file inside a backup ZIP without updating the manifest. */
function tamper(bytes: Uint8Array, name: string, content: Uint8Array | null) {
  const files = unzipSync(bytes);
  if (content === null) delete files[name]; else files[name] = content as (typeof files)[string];
  return zipSync(files);
}

describe('backup file', () => {
  test('round-trips every table, row multiplicity, exclusions, archives, and preferences, with no credentials', async () => {
    const { data, bytes } = await sample();
    const parsed = await readBackup(bytes);
    expect(parsed.tables).toEqual(data.tables);
    expect(parsed.tables.daily_records).toHaveLength(2);
    expect(parsed.manifest).toMatchObject({ format: 'fitness-insights-backup', format_version: 1, counts: { daily_records: 2, review_decisions: 1, source_files: 1 },
      workspace_state: { active_revision_id: 1 }, preferences: { display_density: 'compact' } });
    expect(strFromU8(parsed.archives.values().next().value!)).toBe('synthetic workbook bytes');
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual(['manifest.json', ...Object.keys(parsed.manifest.files)].sort());
    expect(strFromU8(unzipSync(bytes)['manifest.json'])).not.toMatch(/user_id|token|password|secret|service_role/i);
  });

  test('damaged, incomplete, foreign, or newer-format files are rejected with a reason', async () => {
    const { bytes } = await sample();
    await expect(readBackup(strToU8('not a zip'))).rejects.toThrow(/not a readable ZIP/);
    await expect(readBackup(tamper(bytes, 'tables/daily_records.json', strToU8('[]')))).rejects.toThrow(/daily_records.json does not match its checksum/);
    await expect(readBackup(tamper(bytes, 'tables/reports.json', null))).rejects.toThrow(/tables\/reports.json is missing/);
    await expect(readBackup(tamper(bytes, 'extra.txt', strToU8('x')))).rejects.toThrow(/unexpected files/);
    const manifest = JSON.parse(strFromU8(unzipSync(bytes)['manifest.json']));
    await expect(readBackup(tamper(bytes, 'manifest.json', strToU8(JSON.stringify({ ...manifest, format_version: 2 }))))).rejects.toThrow(/format 2/);
    await expect(readBackup(tamper(bytes, 'manifest.json', strToU8(JSON.stringify({ ...manifest, format: 'other' }))))).rejects.toThrow(/not a Fitness Insights backup/);
    await expect(readBackup(tamper(bytes, 'manifest.json', strToU8(JSON.stringify({ ...manifest, counts: { ...manifest.counts, daily_records: 3 } }))))).rejects.toThrow(/daily_records does not have the expected 3 rows/);
  });

  test('an archive whose content no longer matches its recorded fingerprint is rejected', async () => {
    const { data, archives } = await sample();
    const path = [...archives.keys()][0];
    const swapped = new Map([[path, strToU8('different bytes')]]);
    await expect(readBackup(await buildBackup(data, swapped, { display_density: 'comfortable', duration_unit: 'seconds', strength_band_percent: 2.5 }, '2026-10-21T03:00:00Z')))
      .rejects.toThrow(/export.xlsx does not match its recorded fingerprint/);
  });

  test('rows are chunked by count and size, keeping order', () => {
    const rows = Array.from({ length: 1201 }, (_, index) => ({ index }));
    const chunks = chunkRows(rows);
    expect(chunks.map((chunk) => chunk.length)).toEqual([500, 500, 201]);
    expect(chunks.flat()).toEqual(rows);
    expect(chunkRows([{ text: 'x'.repeat(600) }, { text: 'y'.repeat(600) }], 500, 1000)).toHaveLength(2);
    expect(chunkRows([])).toEqual([[]]);
  });

  test('capacity stops at 90% of either free limit', () => {
    const status = { databaseBytes: 400_000_000, databaseLimitBytes: 524_288_000, archiveBytes: 100, archiveLimitBytes: 1_073_741_824, stagingBytes: 0, stagingUploads: 0, oldestStagingAt: null, hardStopFraction: 0.95 };
    expect(capacityProblem(status, { databaseBytes: 50_000_000, archiveBytes: 0 })).toBeNull();
    expect(capacityProblem(status, { databaseBytes: 80_000_000, archiveBytes: 0 })).toMatch(/free 500 MB limit \(the app stops at 90%\). Nothing was changed./);
    expect(capacityProblem(status, { databaseBytes: 0, archiveBytes: 1_000_000_000 })).toMatch(/stored export files/);
  });
});
