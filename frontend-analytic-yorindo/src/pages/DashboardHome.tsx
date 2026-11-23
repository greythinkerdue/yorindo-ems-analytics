import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  Building2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  RefreshCw,
  Sparkles,
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

const ACTION_LINK_CLASS =
  "inline-flex shrink-0 items-center gap-1 rounded-full border border-[#DCE5F2] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0A2647] transition hover:bg-[#F5F8FF]";

type ActionTone = {
  card: string;
  icon: string;
  value: string;
};

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

function ActionCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
  badge,
  action,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone: ActionTone;
  badge?: { text: string; className: string };
  action: ReactNode;
}) {
  return (
    <div
      className={`flex min-h-[142px] flex-col justify-between rounded-[20px] border p-4 shadow-[0_8px_20px_rgba(15,23,42,0.04)] ${tone.card}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7B8CA3]">
              {label}
            </p>
            {badge ? (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
              >
                {badge.text}
              </span>
            ) : null}
          </div>
          <p
            className={`mt-2 text-2xl font-bold tracking-[-0.03em] ${tone.value}`}
          >
            {value}
          </p>
        </div>
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${tone.icon}`}
        >
          <Icon size={18} />
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p
          className="min-w-0 truncate text-[11px] text-[#5B6B7F]"
          title={detail}
        >
          {detail}
        </p>
        {action}
      </div>
    </div>
  );
}

function ContextStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-baseline gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#94A3B8]">
        {label}
      </span>
      <span className="text-xs font-semibold text-[#0A2647]">{value}</span>
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
  const nextActionTone: ActionTone = nextTone
    ? { card: nextTone.card, icon: nextTone.icon, value: nextTone.link }
    : {
        card: "border-[#D7E1F0] bg-white",
        icon: "bg-[#EDF3FF] text-[#0A2647]",
        value: "text-[#0A2647]",
      };

  const pendingFocusEvent = useMemo(() => {
    if (!allWatchlist.length) return null;
    const withPending = allWatchlist.filter((item) => item.pending > 0);
    const source = withPending.length ? withPending : allWatchlist;
    return [...source].sort((a, b) => b.pending - a.pending)[0] ?? null;
  }, [allWatchlist]);
  const pendingFocusHref = pendingFocusEvent
    ? `/events/${pendingFocusEvent.eventId}/participants`
    : "/events";

  const focusHighAttention = () => {
    setWatchFilter("high");
    setWatchPage(1);
    document
      .getElementById("portfolio-health")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-5">
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

      {/* Lapisan keputusan: AI brief berdiri sendiri di atas card aksi. */}
      <section
        id="operations-brief"
        className="scroll-mt-6 rounded-[24px] border border-[#D7E1F0] bg-white p-6 shadow-[0_12px_32px_rgba(10,38,71,0.06)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0A2647] text-white">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#0A2647]">
                AI Operations Brief
              </h2>
              <p className="text-xs text-[#7B8CA3]">
                {brief?.dataUpdatedAt
                  ? `Keputusan berdasarkan data ${safeCompactDate(brief.dataUpdatedAt)}`
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
          <div className="mt-4 h-28 animate-pulse rounded-[16px] bg-[#F1F5FB]" />
        ) : brief ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <div className="rounded-[16px] border border-[#D7E1F0] bg-[#F8FAFF] p-4 lg:col-span-2">
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
            <div className="rounded-[16px] border border-[#E3EBF7] bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7B8CA3]">
                Lanjutan
              </p>
              {brief.actions.length ? (
                <ul className="mt-2 space-y-2">
                  {brief.actions.map((action, index) => (
                    <li
                      key={`${action}-${index}`}
                      className="flex gap-2 rounded-[14px] border border-[#E3EBF7] bg-[#F8FAFF] px-3 py-2 text-xs leading-5 text-[#5B6B7F]"
                    >
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1A3FA8]" />
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-[#7B8CA3]">
                  Tidak ada tindakan tambahan.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </section>

      {isLoadingOverview || !kpis ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`action-skeleton-${index}`}
                className="h-[142px] animate-pulse rounded-[20px] border border-[#D7E1F0] bg-white"
              />
            ))}
          </div>
          <div className="h-[54px] animate-pulse rounded-[16px] border border-[#D7E1F0] bg-white" />
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ActionCard
              label="Pending approval"
              value={formatNumber(kpis.pendingApprovals)}
              detail={
                pendingFocusEvent
                  ? pendingFocusEvent.title
                  : "Menunggu keputusan"
              }
              icon={Clock3}
              tone={{
                card: "border-amber-200 bg-amber-50/70",
                icon: "bg-amber-100 text-amber-700",
                value: "text-amber-700",
              }}
              action={
                <Link to={pendingFocusHref} className={ACTION_LINK_CLASS}>
                  Tinjau <ArrowUpRight size={13} />
                </Link>
              }
            />
            <ActionCard
              label="Perlu tindakan"
              value={formatNumber(watchCounts.high)}
              detail="Event dengan atensi tertinggi"
              icon={Activity}
              tone={{
                card: "border-rose-200 bg-rose-50/70",
                icon: "bg-rose-100 text-rose-700",
                value: "text-rose-700",
              }}
              action={
                <button
                  type="button"
                  onClick={focusHighAttention}
                  className={ACTION_LINK_CLASS}
                >
                  Lihat <ArrowUpRight size={13} />
                </button>
              }
            />
            <ActionCard
              label="Event berikutnya"
              value={
                overview?.nextEvent ? `${overview.nextEvent.daysUntil} hari` : "-"
              }
              detail={
                overview?.nextEvent
                  ? `${overview.nextEvent.title} • ${safeDate(overview.nextEvent.eventDate)}`
                  : "Belum ada event mendatang"
              }
              icon={CalendarClock}
              tone={nextActionTone}
              badge={
                nextTone
                  ? { text: nextTone.label, className: nextTone.badge }
                  : undefined
              }
              action={
                overview?.nextEvent ? (
                  <Link
                    to={`/events/${overview.nextEvent.eventId}`}
                    className={`${ACTION_LINK_CLASS} ${nextTone?.link ?? "text-[#1A3FA8]"}`}
                  >
                    Detail <ArrowUpRight size={13} />
                  </Link>
                ) : (
                  <span className="text-[11px] text-[#94A3B8]">-</span>
                )
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[16px] border border-[#D7E1F0] bg-white px-4 py-3 shadow-[0_6px_16px_rgba(15,23,42,0.04)]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7B8CA3]">
              Ringkasan
            </span>
            <ContextStat label="Event" value={formatNumber(kpis.totalEvents)} />
            <ContextStat label="Aktif" value={formatNumber(kpis.activeEvents)} />
            <ContextStat
              label="Pendaftar"
              value={formatNumber(kpis.totalRegistrations)}
            />
            <ContextStat
              label="Ditolak"
              value={formatNumber(kpis.totalRejected)}
            />
            <ContextStat
              label="Approval"
              value={`${kpis.approvalRate.toFixed(1)}%`}
            />
            <ContextStat
              label="Kehadiran"
              value={`${kpis.attendanceRate.toFixed(1)}%`}
            />
            <ContextStat
              label="Tiket belum"
              value={formatNumber(kpis.ticketsNotSent)}
            />
          </div>
        </>
      )}

      <section
        id="portfolio-health"
        className="scroll-mt-6 rounded-[24px] border border-[#D7E1F0] bg-white p-6 shadow-[0_12px_32px_rgba(10,38,71,0.06)]"
      >
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

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {isLoadingOverview ? (
            <div className="h-24 animate-pulse rounded-[18px] bg-[#F1F5FB] md:col-span-3" />
          ) : visibleWatchlist.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-[#C9D7F3] bg-[#F8FAFF] px-5 py-8 text-center text-sm text-[#6B7280] md:col-span-3">
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
