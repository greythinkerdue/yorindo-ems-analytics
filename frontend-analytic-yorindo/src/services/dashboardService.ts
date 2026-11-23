import { api } from "@/services/api";

export interface DashboardKpis {
  activeEvents: number;
  totalEvents: number;
  totalRegistrations: number;
  approvalRate: number;
  attendanceRate: number;
  pendingApprovals: number;
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

export interface DashboardOverview {
  kpis: DashboardKpis;
  watchlist: DashboardWatchItem[];
  audience: {
    topIndustries: Array<{ name: string; count: number }>;
    topCities: Array<{ name: string; count: number }>;
  };
  trend: Array<{ date: string; count: number }>;
  nextEvent: {
    eventId: string;
    title: string;
    eventDate: string;
    status: string;
    industry: string | null;
    daysUntil: number;
  } | null;
  dataUpdatedAt: string;
  generatedAt: string;
}

export interface DashboardOperationsBrief {
  focus: string;
  reason: string;
  actions: string[];
  generatedAt: string;
  dataUpdatedAt: string;
  cached: boolean;
}

export const fetchDashboardOverview = () =>
  api.get<DashboardOverview>(
    `/api/v1/analytics/overview?ts=${Date.now()}`,
  );

export const fetchDashboardOperationsBrief = (refresh = false) =>
  api.get<DashboardOperationsBrief>(
    `/api/v1/analytics/operations-brief${refresh ? "?refresh=1" : ""}`,
  );
