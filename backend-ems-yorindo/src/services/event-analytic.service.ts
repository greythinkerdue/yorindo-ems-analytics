/**
 * @file services/event-analytic.service.ts
 * @description Analytics queries for event participant metrics.
 */

import { Event, Registration } from "../models/index.ts";
import { Types } from "mongoose";
import { STATUS } from "../models/constants/enums.ts";

export interface EventParticipantAnalyticsSummary {
  eventId: string;
  totalPending: number;
  totalRegistrations: number;
  totalApproved: number;
  totalAttendance: number;
  totalRejected: number;
  attendanceRate: number;
}

export interface EventAnalyticsEventContext {
  title: string;
  date: string;
  status: string;
  industry: string | null;
  location: string | null;
}

export interface EventAnalyticsBenchmark {
  eventsCompared: number;
  averageAttendanceRate: number;
  averageApprovalRate: number;
}

export interface EventAnalyticsOverview {
  eventId: string;
  month: string;
  event: EventAnalyticsEventContext;
  summary: EventParticipantAnalyticsSummary;
  statusBreakdown: Record<string, number>;
  registrationsOverTime: Array<{ date: string; count: number }>;
  topIndustries: Array<{ name: string; count: number }>;
  topCities: Array<{ name: string; count: number }>;
  topRejectionReasons: Array<{ reason: string; count: number }>;
  ticketDeliveryBreakdown: Array<{ status: string; count: number }>;
  benchmark: EventAnalyticsBenchmark;
}

const APPROVED_STATUSES = ["approved", "checked_in", "check-in"] as const;
const ATTENDANCE_STATUSES = ["checked_in", "check-in"] as const;
const TIMEZONE = "Asia/Jakarta";

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function parseMonthRange(month?: string): { start: Date; end: Date; label: string } {
  const now = new Date();
  const [yearStr, monthStr] = month ? month.split("-") : [];
  const year = month ? Number(yearStr) : now.getFullYear();
  const monthIndex = month ? Number(monthStr) - 1 : now.getMonth();
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 1);
  const label = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  return { start, end, label };
}

function buildDailySeries(
  start: Date,
  end: Date,
  counts: Record<string, number>,
): Array<{ date: string; count: number }> {
  const result: Array<{ date: string; count: number }> = [];
  const cursor = new Date(start);
  while (cursor < end) {
    const dateKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    result.push({ date: dateKey, count: counts[dateKey] ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

/**
 * Rata-rata event LAIN sebagai pembanding. Tanpa ini AI mudah mengarang
 * "kinerja bagus/buruk" padahal tidak punya konteks lintas event.
 */
async function getEventAnalyticsBenchmark(
  eventId: string,
): Promise<EventAnalyticsBenchmark> {
  const rows = (await Registration.aggregate([
    { $match: { eventId: { $ne: new Types.ObjectId(eventId) } } },
    {
      $group: {
        _id: "$eventId",
        registrations: { $sum: 1 },
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
      },
    },
  ])) as Array<{
    registrations: number;
    approved: number;
    attendance: number;
  }>;

  const usable = rows.filter(
    (row) => row.registrations > 0 && row.approved > 0,
  );
  if (usable.length === 0) {
    return {
      eventsCompared: 0,
      averageAttendanceRate: 0,
      averageApprovalRate: 0,
    };
  }

  const average = (values: number[]) =>
    values.reduce((total, value) => total + value, 0) / values.length;

  return {
    eventsCompared: usable.length,
    averageAttendanceRate: round1(
      average(usable.map((row) => (row.attendance / row.approved) * 100)),
    ),
    averageApprovalRate: round1(
      average(usable.map((row) => (row.approved / row.registrations) * 100)),
    ),
  };
}

export async function getEventParticipantAnalytics(
  eventId: string,
): Promise<EventParticipantAnalyticsSummary | null> {
  const eventExists = await Event.exists({ _id: eventId });
  if (!eventExists) return null;

  const [
    totalPending,
    totalRegistrations,
    totalApproved,
    totalAttendance,
    totalRejected,
  ] = await Promise.all([
    Registration.countDocuments({ eventId, status: "pending" }),
    Registration.countDocuments({ eventId }),
    Registration.countDocuments({
      eventId,
      status: { $in: APPROVED_STATUSES },
    }),
    Registration.countDocuments({
      eventId,
      status: { $in: ATTENDANCE_STATUSES },
    }),
    Registration.countDocuments({ eventId, status: "rejected" }),
  ]);

  const attendanceRate =
    totalApproved > 0 ? (totalAttendance / totalApproved) * 100 : 0;

  return {
    eventId,
    totalPending,
    totalRegistrations,
    totalApproved,
    totalAttendance,
    totalRejected,
    attendanceRate: round1(attendanceRate),
  };
}

export async function getEventAnalyticsOverview(
  eventId: string,
  month?: string,
): Promise<EventAnalyticsOverview | null> {
  const eventObjectId = new Types.ObjectId(eventId);
  const { start, end, label } = parseMonthRange(month);

  const [
    eventDoc,
    summary,
    statusAgg,
    registrationsAgg,
    topIndustriesAgg,
    topCitiesAgg,
    rejectionReasonsAgg,
    ticketDeliveryAgg,
    benchmark,
  ] = await Promise.all([
    Event.findById(eventId).lean(),
    getEventParticipantAnalytics(eventId),
    Registration.aggregate([
      { $match: { eventId: eventObjectId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Registration.aggregate([
      {
        $match: {
          eventId: eventObjectId,
          createdAt: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: TIMEZONE },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Registration.aggregate([
      { $match: { eventId: eventObjectId } },
      { $group: { _id: "$industrySnapshot.name", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
    Registration.aggregate([
      { $match: { eventId: eventObjectId } },
      { $group: { _id: "$citySnapshot.name", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
    Registration.aggregate([
      {
        $match: {
          eventId: eventObjectId,
          status: "rejected",
          "approval.rejectionReason": { $nin: [null, ""] },
        },
      },
      { $group: { _id: "$approval.rejectionReason", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 3 },
    ]),
    Registration.aggregate([
      { $match: { eventId: eventObjectId } },
      { $group: { _id: "$ticketDelivery.status", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    getEventAnalyticsBenchmark(eventId),
  ]);

  if (!summary || !eventDoc) return null;

  const statusBreakdown: Record<string, number> = {};
  for (const status of STATUS.REGISTRATION) {
    statusBreakdown[status] = 0;
  }

  for (const row of statusAgg as Array<{ _id: string; count: number }>) {
    if (row._id === "check-in") {
      statusBreakdown.checked_in = (statusBreakdown.checked_in ?? 0) + row.count;
      continue;
    }
    statusBreakdown[row._id] = row.count;
  }

  const registrationsMap: Record<string, number> = {};
  for (const row of registrationsAgg as Array<{ _id: string; count: number }>) {
    registrationsMap[row._id] = row.count;
  }

  const registrationsOverTime = buildDailySeries(start, end, registrationsMap);

  return {
    eventId,
    month: label,
    event: {
      title: eventDoc.title,
      date: eventDoc.eventDate
        ? new Date(eventDoc.eventDate).toISOString()
        : "",
      status: eventDoc.status,
      industry: eventDoc.industry?.name ?? null,
      location: eventDoc.location ?? null,
    },
    summary,
    statusBreakdown,
    registrationsOverTime,
    topIndustries: (topIndustriesAgg as Array<{ _id: string; count: number }>).map(
      (row) => ({ name: row._id ?? "Unknown", count: row.count }),
    ),
    topCities: (topCitiesAgg as Array<{ _id: string; count: number }>).map(
      (row) => ({ name: row._id ?? "Unknown", count: row.count }),
    ),
    topRejectionReasons: (
      rejectionReasonsAgg as Array<{ _id: string; count: number }>
    ).map((row) => ({ reason: row._id ?? "Lainnya", count: row.count })),
    ticketDeliveryBreakdown: (
      ticketDeliveryAgg as Array<{ _id: string; count: number }>
    ).map((row) => ({ status: row._id ?? "unknown", count: row.count })),
    benchmark,
  };
}
