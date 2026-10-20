import {
  defaultPreferences, NothingToChangeError, StaleRevisionError, type ChangeKind, type ChangeResult, type ClearDayRequest,
  type DisplayDensity, type Gateway, type Identity, type ImportCommitRequest, type ImportedHistory, type ImportSummary, type UndoPreview,
} from '../../src/gateway';
import type { DailyDomain, DailyValues } from '../../src/import/workbook';
import { sameValues } from '../../src/import/preview';

interface Row { date: string; domain: DailyDomain; values: DailyValues; sourceFileId: string; introduced: number; retired: number | null }
interface Event extends ImportSummary { requestId: string; baseRevisionId: number | null }

/**
 * In-memory stand-in for the Supabase gateway that follows the same revision rules as the SQL
 * functions (append-only rows, linear revisions, stale/replay checks, undo by snapshot). The SQL
 * itself is tested against PostgreSQL; this lets UI tests exercise realistic multi-device flows.
 */
export class MemoryGateway implements Gateway {
  identity: Identity | null = { id: 'owner', name: 'Trevis' };
  owner = true;
  density: DisplayDensity = 'comfortable';
  failSave = false;
  failWrites = false;
  listener = () => {};
  revisionId: number | null = null;
  rows: Row[] = [];
  events: Event[] = [];
  calls: Array<{ method: string; requestId?: string; expectedRevisionId: number | null }> = [];
  private nextRevision = 1;
  private clock = Date.UTC(2026, 9, 20, 15);

  async getIdentity() { return this.identity; }
  async isOwner() { return this.owner; }
  async loadPreferences() { return { ...defaultPreferences, displayDensity: this.density }; }
  async savePreferences(_userId: string, density: DisplayDensity) {
    if (this.failSave) throw new Error('Network unavailable');
    this.density = density;
    return this.loadPreferences();
  }
  async signIn() {}
  async signOut() { this.identity = null; this.listener(); }
  onIdentityChange(listener: () => void) { this.listener = listener; return () => { this.listener = () => {}; }; }

  get active() { return this.rows.filter((row) => row.retired === null); }

  async loadHistory(): Promise<ImportedHistory> {
    return {
      revisionId: this.revisionId,
      records: this.active.map((row) => ({ date: row.date, domain: row.domain, values: { ...row.values }, sourceFileId: row.sourceFileId, revisionId: row.introduced })),
      imports: [...this.events].reverse().map(({ requestId: _requestId, baseRevisionId: _base, ...summary }) => ({ ...summary, undone: this.events.some((event) => event.undoesId === summary.id) })),
      undoTargetId: this.undoTarget()?.id ?? null,
    };
  }

  async commitImport(request: ImportCommitRequest) {
    const replay = this.begin('commitImport', request.requestId, request.expectedRevisionId);
    if (replay) return { ...replay, unchanged: 0 };
    let added = 0; let changed = 0; let unchanged = 0;
    const plan: Array<{ record: (typeof request.records)[number]; existing?: Row }> = [];
    for (const record of request.records) {
      const existing = this.active.find((row) => row.date === record.date && row.domain === record.domain);
      if (!existing) { added += 1; plan.push({ record }); }
      else if (sameValues(existing.values, record.values)) unchanged += 1;
      else { changed += 1; plan.push({ record, existing }); }
    }
    const revision = plan.length ? this.newRevision() : null;
    for (const { record, existing } of plan) {
      if (existing) existing.retired = revision;
      this.rows.push({ date: record.date, domain: record.domain, values: { ...record.values }, sourceFileId: request.file.sha256, introduced: revision!, retired: null });
    }
    const dates = request.records.map((record) => record.date).sort();
    this.record(request.requestId, 'workbook', revision, { added, changed, unchanged, removed: 0, firstDate: dates[0], lastDate: dates.at(-1)!, fileName: request.file.name, byteSize: request.file.byteSize });
    return { outcome: revision ? 'changed' as const : 'unchanged' as const, replayed: false, revisionId: this.revisionId, added, changed, unchanged };
  }

  async clearDay(request: ClearDayRequest): Promise<ChangeResult> {
    const replay = this.begin('clearDay', request.requestId, request.expectedRevisionId);
    if (replay) return replay;
    const existing = this.active.find((row) => row.date === request.date && row.domain === request.domain);
    if (!existing) throw new NothingToChangeError('There is no saved record for that date and domain.');
    const revision = this.newRevision();
    existing.retired = revision;
    this.record(request.requestId, 'clear', revision, { added: 0, changed: 0, unchanged: 0, removed: 1, firstDate: request.date, lastDate: request.date, clearedDate: request.date, clearedDomain: request.domain });
    return { outcome: 'changed', replayed: false, revisionId: revision, added: 0, changed: 0, removed: 1 };
  }

  async previewUndo(expectedRevisionId: number | null): Promise<UndoPreview> {
    this.calls.push({ method: 'previewUndo', expectedRevisionId });
    if (expectedRevisionId !== this.revisionId) throw new StaleRevisionError('stale');
    const { target, plan } = this.undoPlan();
    const dates = plan.map((item) => item.date).sort();
    return { targetId: target.id, targetKind: target.kind, targetCommittedAt: target.committedAt, restoresRevisionId: target.baseRevisionId, ...this.count(plan), firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null };
  }

  async undoLastChange(request: { requestId: string; expectedRevisionId: number | null }): Promise<ChangeResult> {
    const replay = this.begin('undoLastChange', request.requestId, request.expectedRevisionId);
    if (replay) return replay;
    const { target, plan } = this.undoPlan();
    const revision = plan.length ? this.newRevision() : null;
    for (const item of plan) {
      if (item.current) item.current.retired = revision;
      if (item.restore) this.rows.push({ ...item.restore, values: { ...item.restore.values }, introduced: revision!, retired: null });
    }
    const counts = this.count(plan);
    const dates = plan.map((item) => item.date).sort();
    this.record(request.requestId, 'undo', revision, { ...counts, unchanged: 0, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null, undoesId: target.id });
    return { outcome: revision ? 'changed' : 'unchanged', replayed: false, revisionId: this.revisionId, ...counts };
  }

  /** Simulates another device changing the shared history. */
  async otherDeviceImport(records: Array<{ date: string; domain: DailyDomain; values: DailyValues }>) {
    return this.commitImport({ requestId: `other-${this.clock}`, expectedRevisionId: this.revisionId, file: { name: 'other-device.xlsx', sha256: 'f'.repeat(64), byteSize: 1, mediaType: 'x', bytes: new Uint8Array() }, records });
  }

  private begin(method: string, requestId: string, expectedRevisionId: number | null): ChangeResult | null {
    this.calls.push({ method, requestId, expectedRevisionId });
    if (this.failWrites) throw new Error('Network unavailable');
    const existing = this.events.find((event) => event.requestId === requestId);
    if (existing) return { outcome: existing.outcome, replayed: true, revisionId: existing.revisionId ?? existing.baseRevisionId, added: existing.added, changed: existing.changed, removed: existing.removed };
    if (expectedRevisionId !== this.revisionId) throw new StaleRevisionError('stale');
    return null;
  }

  private undoTarget() {
    return [...this.events].reverse().find((event) => event.outcome === 'changed' && event.kind !== 'undo' && !this.events.some((undo) => undo.undoesId === event.id));
  }

  private undoPlan() {
    const target = this.undoTarget();
    if (!target) throw new NothingToChangeError('There is no import or correction to undo.');
    const base = target.baseRevisionId;
    const snapshot = base === null ? [] : this.rows.filter((row) => row.introduced <= base && (row.retired === null || row.retired > base));
    const keys = new Set([...snapshot, ...this.active].map((row) => `${row.date}|${row.domain}`));
    const plan: Array<{ date: string; action: 'added' | 'changed' | 'removed'; current?: Row; restore?: Row }> = [];
    for (const key of keys) {
      const [date, domain] = key.split('|');
      const restore = snapshot.find((row) => row.date === date && row.domain === domain);
      const current = this.active.find((row) => row.date === date && row.domain === domain);
      if (restore && current && sameValues(restore.values, current.values)) continue;
      plan.push({ date, action: !current ? 'added' : !restore ? 'removed' : 'changed', current, restore });
    }
    return { target, plan };
  }

  private count(plan: Array<{ action: string }>) {
    return { added: plan.filter((item) => item.action === 'added').length, changed: plan.filter((item) => item.action === 'changed').length, removed: plan.filter((item) => item.action === 'removed').length };
  }

  private newRevision() { return this.nextRevision++; }

  private record(requestId: string, kind: ChangeKind, revision: number | null, details: Partial<ImportSummary> & { added: number; changed: number; unchanged: number; removed: number }) {
    this.clock += 60_000;
    this.events.push({
      id: `change-${this.events.length + 1}`, requestId, kind, baseRevisionId: this.revisionId, outcome: revision ? 'changed' : 'unchanged',
      revisionId: revision, committedAt: new Date(this.clock).toISOString(), clearedDate: null, clearedDomain: null, undoesId: null, undone: false,
      firstDate: null, lastDate: null, fileName: null, byteSize: null, ...details,
    });
    if (revision) this.revisionId = revision;
  }
}
