/**
 * @file scripts/complete-ticket-delivery.ts
 * @description One-off data completion: mark outstanding approved/checked-in
 * tickets as "sent" WITHOUT sending real emails (the local data is dummy).
 *
 * A few events are intentionally skipped so the dashboard still has events
 * with incomplete ticket delivery. Safe to run repeatedly: already-sent
 * tickets no longer match the filter.
 */

import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.ts";
import { Event, Registration } from "../models/index.ts";
import { bumpEventMetrics } from "../services/event-metric-rollup.service.ts";

/** 3 events with the most outstanding tickets are left incomplete on purpose. */
const SKIP_EVENT_IDS = new Set([
  "6affab3d4c73054686daa4a1", // Automotive Industry Networking Night (12)
  "6b044a4f12229797111c6dd7", // Dyandra Promosindo Community Day 2026 (10)
  "6affab3d4c73054686daa499", // Annual HR Summit 2025 (9)
]);

const OUTSTANDING_TICKET_FILTER = {
  $or: [
    { "ticketDelivery.status": { $ne: "sent" } },
    { "ticketDelivery.status": { $exists: false } },
  ],
};

await connectDB();

try {
  const events = await Event.find({}).select("title").lean();
  const eventTitles = new Map(events.map((event) => [String(event._id), event.title]));

  const groups = await Registration.aggregate<{
    _id: mongoose.Types.ObjectId;
    count: number;
  }>([
    { $match: OUTSTANDING_TICKET_FILTER },
    { $group: { _id: "$eventId", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  if (groups.length === 0) {
    console.log("Tidak ada tiket yang perlu ditandai sent.");
    process.exitCode = 0;
  } else {
    const now = new Date();
    let totalUpdated = 0;

    for (const group of groups) {
      const eventId = String(group._id);
      const title = eventTitles.get(eventId) ?? "(event tidak ditemukan)";

      if (SKIP_EVENT_IDS.has(eventId)) {
        console.log(`LEWAT (sengaja) | ${String(group.count).padStart(3)} | ${title}`);
        continue;
      }

      const result = await Registration.updateMany(
        { ...OUTSTANDING_TICKET_FILTER, eventId: group._id },
        {
          $set: {
            "ticketDelivery.status": "sent",
            "ticketDelivery.lastAttemptAt": now,
            "ticketDelivery.sentAt": now,
            "ticketDelivery.failedAt": null,
            "ticketDelivery.failureReason": null,
            // Mengubah updatedAt juga menginvalidasi cache insight per event.
            updatedAt: now,
          },
          $inc: { "ticketDelivery.attempts": 1 },
        },
      );

      // Jaga rollup tetap sinkron; bumpAnalyticsVersion() ikut membatalkan
      // cache dashboard overview + operations brief.
      if (result.modifiedCount > 0) {
        await bumpEventMetrics(group._id, {
          ticketsNotSent: -result.modifiedCount,
        });
      }

      totalUpdated += result.modifiedCount;
      console.log(`SENT | ${String(result.modifiedCount).padStart(3)} | ${title}`);
    }

    console.log(JSON.stringify({ totalUpdated, skippedEvents: SKIP_EVENT_IDS.size }, null, 2));
  }
} finally {
  await mongoose.connection.close();
}
