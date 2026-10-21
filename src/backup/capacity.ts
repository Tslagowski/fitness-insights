/**
 * Free-tier capacity checks (tickets 12 and 13). Supabase Free allows a 500 MB database and 1 GB of
 * file storage. The app refuses work that would cross 90% of either limit instead of risking a failed
 * write or an upgrade; the database still enforces its own limits, so these checks are a first line,
 * not a guarantee.
 */
export interface CapacityStatus {
  databaseBytes: number;
  databaseLimitBytes: number;
  archiveBytes: number;
  archiveLimitBytes: number;
  stagingBytes: number;
}

export const capacitySafetyFraction = 0.9;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toLocaleString('en-US', { maximumFractionDigits: 2 })} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toLocaleString('en-US', { maximumFractionDigits: 1 })} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024).toLocaleString('en-US')} KB`;
  return `${bytes.toLocaleString('en-US')} bytes`;
}

/** Why the incoming data would not fit safely, or null when it fits. */
export function capacityProblem(status: CapacityStatus, incoming: { databaseBytes: number; archiveBytes: number }): string | null {
  const databaseAfter = status.databaseBytes + incoming.databaseBytes;
  const archiveAfter = status.archiveBytes + incoming.archiveBytes;
  if (databaseAfter > status.databaseLimitBytes * capacitySafetyFraction) {
    return `This would bring the database to about ${formatBytes(databaseAfter)} of the free ${formatBytes(status.databaseLimitBytes)} limit (the app stops at 90%). Nothing was changed. Review older versions in Version retention, or download a backup and free space before trying again.`;
  }
  if (archiveAfter > status.archiveLimitBytes * capacitySafetyFraction) {
    return `This would bring stored export files to about ${formatBytes(archiveAfter)} of the free ${formatBytes(status.archiveLimitBytes)} limit (the app stops at 90%). Nothing was changed.`;
  }
  return null;
}
