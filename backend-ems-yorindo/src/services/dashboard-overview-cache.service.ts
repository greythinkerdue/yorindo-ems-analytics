/**
 * @file services/dashboard-overview-cache.service.ts
 * @description Shared, DB-backed cache for the global dashboard overview.
 *
 * Both `/analytics/overview` and `/analytics/operations-brief` need the same
 * overview. Computing it twice per page view doubles the aggregate work. This
 * wrapper computes it once, stores the result in MongoDB and lets both
 * endpoints read the same cached payload.
 */

import {
  DashboardCache,
  DASHBOARD_OVERVIEW_CACHE_KEY,
} from "../models/index.ts";
import {
  getDashboardOverview,
  type DashboardOverview,
} from "./dashboard.service.ts";
import { getAnalyticsVersion } from "./event-metric-rollup.service.ts";

/** KPI data may be up to one minute old without any practical impact. */
const OVERVIEW_TTL_MS = 60_000;

/** Singleflight: two parallel cache misses must not trigger two aggregations. */
let inflight: Promise<DashboardOverview> | null = null;

function isFresh(expiresAt: Date): boolean {
  return expiresAt.getTime() > Date.now();
}

export async function getCachedDashboardOverview(
  refresh = false,
): Promise<DashboardOverview> {
  if (!refresh) {
    // A write bumps the global data version, so a still-TTL-fresh payload is
    // discarded immediately when any dashboard-facing data has changed.
    const [cached, dataVersion] = await Promise.all([
      DashboardCache.findOne({
        key: DASHBOARD_OVERVIEW_CACHE_KEY,
      })
        .select("payload expiresAt version")
        .lean<{
          payload: DashboardOverview;
          expiresAt: Date;
          version?: string;
        } | null>(),
      getAnalyticsVersion(),
    ]);

    // No meta document yet (fresh DB): TTL alone decides freshness. Once a
    // write creates the version document, any mismatch invalidates instantly.
    if (
      cached &&
      isFresh(new Date(cached.expiresAt)) &&
      (dataVersion === null || cached.version === dataVersion)
    ) {
      return cached.payload;
    }
  }

  if (inflight) return inflight;

  inflight = (async () => {
    const [overview, dataVersion] = await Promise.all([
      getDashboardOverview(),
      getAnalyticsVersion(),
    ]);

    await DashboardCache.findOneAndUpdate(
      { key: DASHBOARD_OVERVIEW_CACHE_KEY },
      {
        $set: {
          payload: overview,
          version: dataVersion ?? overview.dataUpdatedAt,
          generatedAt: new Date(),
          expiresAt: new Date(Date.now() + OVERVIEW_TTL_MS),
        },
      },
      { upsert: true },
    );

    return overview;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
