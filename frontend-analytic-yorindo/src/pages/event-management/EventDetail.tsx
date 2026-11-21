import { useEffect, useMemo, useState } from "react";
import { BarChart3, Copy, ExternalLink, FilePlus2, QrCode, Users } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/services/api";
import { getEventParticipants } from "@/services/eventWorkspaceService";
import { usePermission } from "@/hooks/usePermission";
import { formatDate } from "@/utils/formatters";
import {
  buildPublicRegistrationUrl,
  isLocalPublicUrl,
} from "@/utils/publicSiteUrl";

type EventIndustry = {
  refId?: string;
  name?: string;
} | null;

type EventDetailItem = {
  _id: string;
  title?: string;
  slug?: string;
  description?: string;
  category?: unknown;
  industry?: EventIndustry;
  eventDate?: string;
  event_date?: string;
  location?: string;
  status?: string;
  registrationForm?: {
    version?: number;
    publishedAt?: string | null;
    fields?: unknown[];
  };
};

const getEventDate = (item?: EventDetailItem | null) =>
  item?.eventDate ?? item?.event_date ?? null;

/** Transisi status event mengikuti aturan yang sama dengan backend/EMS. */
const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["draft", "upcoming", "cancelled"],
  upcoming: ["upcoming", "registration", "cancelled"],
  registration: ["registration", "ongoing"],
  ongoing: ["ongoing", "done"],
  done: ["done"],
  cancelled: ["cancelled"],
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  upcoming: "Upcoming",
  registration: "Registration",
  ongoing: "Ongoing",
  done: "Done",
  cancelled: "Cancelled",
};

const getStatusBadge = (status?: string) => {
  const normalized = status?.toLowerCase();

  if (normalized === "registration" || normalized === "published") {
    return { label: "Published", className: "border border-emerald-200 bg-emerald-100 text-emerald-700" };
  }

  if (normalized === "ongoing") {
    return { label: "Ongoing", className: "border border-blue-200 bg-blue-100 text-blue-700" };
  }

  if (normalized === "closed" || normalized === "done" || normalized === "cancelled") {
    return { label: "Closed", className: "border border-slate-300 bg-slate-200 text-slate-600" };
  }

  if (normalized === "draft") {
    return { label: "Draft", className: "border border-amber-200 bg-amber-100 text-amber-700" };
  }

  return { label: status ?? "-", className: "border border-slate-300 bg-slate-100 text-slate-600" };
};

export default function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const [detail, setDetail] = useState<EventDetailItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [capacity, setCapacity] = useState<{
    total: number;
    approved: number;
    checkedIn: number;
  } | null>(null);
  const [statusValue, setStatusValue] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const canEditEvent = usePermission("events:edit");
  const canCheckIn = usePermission("registrations:checkin");

  useEffect(() => {
    if (!eventId) {
      setError("Event ID tidak ditemukan.");
      return;
    }

    const loadDetail = async () => {
      setIsLoading(true);
      setError("");

      const cacheBuster = `ts=${Date.now()}`;
      const result = await api.get<EventDetailItem>(
        `/api/v1/events/${eventId}?${cacheBuster}`,
      );

      setIsLoading(false);

      if (result.error || !result.data) {
        setError(result.message || "Gagal memuat detail event.");
        setDetail(null);
        return;
      }

      setDetail(result.data);
      setStatusValue(result.data.status?.toLowerCase() ?? "draft");

      void getEventParticipants({ eventId, page: 1, limit: 1 }).then((participants) => {
        if (!participants.data) return;
        setCapacity({
          total: participants.data.meta.totalCount,
          approved: participants.data.meta.approvedCount,
          checkedIn: participants.data.meta.checkedInCount,
        });
      });
    };

    void loadDetail();
  }, [eventId, reloadKey]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const publicRegistrationUrl = useMemo(() => {
    if (!detail?.slug) return null;
    return buildPublicRegistrationUrl(detail.slug);
  }, [detail?.slug]);

  const isPublicLinkLocal = publicRegistrationUrl
    ? isLocalPublicUrl(publicRegistrationUrl)
    : false;

  const handleStatusChange = async (nextStatus: string) => {
    if (!eventId || nextStatus === statusValue) return;
    setIsUpdatingStatus(true);
    setStatusMessage("");

    const result = await api.patch(`/api/v1/events/${eventId}`, {
      status: nextStatus,
    });

    setIsUpdatingStatus(false);

    if (result.error) {
      setStatusMessage(result.error);
      return;
    }

    setStatusValue(nextStatus);
    setStatusMessage(`Status event berhasil diubah ke ${STATUS_LABELS[nextStatus] ?? nextStatus}.`);
    setReloadKey((value) => value + 1);
  };

  if (!eventId) {
    return (
      <div className="rounded-[24px] border border-dashed border-[#D7E1F0] bg-white px-6 py-12 text-center text-sm text-[#6B7280]">
        Event ID tidak ditemukan di URL.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="rounded-[28px] border border-[#D7E1F0] bg-[#F8FAFD] p-8 shadow-[0_14px_30px_rgba(10,38,71,0.05)]">
          <div className="animate-pulse space-y-4">
            <div className="h-4 w-32 rounded-full bg-slate-200" />
            <div className="h-10 w-2/3 rounded-2xl bg-slate-200" />
            <div className="h-5 w-full rounded-xl bg-slate-200" />
            <div className="h-5 w-5/6 rounded-xl bg-slate-200" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="rounded-[24px] border border-dashed border-[#D7E1F0] bg-white px-6 py-12 text-center text-sm text-[#6B7280]">
        {error || "Detail event tidak tersedia."}
      </div>
    );
  }

  const status = getStatusBadge(detail.status);
  const eventDate = getEventDate(detail);
  const registrationFields = detail.registrationForm?.fields?.length ?? 0;
  const formVersion = detail.registrationForm?.version ?? 1;
  const hasPublicPage = Boolean(publicRegistrationUrl);

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-[#D7E1F0] bg-[#F8FAFD] p-8 shadow-[0_14px_30px_rgba(10,38,71,0.05)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#94A3B8]">
                Event Detail
              </p>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.className}`}>
                {status.label}
              </span>
              {canEditEvent ? (
                <select
                  value={statusValue}
                  onChange={(event) => void handleStatusChange(event.target.value)}
                  disabled={isUpdatingStatus}
                  className="rounded-full border border-[#DCE5F2] bg-white px-3 py-1 text-xs font-semibold text-[#43556E] outline-none transition focus:border-[#2F5BFF] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Ubah status event"
                >
                  {(STATUS_TRANSITIONS[statusValue] ?? [statusValue]).map((option) => (
                    <option key={option} value={option}>
                      {STATUS_LABELS[option] ?? option}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            <h1 className="text-[2.15rem] font-bold tracking-[-0.04em] text-[#0A2647]">
              {detail.title}
            </h1>
            <p className="max-w-3xl text-sm leading-7 text-[#5B6B7F]">
              {detail.description?.trim() ||
                "Detail event ini menjadi pusat kontrol untuk form registrasi, analytics, feedback, dan daftar participants."}
            </p>
          </div>

          <div className="grid w-full grid-cols-1 gap-2 lg:w-[260px] lg:shrink-0">
            <Link
              to={`/events/${eventId}/participants`}
              className="group inline-flex items-center justify-center gap-1.5 rounded-[12px] border border-[#DCE5F2] bg-white px-3 py-2.5 text-[13px] font-semibold text-[#0A2647] shadow-[0_6px_14px_rgba(15,23,42,0.05)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[#AFC4F6] hover:bg-[#EDF3FF] hover:shadow-[0_12px_22px_rgba(15,23,42,0.12)] active:translate-y-0 active:scale-[0.98]"
            >
              <Users size={14} className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
              Participants
            </Link>
            {canCheckIn ? (
              <Link
                to={`/events/${eventId}/check-in`}
                className="group inline-flex items-center justify-center gap-1.5 rounded-[12px] border border-[#DCE5F2] bg-white px-3 py-2.5 text-[13px] font-semibold text-[#0A2647] shadow-[0_6px_14px_rgba(15,23,42,0.05)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[#AFC4F6] hover:bg-[#EDF3FF] hover:shadow-[0_12px_22px_rgba(15,23,42,0.12)] active:translate-y-0 active:scale-[0.98]"
              >
                <QrCode size={14} className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
                Check-In Desk
              </Link>
            ) : null}
            <Link
              to={`/events/${eventId}/analytics`}
              className="group inline-flex items-center justify-center gap-1.5 rounded-[12px] bg-[#0A2647] px-3 py-2.5 text-[13px] font-semibold text-white shadow-[0_8px_16px_rgba(10,38,71,0.16)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#133A6F] hover:shadow-[0_14px_24px_rgba(10,38,71,0.28)] active:translate-y-0 active:scale-[0.98]"
            >
              <BarChart3 size={14} className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
              Event Analytics
            </Link>
            <Link
              to={`/events/${eventId}/registration-form`}
              className={`group inline-flex items-center justify-center gap-1.5 rounded-[12px] border border-[#DCE5F2] bg-white px-3 py-2.5 text-[13px] font-semibold text-[#0A2647] shadow-[0_6px_14px_rgba(15,23,42,0.05)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[#AFC4F6] hover:bg-[#EDF3FF] hover:shadow-[0_12px_22px_rgba(15,23,42,0.12)] active:translate-y-0 active:scale-[0.98] ${
                canCheckIn && !hasPublicPage ? "sm:col-span-2" : ""
              }`}
            >
              <FilePlus2 size={14} className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
              Form Builder Registration
            </Link>
            {publicRegistrationUrl ? (
              <a
                href={publicRegistrationUrl}
                target="_blank"
                rel="noreferrer"
                className={`group inline-flex items-center justify-center gap-1.5 rounded-[12px] border border-[#DCE5F2] bg-white px-3 py-2.5 text-[13px] font-semibold text-[#0A2647] shadow-[0_6px_14px_rgba(15,23,42,0.05)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[#AFC4F6] hover:bg-[#EDF3FF] hover:shadow-[0_12px_22px_rgba(15,23,42,0.12)] active:translate-y-0 active:scale-[0.98] ${
                  !canCheckIn ? "sm:col-span-2" : ""
                }`}
              >
                <ExternalLink size={14} className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
                Open Public Page
              </a>
            ) : null}
          </div>
        </div>
      </section>

      {statusMessage ? (
        <div className="rounded-[18px] border border-emerald-100 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
          {statusMessage}
        </div>
      ) : null}

      <section className="rounded-[24px] border border-[#D7E1F0] bg-white p-6 shadow-[0_12px_28px_rgba(10,38,71,0.06)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7B8CA3]">
              Monitoring Kapasitas
            </p>
            <h2 className="mt-1 text-lg font-bold text-[#0A2647]">Progres registrasi event</h2>
          </div>
          <p className="text-sm font-semibold text-[#0A2647]">
            {capacity ? `${capacity.approved + capacity.checkedIn} / ${capacity.total} peserta` : "—"}
          </p>
        </div>
        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-[#E5ECF6]">
          <div
            className="h-full bg-[#22C55E] transition-all duration-500"
            style={{
              width: `${
                capacity?.total
                  ? Math.min((capacity.checkedIn / capacity.total) * 100, 100)
                  : 0
              }%`,
            }}
          />
          <div
            className="h-full bg-[#3B82F6] transition-all duration-500"
            style={{
              width: `${
                capacity?.total
                  ? Math.max(
                      Math.min(
                        ((capacity.approved + capacity.checkedIn) / capacity.total) * 100,
                        100,
                      ) - Math.min((capacity.checkedIn / capacity.total) * 100, 100),
                      0,
                    )
                  : 0
              }%`,
            }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-5 text-xs text-[#6B7280]">
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#22C55E]" /> {capacity?.checkedIn ?? 0} checked-in
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#3B82F6]" /> {capacity?.approved ?? 0} approved
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#E5ECF6]" />{" "}
            {capacity ? Math.max(capacity.total - capacity.approved - capacity.checkedIn, 0) : 0} belum diproses
          </span>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-[28px] border border-[#D7E1F0] bg-white p-7 shadow-[0_12px_28px_rgba(10,38,71,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7B8CA3]">
            Event Identity
          </p>

          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div className="rounded-[22px] border border-[#E5ECF6] bg-[#F8FAFD] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">
                Event Date
              </p>
              <p className="mt-2 text-base font-semibold text-[#0A2647]">
                {eventDate ? formatDate(eventDate) : "-"}
              </p>
            </div>
            <div className="rounded-[22px] border border-[#E5ECF6] bg-[#F8FAFD] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">
                Location
              </p>
              <p className="mt-2 text-base font-semibold text-[#0A2647]">
                {detail.location || "-"}
              </p>
            </div>
            <div className="rounded-[22px] border border-[#E5ECF6] bg-[#F8FAFD] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">
                Industry
              </p>
              <p className="mt-2 text-base font-semibold text-[#0A2647]">
                {detail.industry?.name || "-"}
              </p>
            </div>
            <div className="rounded-[22px] border border-[#E5ECF6] bg-[#F8FAFD] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">
                Slug
              </p>
              <p className="mt-2 break-all text-base font-semibold text-[#0A2647]">
                {detail.slug}
              </p>
            </div>
            <div className="rounded-[22px] border border-[#C9D7F3] bg-[#EAF1FF] p-5 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5B7398]">
                Form Version
              </p>
              <p className="mt-2 text-base font-semibold text-[#0A2647]">v{formVersion}</p>
            </div>
            <div className="rounded-[22px] border border-[#E5ECF6] bg-[#F8FAFD] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">
                Published At
              </p>
              <p className="mt-2 text-base font-semibold text-[#0A2647]">
                {detail.registrationForm?.publishedAt
                  ? formatDate(detail.registrationForm.publishedAt)
                  : "Belum dipublish"}
              </p>
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-[28px] border border-[#D7E1F0] bg-[#EAF1FF] p-6 shadow-[0_12px_28px_rgba(10,38,71,0.08)]">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#0A2647] shadow-[0_8px_18px_rgba(15,23,42,0.05)]">
                <QrCode size={22} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7B8CA3]">
                  Registration Access
                </p>
                <p className="text-base font-bold text-[#0A2647]">Public registration link</p>
              </div>
            </div>

            <div className="mt-5 rounded-[20px] bg-white p-4 shadow-[0_8px_18px_rgba(15,23,42,0.05)]">
              <p className="break-all text-sm leading-6 text-[#43556E]">
                {publicRegistrationUrl || "URL public akan tersedia setelah event punya slug."}
              </p>
              {isPublicLinkLocal ? (
                <p className="mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
                  ⚠️ Link ini masih localhost dan hanya bisa dibuka di komputer ini.
                  Set `VITE_PUBLIC_SITE_URL` ke alamat ngrok/public sebelum dibagikan.
                </p>
              ) : null}
              {publicRegistrationUrl ? (
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(publicRegistrationUrl);
                    setCopied(true);
                  }}
                  className="group mt-4 inline-flex items-center gap-2 rounded-[14px] border border-[#DCE5F2] bg-[#F8FAFD] px-4 py-2 text-sm font-semibold text-[#0A2647] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[#AFC4F6] hover:bg-[#EDF3FF] hover:shadow-[0_10px_18px_rgba(15,23,42,0.10)] active:translate-y-0 active:scale-[0.98]"
                >
                  <Copy size={14} className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
                  {copied ? "Link copied" : "Copy link"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="rounded-[28px] border border-[#D7E1F0] bg-white p-6 shadow-[0_12px_28px_rgba(10,38,71,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7B8CA3]">
              Form Snapshot
            </p>
            <div className="mt-4 grid gap-4">
              <div className="rounded-[18px] border border-[#C9D7F3] bg-[#EAF1FF] p-4 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5B7398]">
                  Total Active Fields
                </p>
                <p className="mt-2 text-2xl font-bold tracking-[-0.04em] text-[#0A2647]">
                  {registrationFields}
                </p>
              </div>
              <div className="rounded-[18px] border border-[#E5ECF6] bg-[#F8FAFD] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">
                  Event ID
                </p>
                <p className="mt-2 break-all text-sm font-semibold text-[#0A2647]">
                  {detail._id}
                </p>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
