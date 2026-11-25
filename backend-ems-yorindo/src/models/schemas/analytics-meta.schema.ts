/**
 * @file schemas/analytics-meta.schema.ts
 * @description Tiny metadata document describing the global analytics data version.
 *
 * Every write that changes dashboard-facing data bumps `version`. Readers can
 * therefore invalidate derived caches with a single cheap query instead of
 * sorting whole collections by updatedAt.
 */

import { Schema, model, Types } from "mongoose";

export const ANALYTICS_META_KEY = "global";

export interface IAnalyticsMeta {
  _id: Types.ObjectId;
  key: string;
  /** ISO timestamp of the last data mutation. */
  version: string;
  /** True only after the one-off backfill has populated every event rollup. */
  rollupsBackfilled: boolean;
  updatedAt: Date;
}

const AnalyticsMetaSchema = new Schema<IAnalyticsMeta>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    version: {
      type: String,
      required: true,
    },
    rollupsBackfilled: {
      type: Boolean,
      required: true,
      default: false,
    },
    updatedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
  },
  {
    collection: "analytics_meta",
  },
);

export const AnalyticsMeta = model<IAnalyticsMeta>(
  "AnalyticsMeta",
  AnalyticsMetaSchema,
);
