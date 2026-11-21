import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CheckCircle2,
  Download,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import {
  getEventParticipants,
  type EventParticipantItem,
  type EventParticipantListResponse,
} from "@/services/eventWorkspaceService";
import {
  approveRegistration,
  bulkApproveRegistrations,
  bulkRejectRegistrations,
  rejectRegistration,
} from "@/services/registrationOperationsService";
import { usePermission } from "@/hooks/usePermission";
import { downloadCsv } from "@/utils/exportCsv";
import { formatDate } from "@/utils/formatters";

type StatusFilter = "all" | "pending" | "approved" | "rejected" | "checked_in";

const statusOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Semua status" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "checked_in", label: "Checked-in" },
  { value: "rejected", label: "Rejected" },
];

const getStatusBadge = (status?: string) => {
  const normalized = status?.toLowerCase();
  if (normalized === "checked_in") {
    return { label: "Checked-in", className: "bg-[#E6F9F0] text-[#22C55E]" };
  }
  if (normalized === "approved") {
    return { label: "Approved", className: "bg-[#EAF1FF] text-[#3B82F6]" };
  }
  if (normalized === "rejected") {
    return { label: "Rejected", className: "bg-[#FEF2F2] text-[#EF4444]" };
  }
  if (normalized === "pending") {
    return { label: "Pending", className: "bg-[#FFF7ED] text-[#F59E0B]" };
  }
  return { label: status ?? "-", className: "bg-[#F3F4F6] text-[#6B7280]" };
};

const EventParticipants = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const canView = usePermission("registrations:view");
  const canApprove = usePermission("registrations:approve");
  const canCheckIn = usePermission("registrations:checkin");

  const [items, setItems] = useState<EventParticipantItem[]>([]);
  const [meta, setMeta] = useState<EventParticipantListResponse["meta"] | null>(null);
  const [pagination, setPagination] = useState<EventParticipantListResponse["pagination"] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (!eventId || !canView) return;

    let isActive = true;
    setIsLoading(true);
    setError("");

    const timer = window.setTimeout(() => {
      void getEventParticipants({
        eventId,
        page,
        limit: 10,
        search: search.trim() || undefined,
        status: statusFilter,
      }).then((result) => {
        if (!isActive) return;
        setIsLoading(false);

        if (result.error || !result.data) {
          setError(result.error ?? "Gagal memuat data peserta.");
          setItems([]);
          return;
        }

        setItems(result.data.items);
        setMeta(result.data.meta);
        setPagination(result.data.pagination);
      });
    }, 200);

    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [canView, eventId, page, refreshKey, search, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [eventId, search, statusFilter]);

  useEffect(() => {
    setSelectedIds([]);
  }, [items]);

  const total = meta?.totalCount ?? 0;
  const approved = meta?.approvedCount ?? 0;
  const checkedIn = meta?.checkedInCount ?? 0;
  const attended = approved + checkedIn;
  const attendedPercent = total > 0 ? Math.min((attended / total) * 100, 100) : 0;
  const checkedInPercent = total > 0 ? Math.min((checkedIn / total) * 100, 100) : 0;
  const approvedPercent = Math.max(attendedPercent - checkedInPercent, 0);

  const runAction = async (action: () => Promise<void>, successMessage: string) => {
    setIsSubmitting(true);
    setError("");
    setFeedback("");

    try {
      await action();
      setFeedback(successMessage);
      setSelectedIds([]);
      setRefreshKey((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Aksi gagal diproses.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = (registrationId: string) => {
    if (!eventId) return;
    void runAction(async () => {
      const result = await approveRegistration(eventId, registrationId);
      if (result.error) throw new Error(result.error);
    }, "Pendaftaran berhasil disetujui.");
  };

  const handleReject = (registrationId: string) => {
    if (!eventId) return;
    void runAction(async () => {
      const result = await rejectRegistration(eventId, registrationId);
      if (result.error) throw new Error(result.error);
    }, "Pendaftaran ditolak.");
  };

  const handleBulk = (approve: boolean) => {
    if (!eventId || selectedIds.length === 0) return;
    void runAction(async () => {
      const result = approve
        ? await bulkApproveRegistrations(eventId, selectedIds)
        : await bulkRejectRegistrations(eventId, selectedIds);
      if (result.error) throw new Error(result.error);
    }, approve
      ? `${selectedIds.length} pendaftaran berhasil disetujui.`
      : `${selectedIds.length} pendaftaran ditolak.`);
  };

  const handleExport = async () => {
    if (!eventId) return;
    setIsSubmitting(true);
    setError("");

    try {
      const first = await getEventParticipants({ eventId, page: 1, limit: 100 });
      if (first.error || !first.data) {
        throw new Error(first.error ?? "Gagal mengambil data untuk export.");
      }

      const allRows = [...first.data.items];
      const totalPages = first.data.pagination.totalPages;

      for (let currentPage = 2; currentPage <= totalPages; currentPage += 1) {
        const next = await getEventParticipants({ eventId, page: currentPage, limit: 100 });
        if (next.error || !next.data) {
          throw new Error(next.error ?? "Gagal mengambil halaman export.");
        }
        allRows.push(...next.data.items);
      }

      downloadCsv(
        `registrations-${eventId}.csv`,
        allRows,
        [
          { key: "registrationId", label: "Registration ID" },
          { key: "fullName", label: "Nama" },
          { key: "companyEmail", label: "Email Perusahaan" },
          { key: "personalEmail", label: "Email Pribadi" },
          { key: "phone", label: "Telepon" },
          { key: "companyName", label: "Perusahaan" },
          { key: "industryName", label: "Industri" },
          { key: "jobTitleName", label: "Jabatan" },
          { key: "cityName", label: "Kota" },
          { key: "status", label: "Status" },
          { key: "createdAt", label: "Tanggal Daftar" },
          { key: "checkedInAt", label: "Check-in" },
        ],
      );
      setFeedback(`${allRows.length} data peserta berhasil diexport ke CSV.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Export gagal.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const allSelected = useMemo(
    () => items.length > 0 && items.every((item) => selectedIds.includes(item.registrationId)),
    [items, selectedIds],
  );

  if (!eventId) {
    return (
      <div className="rounded-[24px] border border-dashed border-[#D7E1F0] bg-white px-6 py-12 text-center text-sm text-[#6B7280]">
        Event ID tidak ditemukan di URL.
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="rounded-[24px] border border-dashed border-[#D7E1F0] bg-white px-6 py-12 text-center">
        <ShieldAlert className="mx-auto mb-4 text-[#94A3B8]" size={28} />
        <p className="text-base font-semibold text-[#0A2647]">Akses peserta tidak tersedia</p>
        <p className="mt-2 text-sm text-[#6B7280]">
          Akun Anda memerlukan permission <code>registrations:view</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-[#D7E1F0] bg-[#F8FAFD] p-8 shadow-[0_14px_30px_rgba(10,38,71,0.05)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#94A3B8]">
              Participants
            </p>
            <h1 className="text-[2.15rem] font-bold tracking-[-0.04em] text-[#0A2647]">
              Daftar Participant
            </h1>
            <p className="text-sm leading-7 text-[#5B6B7F]">
              Total {total} • Pending {meta?.pendingCount ?? 0} • Approved {approved} •
              Checked-in {checkedIn} • Rejected {meta?.rejectedCount ?? 0}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {canCheckIn ? (
              <Link
                to={`/events/${eventId}/check-in`}
                className="inline-flex items-center justify-center gap-2 rounded-[14px] border border-[#DCE5F2] bg-white px-4 py-3 text-sm font-semibold text-[#0A2647] transition hover:bg-[#F5F8FF]"
              >
                <QrCode size={16} /> Check-In Desk
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={isSubmitting || total === 0}
              className="inline-flex items-center justify-center gap-2 rounded-[14px] border border-[#DCE5F2] bg-white px-4 py-3 text-sm font-semibold text-[#0A2647] transition hover:bg-[#F5F8FF] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={16} /> Export CSV
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-[20px] border border-[#E3EAF5] bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7B8CA3]">
              Monitoring Kapasitas
            </p>
            <p className="text-sm font-semibold text-[#0A2647]">
              {attended} / {total} peserta
            </p>
          </div>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-[#E5ECF6]">
            <div
              className="h-full bg-[#22C55E] transition-all duration-500"
              style={{ width: `${checkedInPercent}%` }}
            />
            <div
              className="h-full bg-[#3B82F6] transition-all duration-500"
              style={{ width: `${approvedPercent}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-5 text-xs text-[#6B7280]">
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#22C55E]" /> {checkedIn} checked-in
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#3B82F6]" /> {approved} approved
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#E5ECF6]" /> {Math.max(total - attended, 0)} belum diproses
            </span>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-[18px] border border-[#FCA5A5] bg-[#FEF2F2] px-5 py-4 text-sm text-[#991B1B]">
          {error}
        </div>
      ) : null}
      {feedback ? (
        <div className="rounded-[18px] border border-emerald-100 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
          {feedback}
        </div>
      ) : null}

      <section className="rounded-[24px] border border-[#D7E1F0] bg-white p-6 shadow-[0_12px_28px_rgba(10,38,71,0.06)]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[260px] flex-1 items-center gap-3 rounded-[16px] border border-[#DCE5F2] bg-[#F8FAFD] px-4 py-3">
            <Search size={16} className="text-[#7B8CA3]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari nama, email, perusahaan, atau jabatan…"
              className="w-full bg-transparent text-sm text-[#0A2647] outline-none placeholder:text-[#94A3B8]"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="rounded-[16px] border border-[#DCE5F2] bg-[#F8FAFD] px-4 py-3 text-sm font-semibold text-[#43556E] outline-none focus:border-[#AFC4F6]"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setRefreshKey((value) => value + 1)}
            className="inline-flex items-center gap-2 rounded-[16px] border border-[#DCE5F2] bg-white px-4 py-3 text-sm font-semibold text-[#43556E] transition hover:bg-[#F5F8FF]"
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        {canApprove ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[16px] border border-[#E3EAF5] bg-[#F8FAFD] px-4 py-3">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#43556E]">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() =>
                  setSelectedIds(allSelected ? [] : items.map((item) => item.registrationId))
                }
                className="h-4 w-4 accent-[#0A2647]"
              />
              Pilih semua di halaman ini
            </label>
            <span className="text-xs text-[#7B8CA3]">{selectedIds.length} dipilih</span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => handleBulk(false)}
                disabled={selectedIds.length === 0 || isSubmitting}
                className="inline-flex items-center gap-2 rounded-[12px] border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <XCircle size={14} /> Bulk Reject
              </button>
              <button
                type="button"
                onClick={() => handleBulk(true)}
                disabled={selectedIds.length === 0 || isSubmitting}
                className="inline-flex items-center gap-2 rounded-[12px] bg-[#0A2647] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#133A6F] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle2 size={14} /> Bulk Approve
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#F8FAFD] text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7B8CA3]">
              <tr>
                {canApprove ? <th className="px-4 py-4" /> : null}
                <th className="px-4 py-4">Nama</th>
                <th className="px-4 py-4">Perusahaan</th>
                <th className="px-4 py-4">Jabatan</th>
                <th className="px-4 py-4">Email</th>
                <th className="px-4 py-4">Tanggal Daftar</th>
                <th className="px-4 py-4">Status</th>
                {canApprove ? <th className="px-4 py-4 text-right">Aksi</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF3FA]">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, index) => (
                  <tr key={`skeleton-${index}`} className="animate-pulse">
                    <td colSpan={canApprove ? 8 : 6} className="px-4 py-5">
                      <div className="h-4 w-3/4 rounded bg-slate-200" />
                    </td>
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={canApprove ? 8 : 6} className="px-4 py-10 text-center text-sm text-[#6B7280]">
                    Tidak ada participant untuk event ini.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const badge = getStatusBadge(item.status);
                  const isPending = item.status?.toLowerCase() === "pending";

                  return (
                    <tr key={item.registrationId} className="hover:bg-[#F8FAFF]">
                      {canApprove ? (
                        <td className="px-4 py-4">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(item.registrationId)}
                            onChange={() =>
                              setSelectedIds((current) =>
                                current.includes(item.registrationId)
                                  ? current.filter((id) => id !== item.registrationId)
                                  : [...current, item.registrationId],
                              )
                            }
                            className="h-4 w-4 accent-[#0A2647]"
                          />
                        </td>
                      ) : null}
                      <td className="px-4 py-4 font-semibold text-[#0A2647]">
                        {item.fullName}
                        <div className="mt-1 text-xs font-medium text-[#7B8CA3]">
                          ID: {item.participantId}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-[#5B6B7F]">{item.companyName}</td>
                      <td className="px-4 py-4 text-[#5B6B7F]">{item.jobTitleName}</td>
                      <td className="px-4 py-4 text-[#5B6B7F]">
                        {item.companyEmail ?? item.personalEmail ?? "-"}
                      </td>
                      <td className="px-4 py-4 text-[#5B6B7F]">
                        {item.createdAt ? formatDate(item.createdAt) : "-"}
                        {item.checkedInAt ? (
                          <div className="mt-1 text-xs text-emerald-600">
                            Check-in: {formatDate(item.checkedInAt)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      {canApprove ? (
                        <td className="px-4 py-4 text-right">
                          {isPending ? (
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleReject(item.registrationId)}
                                disabled={isSubmitting}
                                className="rounded-[10px] border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                              >
                                Reject
                              </button>
                              <button
                                type="button"
                                onClick={() => handleApprove(item.registrationId)}
                                disabled={isSubmitting}
                                className="rounded-[10px] bg-[#0A2647] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#133A6F] disabled:opacity-50"
                              >
                                Approve
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-[#94A3B8]">—</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.totalPages > 1 ? (
          <div className="mt-5 flex items-center justify-between border-t border-[#E5ECF6] pt-5">
            <p className="text-xs text-[#7B8CA3]">
              Halaman {pagination.page} dari {pagination.totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(value - 1, 1))}
                disabled={page <= 1}
                className="rounded-[12px] border border-[#D7E1F0] px-4 py-2 text-xs font-semibold text-[#43556E] transition hover:bg-[#F5F8FF] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((value) => Math.min(value + 1, pagination.totalPages))}
                disabled={page >= pagination.totalPages}
                className="rounded-[12px] border border-[#D7E1F0] px-4 py-2 text-xs font-semibold text-[#43556E] transition hover:bg-[#F5F8FF] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
};

export default EventParticipants;
