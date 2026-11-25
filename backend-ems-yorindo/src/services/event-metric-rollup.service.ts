/**
 * @file services/event-metric-rollup.service.ts
 * @description Read/write helpers for per-event metric rollups.
 *
 * Reads fall back to aggregating registrations until the one-off backfill has
 * marked `analytics_meta.rollupsBackfilled = true`. Writes start maintaining
 * rollups immediately, so the flag prevents a partially populated collection
 * from being served as if it were complete.
 */

import { Types, type PipelineStage } from "mongoose";
import {
  AnalyticsMeta,
  ANALYTICS_META_KEY,
  EventMetricRollup,
  Registration,
} from "../models/index.ts";

export const APPROVED_STATUSES = ["approved", "checked_in", "check-in"] as const;
export const ATTENDANCE_STATUSES = ["checked_in", "check-in"] as const;

export interface EventMetricValues {
  registrations: number;
  pending: number;
  approved: number;
  attendance: number;
  rejected: number;
  ticketsNotSent: number;
}

export type EventMetricDelta = Partial<Record<keyof EventMetricValues, number>>;

export type EventMetricRow = EventMetricValues & { eventId: string };

const METRIC_FIELDS: Array<keyof EventMetricValues> = [
  "registrations",
  "pending",
  "approved",
  "attendance",
  "rejected",
  "ticketsNotSent",
];

function emptyMetrics(): EventMetricValues {
  return {
    registrations: 0,
    pending: 0,
    approved: 0,
    attendance: 0,
    rejected: 0,
    ticketsNotSent: 0,
  };
}

function normalizeRow(row: Record<string, unknown> | undefined): EventMetricValues {
  const values = emptyMetrics();
  if (!row) return values;
  for (const field of METRIC_FIELDS) {
    const value = Number(row[field]);
    values[field] = Number.isFinite(value) ? value : 0;
  }
  return values;
}

/** Single source of truth for the metric definitions. */
function metricsPipeline(eventId?: Types.ObjectId): PipelineStage[] {
  const stages: PipelineStage[] = [];
  if (eventId) stages.push({ $match: { eventId } });
  stages.push({
    $group: {
      _id: "$eventId",
      registrations: { $sum: 1 },
      pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
      approved: {
        $sum: {
          $cond: [{ $in: ["$status", [...APPROVED_STATUSES]] }, 1, 0],
        },
      },
      attendance: {
        $sum: {
          $cond: [{ $in: ["$status", [...ATTENDANCE_STATUSES]] }, 1, 0],
        },
      },
      rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
      ticketsNotSent: {
        $sum: {
          $cond: [{ $ne: ["$ticketDelivery.status", "sent"] }, 1, 0],
        },
      },
    },
  });
  return stages;
}

function toObjectId(eventId: string | Types.ObjectId): Types.ObjectId {
  return eventId instanceof Types.ObjectId
    ? eventId
    : new Types.ObjectId(eventId);
}

/** Bump the global data version so derived caches can invalidate in O(1). */
export async function bumpAnalyticsVersion(): Promise<void> {
  const now = new Date();
  await AnalyticsMeta.findOneAndUpdate(
    { key: ANALYTICS_META_KEY },
    { $set: { version: now.toISOString(), updatedAt: now } },
    { upsert: true },
  );
}

export async function getAnalyticsVersion(): Promise<string | null> {
  const meta = await AnalyticsMeta.findOne({ key: ANALYTICS_META_KEY })
    .select("version")
    .lean<{ version: string } | null>();
  return meta?.version ?? null;
}

async function areRollupsBackfilled(): Promise<boolean> {
  const meta = await AnalyticsMeta.findOne({ key: ANALYTICS_META_KEY })
    .select("rollupsBackfilled")
    .lean<{ rollupsBackfilled?: boolean } | null>();
  return Boolean(meta?.rollupsBackfilled);
}

/** Called by the one-off backfill after every event has been recomputed. */
export async function markRollupsBackfilled(): Promise<void> {
  await AnalyticsMeta.updateOne(
    { key: ANALYTICS_META_KEY },
    { $set: { rollupsBackfilled: true } },
    { upsert: true },
  );
}

/**
 * Increment counters for one event and mark the global data as changed.
 * Call this ONLY after the underlying write has actually succeeded.
 */
export async function bumpEventMetrics(
  eventId: string | Types.ObjectId,
  delta: EventMetricDelta,
): Promise<void> {
  const inc: Record<string, number> = {};
  for (const [field, value] of Object.entries(delta)) {
    if (typeof value === "number" && value !== 0) inc[field] = value;
  }
  if (Object.keys(inc).length === 0) return;

  await EventMetricRollup.findOneAndUpdate(
    { eventId: toObjectId(eventId) },
    { $inc: inc, $set: { updatedAt: new Date() } },
    { upsert: true, setDefaultsOnInsert: true },
  );
  await bumpAnalyticsVersion();
}

export async function removeEventMetric(
  eventId: string | Types.ObjectId,
): Promise<void> {
  await EventMetricRollup.deleteOne({ eventId: toObjectId(eventId) });
  await bumpAnalyticsVersion();
}

/** Recalculate one event from the source collection (used by backfill). */
export async function recomputeEventMetric(
  eventId: string | Types.ObjectId,
): Promise<EventMetricValues> {
  const objectId = toObjectId(eventId);
  const [row] = await Registration.aggregate(metricsPipeline(objectId));

  const values = normalizeRow(row as Record<string, unknown> | undefined);
  await EventMetricRollup.findOneAndUpdate(
    { eventId: objectId },
    { $set: { ...values, updatedAt: new Date() } },
    { upsert: true, setDefaultsOnInsert: true },
  );
  return values;
}

async function aggregateEventMetric(
  eventId: string | Types.ObjectId,
): Promise<EventMetricValues> {
  const [row] = await Registration.aggregate(
    metricsPipeline(toObjectId(eventId)),
  );
  return normalizeRow(row as Record<string, unknown> | undefined);
}

function computeAllFromRegistrations(): Promise<EventMetricRow[]> {
  return Registration.aggregate(metricsPipeline()).then(
    (rows: Array<Record<string, unknown>>) =>
      rows.map((row) => ({
        eventId: String(row._id),
        ...normalizeRow(row),
      })),
  );
}

/** All per-event metrics. Falls back to a full aggregation before backfill. */
export async function getAllEventMetrics(): Promise<EventMetricRow[]> {
  // Do not trust a partially populated rollup collection: writes start
  // creating per-event rows immediately, long before the backfill finishes.
  if (!(await areRollupsBackfilled())) return computeAllFromRegistrations();

  const rows = await EventMetricRollup.find({})
    .select("eventId registrations pending approved attendance rejected ticketsNotSent")
    .lean<
      Array<Record<string, unknown> & { eventId: Types.ObjectId }>
    >();

  return rows.map((row) => ({
    eventId: row.eventId.toString(),
    ...normalizeRow(row),
  }));
}

/** One event's metrics. Falls back to a targeted aggregation before backfill. */
export async function getEventMetric(
  eventId: string | Types.ObjectId,
): Promise<EventMetricValues> {
  if (!(await areRollupsBackfilled())) {
    return aggregateEventMetric(eventId);
  }

  const row = await EventMetricRollup.findOne({ eventId: toObjectId(eventId) })
    .select("registrations pending approved attendance rejected ticketsNotSent")
    .lean<Record<string, unknown> | null>();

  // An event with zero registrations may legitimately have no rollup row yet.
  return row ? normalizeRow(row) : aggregateEventMetric(eventId);
}
