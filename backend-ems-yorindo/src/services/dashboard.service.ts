/**
 * @file services/dashboard.service.ts
 * @description Global, cross-event analytics for the command center dashboard.
 */

import { Event, Registration } from "../models/index.ts";
import {
  getAllEventMetrics,
  getAnalyticsVersion,
  type EventMetricRow,
} from "./event-metric-rollup.service.ts";

const ACTIVE_STATUSES = ["upcoming", "registration", "ongoing"] as const;
const TIMEZONE = "Asia/Jakarta";

export interface DashboardKpis {
  activeEvents: number;
  totalEvents: number;
  totalRegistrations: number;
  approvalRate: number;
  attendanceRate: number;
  pendingApprovals: number;
  totalRejected: number;
  ticketsNotSent: number;
}

export interface DashboardWatchItem {
  eventId: string;
  title: string;
  status: string;
  eventDate: string;
  industry: string | null;
  registrations: number;
  approvalRate: number;
  attendanceRate: number;
  pending: number;
  ticketsNotSent: number;
  attention: "high" | "medium" | "low";
  reason: string;
}

export interface DashboardAudience {
  topIndustries: Array<{ name: string; count: number }>;
  topCities: Array<{ name: string; count: number }>;
}

export interface DashboardNextEvent {
  eventId: string;
  title: string;
  eventDate: string;
  status: string;
  industry: string | null;
  daysUntil: number;
}

export interface DashboardOverview {
  kpis: DashboardKpis;
  watchlist: DashboardWatchItem[];
  audience: DashboardAudience;
  trend: Array<{ date: string; count: number }>;
  nextEvent: DashboardNextEvent | null;
  /** Waktu data sumber terakhir berubah, bukan waktu request. */
  dataUpdatedAt: string;
  generatedAt: string;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function toIsoDate(value: unknown): string {
  if (!value) return "";
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function buildTrend(
  counts: Map<string, number>,
  now: Date,
): Array<{ date: string; count: number }> {
  const result: Array<{ date: string; count: number }> = [];
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - 29);

  for (let index = 0; index < 30; index += 1) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    result.push({ date: key, count: counts.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

function buildAttention(
  status: string,
  row: EventMetricRow,
  approvalRate: number,
  attendanceRate: number,
): { attention: DashboardWatchItem["attention"]; reason: string } {
  if (status === "cancelled") {
    return {
      attention: "high",
      reason: `Event dibatalkan; ${row.registrations} pendaftaran perlu dibersihkan.`,
    };
  }

  if (row.pending > 0) {
    return {
      attention: row.pending >= 3 ? "high" : "medium",
      reason: `${row.pending} approval tertunda.`,
    };
  }

  if (row.ticketsNotSent > 0) {
    const ratio = row.registrations > 0 ? row.ticketsNotSent / row.registrations : 0;
    return {
      attention: ratio >= 0.5 ? "high" : "medium",
      reason: `Tiket belum dikirim ke ${row.ticketsNotSent} peserta.`,
    };
  }

  if (ACTIVE_STATUSES.includes(status as (typeof ACTIVE_STATUSES)[number]) && approvalRate < 50) {
    return {
      attention: "medium",
      reason: `Approval ${approvalRate.toFixed(1)}% perlu dipercepat.`,
    };
  }

  if ((status === "done" || status === "ongoing") && attendanceRate < 40) {
    return {
      attention: "medium",
      reason: `Kehadiran ${attendanceRate.toFixed(1)}% perlu ditindaklanjuti.`,
    };
  }

  return { attention: "low", reason: "Tidak ada tindakan mendesak." };
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 29);
  start.setHours(0, 0, 0, 0);

  // Per-event counters come from the rollup collection instead of a full
  // registrations scan. Audience/trend views still need snapshots/createdAt,
  // so those aggregations remain (they are bounded and indexed separately).
  const [
    events,
    metricRows,
    industryRows,
    cityRows,
    trendRows,
    metaVersion,
  ] = await Promise.all([
      Event.find({})
        .select("title status eventDate industry")
        .lean<
          Array<{
            _id: { toString(): string };
            title: string;
            status: string;
            eventDate: Date;
            industry?: { name?: string | null } | null;
          }>
        >(),
      getAllEventMetrics(),
      Registration.aggregate([
        { $group: { _id: "$industrySnapshot.name", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
      Registration.aggregate([
        { $group: { _id: "$citySnapshot.name", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
      Registration.aggregate([
        { $match: { createdAt: { $gte: start } } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$createdAt",
                timezone: TIMEZONE,
              },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      getAnalyticsVersion(),
    ]);

  // Before the first write/backfill there is no meta document yet; fall back
  // to the source collections so `dataUpdatedAt` stays accurate on fresh DBs.
  let dataUpdatedAt = now;
  if (!metaVersion) {
    const [latestEventUpdate, latestRegistrationUpdate] = await Promise.all([
      Event.findOne({})
        .select("updatedAt")
        .sort({ updatedAt: -1 })
        .lean<{ updatedAt: Date } | null>(),
      Registration.findOne({})
        .select("updatedAt")
        .sort({ updatedAt: -1 })
        .lean<{ updatedAt: Date } | null>(),
    ]);
    const dataUpdateTimes = [
      latestEventUpdate?.updatedAt,
      latestRegistrationUpdate?.updatedAt,
    ]
      .filter((value): value is Date => Boolean(value))
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value) && value <= now.getTime());
    if (dataUpdateTimes.length) {
      dataUpdatedAt = new Date(Math.max(...dataUpdateTimes));
    }
  } else {
    const parsed = new Date(metaVersion);
    if (!Number.isNaN(parsed.getTime())) dataUpdatedAt = parsed;
  }

  const rowsByEvent = new Map<string, EventMetricRow>();
  for (const row of metricRows) {
    rowsByEvent.set(row.eventId, row);
  }

  const totalRegistrations = metricRows.reduce(
    (total, row) => total + row.registrations,
    0,
  );
  const totalApproved = metricRows.reduce(
    (total, row) => total + row.approved,
    0,
  );
  const totalAttendance = metricRows.reduce(
    (total, row) => total + row.attendance,
    0,
  );
  const pendingApprovals = metricRows.reduce(
    (total, row) => total + row.pending,
    0,
  );
  const totalRejected = metricRows.reduce(
    (total, row) => total + row.rejected,
    0,
  );
  const ticketsNotSent = metricRows.reduce(
    (total, row) => total + row.ticketsNotSent,
    0,
  );

  const kpis: DashboardKpis = {
    activeEvents: events.filter((event) =>
      ACTIVE_STATUSES.includes(event.status as (typeof ACTIVE_STATUSES)[number]),
    ).length,
    totalEvents: events.length,
    totalRegistrations,
    approvalRate: round1(
      totalRegistrations > 0 ? (totalApproved / totalRegistrations) * 100 : 0,
    ),
    attendanceRate: round1(
      totalApproved > 0 ? (totalAttendance / totalApproved) * 100 : 0,
    ),
    pendingApprovals,
    totalRejected,
    ticketsNotSent,
  };

  const attentionRank: Record<DashboardWatchItem["attention"], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  const watchlist: DashboardWatchItem[] = events
    .map((event) => {
      const eventId = event._id.toString();
      const row = rowsByEvent.get(eventId);
      if (!row || row.registrations === 0) return null;

      const approvalRate = round1((row.approved / row.registrations) * 100);
      const attendanceRate = round1(
        row.approved > 0 ? (row.attendance / row.approved) * 100 : 0,
      );
      const { attention, reason } = buildAttention(
        event.status,
        row,
        approvalRate,
        attendanceRate,
      );

      return {
        eventId,
        title: event.title,
        status: event.status,
        eventDate: toIsoDate(event.eventDate),
        industry: event.industry?.name ?? null,
        registrations: row.registrations,
        approvalRate,
        attendanceRate,
        pending: row.pending,
        ticketsNotSent: row.ticketsNotSent,
        attention,
        reason,
      } satisfies DashboardWatchItem;
    })
    .filter((item): item is DashboardWatchItem => item !== null)
    .sort((a, b) => {
      const rank = attentionRank[a.attention] - attentionRank[b.attention];
      if (rank !== 0) return rank;
      if (b.pending !== a.pending) return b.pending - a.pending;
      if (b.ticketsNotSent !== a.ticketsNotSent) {
        return b.ticketsNotSent - a.ticketsNotSent;
      }
      return a.eventDate.localeCompare(b.eventDate);
    });

  const trendCounts = new Map<string, number>();
  for (const row of trendRows as Array<{ _id: string; count: number }>) {
    trendCounts.set(row._id, row.count);
  }

  const upcoming = events
    .filter(
      (event) =>
        ACTIVE_STATUSES.includes(
          event.status as (typeof ACTIVE_STATUSES)[number],
        ) &&
        event.status !== "ongoing" &&
        new Date(event.eventDate).getTime() > now.getTime(),
    )
    .sort(
      (a, b) =>
        new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime(),
    )[0];

  const nextEvent: DashboardNextEvent | null = upcoming
    ? {
        eventId: upcoming._id.toString(),
        title: upcoming.title,
        eventDate: toIsoDate(upcoming.eventDate),
        status: upcoming.status,
        industry: upcoming.industry?.name ?? null,
        daysUntil: Math.max(
          1,
          Math.ceil(
            (new Date(upcoming.eventDate).getTime() - now.getTime()) /
              86_400_000,
          ),
        ),
      }
    : null;

  return {
    kpis,
    watchlist,
    audience: {
      topIndustries: (industryRows as Array<{ _id: string; count: number }>).map(
        (row) => ({ name: row._id ?? "Lainnya", count: row.count }),
      ),
      topCities: (cityRows as Array<{ _id: string; count: number }>).map(
        (row) => ({ name: row._id ?? "Lainnya", count: row.count }),
      ),
    },
    trend: buildTrend(trendCounts, now),
    nextEvent,
    dataUpdatedAt: dataUpdatedAt.toISOString(),
    generatedAt: now.toISOString(),
  };
}
