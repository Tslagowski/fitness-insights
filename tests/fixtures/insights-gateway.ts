import { addDays } from '../../src/analysis/eligibility';
import { reportingToday } from '../../src/import/preview';
import { MemoryGateway } from './memory-gateway';
import { insightsSeed } from './insights-seed';

/** A memory gateway holding the synthetic 24-week insights history ending yesterday. */
export async function seededGateway() {
  const gateway = new MemoryGateway();
  gateway.clock = Date.now();
  const seed = insightsSeed(addDays(reportingToday(), -1));
  await gateway.commitSources({ requestId: 'seed', expectedRevisionId: null, acceptReconciliation: true, daily: seed.daily, food: seed.food, workouts: seed.workouts,
    sources: [{ name: 'export.xlsx', kind: 'workbook', sha256: 'a'.repeat(64), byteSize: 1, mediaType: 'x', bytes: new Uint8Array() }] });
  return gateway;
}
