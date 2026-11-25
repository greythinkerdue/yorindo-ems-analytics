/**
 * @file scripts/backfill-event-metrics.ts
 * @description One-off migration/backfill for the analytics rollup collections.
 *
 * Recomputes every per-event counter from `registrations`, creates the
 * `analytics_meta` version document and invalidates cached dashboard payloads.
 * Safe to re-run: all writes are idempotent upserts.
 *
 * Usage (PowerShell):
 *   npm run analytics:backfill
 */

import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.ts";
import {
  AnalyticsMeta,
  DASHBOARD_BRIEF_CACHE_KEY,
  DASHBOARD_OVERVIEW_CACHE_KEY,
  DashboardCache,
  Event,
  EventMetricRollup,
  Registration,
} from "../models/index.ts";
import {
  bumpAnalyticsVersion,
  markRollupsBackfilled,
  recomputeEventMetric,
} from "../services/event-metric-rollup.service.ts";

async function main(): Promise<void> {
  await connectDB();

  console.log("[BACKFILL] Syncing indexes...");
  await Promise.all([
    EventMetricRollup.createIndexes(),
    AnalyticsMeta.createIndexes(),
    Event.createIndexes(),
    Registration.createIndexes(),
  ]);

  const [eventIds, registrationEventIds] = await Promise.all([
    Event.distinct("_id"),
    Registration.distinct("eventId"),
  ]);

  // Events with zero registrations still need a zero-valued rollup row so the
  // watchlist/fallback logic behaves consistently.
  const allIds = new Set([
    ...eventIds.map((id) => id.toString()),
    ...registrationEventIds.map((id) => id.toString()),
  ]);

  console.log(`[BACKFILL] Recomputing ${allIds.size} event(s)...`);
  let done = 0;
  for (const eventId of allIds) {
    await recomputeEventMetric(eventId);
    done += 1;
    if (done % 25 === 0) console.log(`[BACKFILL] ${done}/${allIds.size}`);
  }

  // Remove stale rollups for events deleted before this script ran.
  const removed = await EventMetricRollup.deleteMany({
    eventId: { $nin: [...allIds] },
  });
  if (removed.deletedCount > 0) {
    console.log(`[BACKFILL] Removed ${removed.deletedCount} stale rollup(s).`);
  }

  // Only flip this after all events above succeeded, otherwise readers would
  // trust a partial rollup collection.
  await bumpAnalyticsVersion();
  await markRollupsBackfilled();

  const cleared = await DashboardCache.deleteMany({
    key: { $in: [DASHBOARD_OVERVIEW_CACHE_KEY, DASHBOARD_BRIEF_CACHE_KEY] },
  });
  console.log(
    `[BACKFILL] Done. ${done} rollup(s), ${cleared.deletedCount} dashboard cache(s) cleared.`,
  );

  await mongoose.connection.close();
}

main().catch(async (error) => {
  console.error("[BACKFILL] Failed:", error);
  try {
    await mongoose.connection.close();
  } catch {
    // ignore
  }
  process.exit(1);
});
