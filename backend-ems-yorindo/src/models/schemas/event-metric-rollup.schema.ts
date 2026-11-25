/**
 * @file schemas/event-metric-rollup.schema.ts
 * @description Per-event counter rollup used by the dashboard and benchmarks.
 *
 * Instead of scanning the whole registrations collection for every page view,
 * these counters are incremented at write time and read once per request.
 */

import { Schema, model, Types } from "mongoose";

export interface IEventMetricRollup {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  /** All registrations, including rejected ones. */
  registrations: number;
  pending: number;
  approved: number;
  attendance: number;
  rejected: number;
  /** ticketDelivery.status !== "sent" (missing counts as not sent). */
  ticketsNotSent: number;
  updatedAt: Date;
}

const EventMetricRollupSchema = new Schema<IEventMetricRollup>(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      unique: true,
    },
    registrations: { type: Number, required: true, default: 0 },
    pending: { type: Number, required: true, default: 0 },
    approved: { type: Number, required: true, default: 0 },
    attendance: { type: Number, required: true, default: 0 },
    rejected: { type: Number, required: true, default: 0 },
    ticketsNotSent: { type: Number, required: true, default: 0 },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  {
    collection: "event_metric_rollups",
  },
);

export const EventMetricRollup = model<IEventMetricRollup>(
  "EventMetricRollup",
  EventMetricRollupSchema,
);
