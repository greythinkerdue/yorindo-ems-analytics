import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  RefreshCw,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchDashboardOperationsBrief,
  fetchDashboardOverview,
  type DashboardOperationsBrief,
  type DashboardOverview,
  type DashboardWatchItem,
} from "@/services/dashboardService";
import { formatDate, formatNumber, formatShortDate } from "@/utils/formatters";

type Attention = DashboardWatchItem["attention"];

const attentionStyle: Record<Attention, string> = {
  high: "border border-rose-200 bg-rose-50 text-rose-700",
  medium: "border border-amber-200 bg-amber-50 text-amber-700",
  low: "border border-emerald-200 bg-emerald-50 text-emerald-700",
};

const attentionLabel: Record<Attention, string> = {
  high: "Perlu tindakan",
  medium: "Dipantau",
  low: "Aman",
};

type WatchFilter = "all" | Attention;

const WATCH_FILTERS: Array<{
  value: WatchFilter;
  label: string;
  dot: string;
  active: string;
}> = [
  {
    value: "all",
    label: "Semua event",
    dot: "bg-[#94A3B8]",
    active: "bg-[#0A2647] text-white",
  },
  {
    value: "high",
    label: "Perlu tindakan",
    dot: "bg-rose-500",
    active: "bg-rose-50 text-rose-700",
  },
  {
    value: "medium",
    label: "Dipantau",
    dot: "bg-amber-500",
    active: "bg-amber-50 text-amber-700",
  },
  {
    value: "low",
    label: "Aman",
    dot: "bg-emerald-500",
    active: "bg-emerald-50 text-emerald-700",
  },
];

/** Jumlah entri Portfolio Health per halaman. */
const WATCH_PAGE_SIZE = 3;

/** Warna atensi untuk event berikutnya berdasarkan jarak hari. */
function nextEventUrgency(daysUntil: number) {
  if (daysUntil <= 7) {
    return {
      label: "Mepet",
      card: "border-rose-200 bg-rose-50/70",
      icon: "bg-rose-100 text-rose-700",
      bar: "bg-rose-100 text-rose-700",
      badge: "bg-rose-100 text-rose-700",
      dot: "bg-rose-500",
      link: "text-rose-700",
    };
  }
  if (daysUntil <= 30) {
    return {
      label: "Dipantau",
      card: "border-amber-200 bg-amber-50/70",
      icon: "bg-amber-100 text-amber-700",
      bar: "bg-amber-100 text-amber-700",
      badge: "bg-amber-100 text-amber-700",
      dot: "bg-amber-500",
      link: "text-amber-700",
    };
  }
  return {
    label: "Terjadwal",
    card: "border-[#D7E1F0] bg-white",
    icon: "bg-[#EDF3FF] text-[#0A2647]",
    bar: "bg-[#F5F8FF] text-[#0A2647]",
    badge: "bg-[#EDF3FF] text-[#0A2647]",
    dot: "bg-[#2F5BFF]",
    link: "text-[#1A3FA8]",
  };
}

function safeDate(value: string): string {
  return value ? formatDate(value) : "-";
}

function safeCompactDate(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date
    .toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Jakarta",
    })
    .replace(" pukul ", ", ")
    .replace(".", ":");
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] bg-[#F5F8FF] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7B8CA3]">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-[#0A2647]">{value}</p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof Activity;
}) {
  return (
    <div className="rounded-[16px] border border-[#D7E1F0] bg-white px-4 py-3 shadow-[0_6px_16px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7B8CA3]">
          {label}
        </p>
        <Icon size={14} className="shrink-0 text-[#7B8CA3]" />
      </div>
      <p className="mt-2 text-xl font-bold tracking-[-0.03em] text-[#0A2647]">
        {value}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-[#7B8CA3]">{note}</p>
    </div>
  );
}

export default function DashboardHome() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [overviewError, setOverviewError] = useState("");
  const [isLoadingOverview, setIsLoadingOverview] = useState(true);

  const [brief, setBrief] = useState<DashboardOperationsBrief | null>(null);
  const [briefError, setBriefError] = useState("");
  const [isLoadingBrief, setIsLoadingBrief] = useState(false);

  const [watchFilter, setWatchFilter] = useState<WatchFilter>("all");
  const [watchPage, setWatchPage] = useState(1);

  const loadOverview = async () => {
    setIsLoadingOverview(true);
    setOverviewError("");
    const result = await fetchDashboardOverview();
    setIsLoadingOverview(false);

    if (result.error) {
      setOverviewError(result.message);
      setOverview(null);
      return;
    }
    setOverview(result.data ?? null);
  };

  const loadBrief = async () => {
    setIsLoadingBrief(true);
    setBriefError("");
    const result = await fetchDashboardOperationsBrief();
    setIsLoadingBrief(false);

    if (result.error) {
      setBriefError(result.message);
      return;
    }
    setBrief(result.data ?? null);
  };

  useEffect(() => {
    void loadOverview();
    void loadBrief();
  }, []);

  const allWatchlist = overview?.watchlist ?? [];
  const watchCounts = useMemo<Record<WatchFilter, number>>(
    () => ({
      all: allWatchlist.length,
      high: allWatchlist.filter((item) => item.attention === "high").length,
      medium: allWatchlist.filter((item) => item.attention === "medium").length,
      low: allWatchlist.filter((item) => item.attention === "low").length,
    }),
    [allWatchlist],
  );
  const visibleWatchlist = useMemo(() => {
    const items =
      watchFilter === "all"
        ? allWatchlist
        : allWatchlist.filter((item) => item.attention === watchFilter);
    if (watchFilter === "all") {
      return [...items].sort(
        (a, b) =>
          new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime(),
      );
    }
    return items;
  }, [watchFilter, allWatchlist]);

  const watchTotalPages = Math.max(
    1,
    Math.ceil(visibleWatchlist.length / WATCH_PAGE_SIZE),
  );
  const safeWatchPage = Math.min(watchPage, watchTotalPages);
  const pagedWatchlist = visibleWatchlist.slice(
    (safeWatchPage - 1) * WATCH_PAGE_SIZE,
    safeWatchPage * WATCH_PAGE_SIZE,
  );

  const maxIndustry = Math.max(
    1,
    ...(overview?.audience.topIndustries ?? []).map((item) => item.count),
  );
  const maxCity = Math.max(
    1,
    ...(overview?.audience.topCities ?? []).map((item) => item.count),
  );

  const trendData = useMemo(
    () =>
      (overview?.trend ?? []).map((item) => ({
        ...item,
        label: formatShortDate(item.date),
      })),
    [overview?.trend],
  );

  const trendAverage = useMemo(
    () =>
      trendData.length
        ? trendData.reduce((sum, item) => sum + item.count, 0) /
          trendData.length
        : 0,
    [trendData],
  );
  const trendAverageLabel = trendAverage.toFixed(1).replace(".", ",");

  const kpis = overview?.kpis;
  const nextTone = overview?.nextEvent
    ? nextEventUrgency(overview.nextEvent.daysUntil)
    : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[#D7E1F0] pb-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="text-base font-semibold tracking-[-0.02em] text-[#0A2647]">
            Command Center
          </h1>
          <p className="text-[11px] text-[#7B8CA3]">
            {overview
              ? `Last updated at ${safeCompactDate(overview.dataUpdatedAt)}`
              : "Ringkasan operasional seluruh event"}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#D7E1F0] bg-white px-2 py-1 text-[10px] font-medium text-[#5B6B7F]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
            Agregat
          </span>
          <button
            type="button"
            onClick={() => void loadOverview()}
            disabled={isLoadingOverview}
            title="Muat ulang data"
            aria-label="Muat ulang data"
            className="inline-flex items-center gap-1 rounded-full border border-[#D7E1F0] bg-white px-2 py-1 text-[10px] font-semibold text-[#0A2647] transition hover:bg-[#F5F8FF] disabled:opacity-60"
          >
            <RefreshCw
              size={12}
              className={isLoadingOverview ? "animate-spin" : ""}
            />
            Muat ulang
          </button>
        </div>
      </header>

      {overviewError ? (
        <div className="rounded-[18px] border border-[#FCA5A5] bg-[#FEF2F2] px-6 py-5 text-sm text-[#991B1B]">
          {overviewError}
        </div>
      ) : null}

      {isLoadingOverview || !kpis ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={`kpi-skeleton-${index}`}
              className="h-[86px] animate-pulse rounded-[16px] border border-[#D7E1F0] bg-white"
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard
            label="Event aktif"
            value={formatNumber(kpis.activeEvents)}
            note={`dari ${formatNumber(kpis.totalEvents)} event`}
            icon={CalendarClock}
          />
          <KpiCard
            label="Registrasi"
            value={formatNumber(kpis.totalRegistrations)}
            note="lintas seluruh event"
            icon={Users}
          />
          <KpiCard
            label="Approval"
            value={`${kpis.approvalRate.toFixed(1)}%`}
            note="dari total pendaftar"
            icon={CheckCircle2}
          />
          <KpiCard
            label="Kehadiran"
            value={`${kpis.attendanceRate.toFixed(1)}%`}
            note="dari peserta disetujui"
            icon={Activity}
          />
          <KpiCard
            label="Pending approval"
            value={formatNumber(kpis.pendingApprovals)}
            note="menunggu keputusan"
            icon={Clock3}
          />
          <KpiCard
            label="Tiket belum dikirim"
            value={formatNumber(kpis.ticketsNotSent)}
            note="perlu didistribusikan"
            icon={Send}
          />
        </div>
      )}

      <div className="grid items-stretch gap-6 lg:grid-cols-3">
        <section className="flex h-full min-h-0 flex-col rounded-[24px] border border-[#D7E1F0] bg-white p-6 shadow-[0_12px_32px_rgba(10,38,71,0.06)] lg:col-span-2 lg:h-[600px]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#7B8CA3]">
                Portfolio Health
              </p>
              <h2 className="mt-1 text-lg font-semibold text-[#0A2647]">
                Event yang perlu perhatian
              </h2>
            </div>
            <div className="inline-flex flex-wrap rounded-[14px] border border-[#DCE5F2] bg-[#F8FAFD] p-1">
              {WATCH_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => {
                    setWatchFilter(filter.value);
                    setWatchPage(1);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-2 text-xs font-semibold transition ${
                    watchFilter === filter.value
                      ? filter.active
                      : "text-[#5B6B7F] hover:bg-white hover:text-[#0A2647]"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${filter.dot}`}
                  />
                  {filter.label}
                  <span
                    className={
                      watchFilter === filter.value
                        ? "opacity-80"
                        : "text-[#94A3B8]"
                    }
                  >
                    ({watchCounts[filter.value]})
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {isLoadingOverview ? (
              <div className="h-24 animate-pulse rounded-[18px] bg-[#F1F5FB]" />
            ) : visibleWatchlist.length === 0 ? (
              <div className="rounded-[18px] border border-dashed border-[#C9D7F3] bg-[#F8FAFF] px-5 py-8 text-center text-sm text-[#6B7280]">
                Tidak ada event yang perlu tindakan mendesak. Arsip seluruh event
                tetap tersedia di menu Event Management.
              </div>
            ) : (
              pagedWatchlist.map((item) => (
                <div
                  key={item.eventId}
                  className="rounded-[18px] border border-[#E3EBF7] bg-[#F8FAFF] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-[#0A2647]">
                          {item.title}
                        </p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${attentionStyle[item.attention]}`}
                        >
                          {attentionLabel[item.attention]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#7B8CA3]">
                        {item.status} • {safeDate(item.eventDate)} •{" "}
                        {item.industry ?? "General"}
                      </p>
                      <p className="mt-1 text-xs font-medium text-[#5B6B7F]">
                        {item.reason}
                      </p>
                    </div>
                    <Link
                      to={`/events/${item.eventId}/analytics`}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#DCE5F2] bg-white text-[#0A2647] transition hover:border-[#C9D7F3] hover:bg-[#F5F8FF]"
                      title="Buka analitik event"
                    >
                      <ArrowUpRight size={16} />
                    </Link>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric label="Pending" value={formatNumber(item.pending)} />
                    <Metric
                      label="Approval"
                      value={`${item.approvalRate.toFixed(1)}%`}
                    />
                    <Metric
                      label="Kehadiran"
                      value={`${item.attendanceRate.toFixed(1)}%`}
                    />
                    <Metric
                      label="Tiket"
                      value={`${formatNumber(item.ticketsNotSent)} belum`}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#E3EBF7] pt-4">
            <p className="text-xs text-[#7B8CA3]">
              {visibleWatchlist.length === 0
                ? "Tidak ada event untuk ditampilkan"
                : `Menampilkan ${
                    (safeWatchPage - 1) * WATCH_PAGE_SIZE + 1
                  }–${Math.min(
                    safeWatchPage * WATCH_PAGE_SIZE,
                    visibleWatchlist.length,
                  )} dari ${visibleWatchlist.length} event`}
            </p>
            <div className="inline-flex shrink-0 items-center gap-1 rounded-[12px] border border-[#DCE5F2] bg-[#F8FAFD] p-1">
              <button
                type="button"
                onClick={() => setWatchPage(Math.max(1, safeWatchPage - 1))}
                disabled={safeWatchPage <= 1}
                aria-label="Halaman sebelumnya"
                className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-[#0A2647] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="min-w-[44px] text-center text-xs font-semibold text-[#0A2647]">
                {safeWatchPage} / {watchTotalPages}
              </span>
              <button
                type="button"
                onClick={() =>
                  setWatchPage(Math.min(watchTotalPages, safeWatchPage + 1))
                }
                disabled={safeWatchPage >= watchTotalPages}
                aria-label="Halaman berikutnya"
                className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-[#0A2647] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </section>

        <div className="flex h-full min-h-0 flex-col gap-6 lg:h-[600px]">
          <section
            className={`shrink-0 rounded-[24px] border p-6 shadow-[0_12px_32px_rgba(10,38,71,0.06)] ${
              nextTone?.card ?? "border-[#D7E1F0] bg-white"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#7B8CA3]">
                Event berikutnya
              </p>
              {nextTone ? (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${nextTone.badge}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${nextTone.dot}`}
                  />
                  {nextTone.label}
                </span>
              ) : null}
            </div>
            {overview?.nextEvent ? (
              <div className="mt-4">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                    nextTone?.icon ?? "bg-[#EDF3FF] text-[#0A2647]"
                  }`}
                >
                  <CalendarClock size={22} />
                </div>
                <p className="mt-4 text-base font-semibold text-[#0A2647]">
                  {overview.nextEvent.title}
                </p>
                <p className="mt-1 text-xs text-[#7B8CA3]">
                  {safeDate(overview.nextEvent.eventDate)} •{" "}
                  {overview.nextEvent.industry ?? "General"}
                </p>
                <div
                  className={`mt-4 flex items-center justify-between rounded-[16px] px-4 py-3 ${
                    nextTone?.bar ?? "bg-[#F5F8FF]"
                  }`}
                >
                  <span
                    className={`text-sm font-semibold ${
                      nextTone?.link ?? "text-[#0A2647]"
                    }`}
                  >
                    {overview.nextEvent.daysUntil} hari lagi
                  </span>
                  <Link
                    to={`/events/${overview.nextEvent.eventId}`}
                    className={`inline-flex items-center gap-1 text-xs font-semibold hover:underline ${
                      nextTone?.link ?? "text-[#1A3FA8]"
                    }`}
                  >
                    Detail event <ArrowUpRight size={14} />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-[16px] border border-dashed border-[#C9D7F3] bg-[#F8FAFF] px-4 py-6 text-center text-sm text-[#6B7280]">
                Belum ada event mendatang. Event yang sudah selesai tetap bisa
                dibuka dari menu Event Management.
              </div>
            )}
          </section>

          <section className="flex min-h-0 flex-1 flex-col rounded-[24px] border border-[#D7E1F0] bg-white p-6 shadow-[0_12px_32px_rgba(10,38,71,0.06)]">
            <div className="flex shrink-0 items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0A2647] text-white">
                  <Sparkles size={18} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[#0A2647]">
                    Prioritas Operasional
                  </h2>
                  <p className="text-xs text-[#7B8CA3]">
                    {brief?.dataUpdatedAt
                      ? `Berdasarkan data ${safeCompactDate(brief.dataUpdatedAt)}`
                      : "Menyiapkan prioritas operasional"}
                  </p>
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-[#EEF3FB] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#1A3FA8]">
                AI
              </span>
            </div>

            {briefError ? (
              <div className="mt-4 rounded-[14px] border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-xs text-[#991B1B]">
                {briefError}
              </div>
            ) : null}

            {isLoadingBrief && !brief ? (
              <div className="mt-4 h-24 animate-pulse rounded-[16px] bg-[#F1F5FB]" />
            ) : brief ? (
              <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="rounded-[16px] border border-[#D7E1F0] bg-[#F8FAFF] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7B8CA3]">
                    Fokus utama
                  </p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#0A2647]">
                    {brief.focus}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-[#5B6B7F]">
                    {brief.reason}
                  </p>
                </div>

                {brief.actions.length ? (
                  <div className="mt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7B8CA3]">
                      Lanjutan
                    </p>
                    <ul className="mt-2 space-y-2">
                      {brief.actions.map((action, index) => (
                        <li
                          key={`${action}-${index}`}
                          className="flex gap-2 rounded-[14px] border border-[#E3EBF7] bg-white px-3 py-2 text-xs leading-5 text-[#5B6B7F]"
                        >
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1A3FA8]" />
                          <span>{action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      </div>

      <section className="rounded-[24px] border border-[#D7E1F0] bg-white p-6 shadow-[0_12px_32px_rgba(10,38,71,0.06)]">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#7B8CA3]">
          Audience Momentum
        </p>
        <h2 className="mt-1 text-lg font-semibold text-[#0A2647]">
          Siapa yang hadir dan kapan mereka mendaftar
        </h2>

        <div className="mt-5 grid gap-6 lg:grid-cols-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0A2647]">
              <Building2 size={16} /> Industri teratas
            </div>
            <div className="mt-4 space-y-3">
              {(overview?.audience.topIndustries ?? []).map((item) => (
                <div key={item.name}>
                  <div className="flex items-center justify-between gap-2 text-xs text-[#5B6B7F]">
                    <span className="truncate">{item.name}</span>
                    <span className="font-semibold text-[#0A2647]">
                      {formatNumber(item.count)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-[#EEF3FB]">
                    <div
                      className="h-2 rounded-full bg-[#1A3FA8]"
                      style={{ width: `${(item.count / maxIndustry) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0A2647]">
              <MapPin size={16} /> Kota teratas
            </div>
            <div className="mt-4 space-y-3">
              {(overview?.audience.topCities ?? []).map((item) => (
                <div key={item.name}>
                  <div className="flex items-center justify-between gap-2 text-xs text-[#5B6B7F]">
                    <span className="truncate">{item.name}</span>
                    <span className="font-semibold text-[#0A2647]">
                      {formatNumber(item.count)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-[#EEF3FB]">
                    <div
                      className="h-2 rounded-full bg-[#0A2647]"
                      style={{ width: `${(item.count / maxCity) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#0A2647]">
                <Activity size={16} /> Tren pendaftaran 30 hari
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Rata-rata {trendAverageLabel}/hari
              </span>
            </div>
            <div className="mt-4 h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <ReferenceLine
                    y={trendAverage}
                    stroke="#F59E0B"
                    strokeDasharray="5 4"
                    strokeWidth={1.5}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    name="Pendaftaran"
                    stroke="#0A2647"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
