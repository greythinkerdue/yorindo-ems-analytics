/**
 * @file event-ai-insight-cache.schema.ts
 * @description Cached AI insight payload for an event's survey analytics.
 *
 * This cache prevents regenerating AI insight every time the analytics page is opened.
 * The client can force regeneration via `?refresh=1` on the endpoint.
 */

import { Schema, model, Types } from "mongoose";

export interface IEventAiInsightCache {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  /** Parsed insight payload (summary, findings, actions, watchout). */
  insight: unknown;
  /** Number of responses at generation time, kept for the client payload. */
  totalResponses: number;
  /** Signature of the source data. A mismatch means the insight is stale. */
  sourceSignature: string;
  generatedAt: Date;
}

const EventAiInsightCacheSchema = new Schema<IEventAiInsightCache>(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      unique: true,
    },
    insight: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
    },
    totalResponses: {
      type: Number,
      required: true,
      default: 0,
    },
    sourceSignature: {
      type: String,
      required: true,
      default: "",
    },
    generatedAt: {
      type: Date,
      required: true,
    },
  },
  {
    collection: "event_ai_insight_cache",
  },
);

export const EventAiInsightCache = model<IEventAiInsightCache>(
  "EventAiInsightCache",
  EventAiInsightCacheSchema,
);

