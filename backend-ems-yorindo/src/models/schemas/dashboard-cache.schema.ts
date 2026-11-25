/**
 * @file schemas/dashboard-cache.schema.ts
 * @description DB-backed cache for derived dashboard results.
 *
 * Dashboard KPI aggregation and AI brief generation are expensive. Instead of
 * recomputing them on every page view (and again for a second endpoint), the
 * results are stored here and reused while still fresh. Cache entries are
 * keyed by a stable name plus a `version` (source data version) so a change in
 * the underlying data invalidates the cache automatically.
 */

import { Schema, model, Types } from "mongoose";

export const DASHBOARD_OVERVIEW_CACHE_KEY = "dashboard:overview";
export const DASHBOARD_BRIEF_CACHE_KEY = "dashboard:operations-brief";

export interface IDashboardCache {
  _id: Types.ObjectId;
  /** Stable cache name, e.g. "dashboard:overview". */
  key: string;
  /** Source data version. A mismatch means the cached payload is stale. */
  version: string;
  /** Serialized derived result (overview objects, AI brief, ...). */
  payload: unknown;
  generatedAt: Date;
  /** Hard expiry, used as a safety net when version tracking fails. */
  expiresAt: Date;
}

const DashboardCacheSchema = new Schema<IDashboardCache>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    version: {
      type: String,
      required: true,
      default: "",
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
    },
    generatedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    collection: "dashboard_cache",
  },
);

export const DashboardCache = model<IDashboardCache>(
  "DashboardCache",
  DashboardCacheSchema,
);
