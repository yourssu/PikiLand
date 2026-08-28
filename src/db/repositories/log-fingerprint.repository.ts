import { eq } from "drizzle-orm";
import { db } from "../index";
import { logFingerprintsTable } from "../schema";
import { LogFingerprint, FingerprintState } from "../../domain/models";

function safeToIsoString(val: any): string {
  if (!val) return new Date().toISOString();
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? new Date().toISOString() : val.toISOString();
  }
  if (typeof val === "string") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  return new Date().toISOString();
}

function safeDate(val: any): Date {
  if (!val) return new Date();
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? new Date() : val;
  }
  if (typeof val === "string") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  return new Date();
}

export class LogFingerprintRepository {
  public findByHash(hash: string): LogFingerprint | null {
    const rows = db.select().from(logFingerprintsTable).where(eq(logFingerprintsTable.hash, hash)).all();
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      hash: r.hash,
      repositoryFullName: r.repositoryFullName,
      normalizedSignature: r.normalizedSignature,
      rawLog: r.rawLog,
      state: r.state as FingerprintState,
      occurrenceCount: r.occurrenceCount || 1,
      prUrl: r.prUrl,
      firstSeenAt: safeDate(r.firstSeenAt),
      lastSeenAt: safeDate(r.lastSeenAt),
    };
  }

  public findAllByRepository(repoFullName: string): LogFingerprint[] {
    const rows = db.select().from(logFingerprintsTable).where(eq(logFingerprintsTable.repositoryFullName, repoFullName)).all();
    return rows.map((r) => ({
      hash: r.hash,
      repositoryFullName: r.repositoryFullName,
      normalizedSignature: r.normalizedSignature,
      rawLog: r.rawLog,
      state: r.state as FingerprintState,
      occurrenceCount: r.occurrenceCount || 1,
      prUrl: r.prUrl,
      firstSeenAt: safeDate(r.firstSeenAt),
      lastSeenAt: safeDate(r.lastSeenAt),
    }));
  }

  public save(fp: LogFingerprint): void {
    const existing = this.findByHash(fp.hash);
    const firstSeen = safeToIsoString(fp.firstSeenAt);
    const lastSeen = safeToIsoString(fp.lastSeenAt || new Date());

    if (existing) {
      db.update(logFingerprintsTable)
        .set({
          repositoryFullName: fp.repositoryFullName,
          normalizedSignature: fp.normalizedSignature,
          rawLog: fp.rawLog,
          state: fp.state,
          occurrenceCount: fp.occurrenceCount || 1,
          prUrl: fp.prUrl,
          lastSeenAt: lastSeen,
        })
        .where(eq(logFingerprintsTable.hash, fp.hash))
        .run();
    } else {
      db.insert(logFingerprintsTable)
        .values({
          hash: fp.hash,
          repositoryFullName: fp.repositoryFullName,
          normalizedSignature: fp.normalizedSignature,
          rawLog: fp.rawLog,
          state: fp.state || "IN_PROGRESS",
          occurrenceCount: fp.occurrenceCount || 1,
          prUrl: fp.prUrl,
          firstSeenAt: firstSeen,
          lastSeenAt: lastSeen,
        })
        .run();
    }
  }
}

export const logFingerprintRepository = new LogFingerprintRepository();

