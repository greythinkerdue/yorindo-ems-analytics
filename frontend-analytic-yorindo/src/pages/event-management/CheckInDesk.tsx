import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Camera,
  CameraOff,
  CheckCircle2,
  ClipboardCheck,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  UserCheck,
  Users,
} from "lucide-react";
import {
  getCheckInStats,
  getRecentCheckIns,
  lookupCheckInCandidates,
  manualCheckIn,
  scanCheckIn,
  type CheckInActionResult,
  type CheckInDeskStats,
  type CheckInRecentItem,
  type CheckInRegistrationItem,
} from "@/services/checkInService";
import { usePermission } from "@/hooks/usePermission";

type ScannerInstance = {
  start: (
    source: string | { facingMode: string },
    config: {
      fps: number;
      qrbox: (width: number, height: number) => { width: number; height: number };
      rememberLastUsedCamera: boolean;
    },
    onSuccess: (decodedText: string) => void,
    onFailure?: (error: unknown) => void,
  ) => Promise<unknown>;
  stop: () => Promise<void>;
  clear: () => void;
};

type ScannerModule = {
  Html5Qrcode: {
    new (elementId: string): ScannerInstance;
    getCameras: () => Promise<Array<{ id: string }>>;
  };
};

type Feedback = {
  tone: "success" | "warning" | "error";
  title: string;
  message: string;
  name?: string;
  method?: string;
  at?: string | null;
};

const SCANNER_REGION_ID = "event-checkin-scanner-region";
const DUPLICATE_SCAN_WINDOW_MS = 2500;

const feedbackStyles: Record<Feedback["tone"], string> = {
  success: "border-emerald-100 bg-emerald-50 text-emerald-800",
  warning: "border-amber-100 bg-amber-50 text-amber-800",
  error: "border-red-100 bg-red-50 text-red-700",
};

function getDisplayName(item: { participant?: { fullName?: string } | null }) {
  return item.participant?.fullName ?? "Peserta tanpa nama";
}

function formatCheckInTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

const CheckInDesk = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const canCheckIn = usePermission("registrations:checkin");

  const [stats, setStats] = useState<CheckInDeskStats | null>(null);
  const [recentItems, setRecentItems] = useState<CheckInRecentItem[]>([]);
  const [lookupItems, setLookupItems] = useState<CheckInRegistrationItem[]>([]);
  const [lookupQuery, setLookupQuery] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<"scanner" | "manual">("scanner");
  const [scannerState, setScannerState] = useState<"idle" | "starting" | "running" | "error">("idle");
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const scannerRef = useRef<ScannerInstance | null>(null);
  const scanLockRef = useRef(false);
  const lastScanRef = useRef<{ payload: string; at: number } | null>(null);
  const deferredLookupQuery = useDeferredValue(lookupQuery);

  const canUseCamera = useMemo(() => {
    if (typeof window === "undefined") return false;
    return (
      window.isSecureContext ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    );
  }, []);

  const loadDeskData = useCallback(async () => {
    if (!eventId) return;
    setIsLoading(true);
    setError("");

    const [statsResult, recentResult] = await Promise.all([
      getCheckInStats(eventId),
      getRecentCheckIns(eventId, 50),
    ]);

    if (statsResult.error || !statsResult.data) {
      setError(statsResult.error ?? "Gagal memuat statistik check-in.");
      setIsLoading(false);
      return;
    }

    setStats(statsResult.data);
    setRecentItems(recentResult.data?.items ?? []);
    setIsLoading(false);
  }, [eventId]);

  useEffect(() => {
    void loadDeskData();
  }, [loadDeskData]);

  useEffect(() => {
    const query = deferredLookupQuery.trim();

    if (!eventId || query.length < 2) {
      setLookupItems([]);
      return;
    }

    let isActive = true;
    const timer = window.setTimeout(() => {
      void lookupCheckInCandidates(eventId, query, 8).then((result) => {
        if (!isActive || result.error || !result.data) return;
        setLookupItems(result.data.items ?? []);
      });
    }, 250);

    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [deferredLookupQuery, eventId]);

  const destroyScanner = useCallback(async (instance: ScannerInstance | null) => {
    if (!instance) return;
    try {
      await instance.stop();
    } catch {
      // Scanner bisa saja sudah berhenti saat komponen di-unmount.
    }
    try {
      instance.clear();
    } catch {
      // Abaikan error cleanup.
    }
  }, []);

  useEffect(() => {
    if (workspaceMode !== "scanner") {
      void destroyScanner(scannerRef.current);
      scannerRef.current = null;
      setScannerState("idle");
    }
  }, [destroyScanner, workspaceMode]);

  useEffect(() => {
    return () => {
      void destroyScanner(scannerRef.current);
      scannerRef.current = null;
    };
  }, [destroyScanner]);

  const applyActionResult = useCallback(
    (result: CheckInActionResult) => {
      const name = getDisplayName(result.registration);
      const isDuplicate = result.outcome === "already_checked_in";

      setFeedback({
        tone: isDuplicate ? "warning" : "success",
        title: isDuplicate ? "Sudah check-in sebelumnya" : "Check-in berhasil",
        message: result.message,
        name,
        method: result.registration.checkIn?.scanMethod ?? "scan",
        at: result.registration.checkIn?.checkedInAt ?? null,
      });
    },
    [],
  );

  const handleScanPayload = useCallback(
    async (rawValue: string) => {
      const payload = rawValue.trim();
      if (!eventId || !payload || scanLockRef.current) return;

      const now = Date.now();
      const last = lastScanRef.current;
      if (last && last.payload === payload && now - last.at < DUPLICATE_SCAN_WINDOW_MS) {
        return;
      }
      lastScanRef.current = { payload, at: now };

      scanLockRef.current = true;
      setIsSubmitting(true);

      try {
        const result = await scanCheckIn(eventId, payload);
        if (result.error || !result.data) {
          setFeedback({
            tone: "error",
            title: "Check-in gagal",
            message: result.error ?? "QR tidak dikenali.",
          });
          return;
        }
        applyActionResult(result.data);
        await loadDeskData();
        setLookupQuery("");
      } finally {
        setIsSubmitting(false);
        scanLockRef.current = false;
      }
    },
    [applyActionResult, eventId, loadDeskData],
  );

  const handleStartScanner = async () => {
    if (!canUseCamera || scannerState === "starting" || scannerState === "running") return;

    setScannerError(null);
    setScannerState("starting");

    try {
      const module = (await import("html5-qrcode")) as unknown as ScannerModule;
      const scanner = new module.Html5Qrcode(SCANNER_REGION_ID);
      scannerRef.current = scanner;

      const config = {
        fps: 15,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const size = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.7);
          return { width: size, height: size };
        },
        rememberLastUsedCamera: true,
      };

      const onSuccess = (decodedText: string) => {
        void handleScanPayload(decodedText);
      };

      try {
        await scanner.start({ facingMode: "environment" }, config, onSuccess, undefined);
      } catch {
        const cameras = await module.Html5Qrcode.getCameras();
        if (!cameras.length) {
          throw new Error("Tidak ada kamera yang tersedia di browser ini.");
        }
        await scanner.start(cameras[0].id, config, onSuccess, undefined);
      }

      setScannerState("running");
    } catch (caught) {
      setScannerState("error");
      setScannerError(
        caught instanceof Error ? caught.message : "Kamera gagal dijalankan. Gunakan check-in manual.",
      );
      await destroyScanner(scannerRef.current);
      scannerRef.current = null;
    }
  };

  const handleStopScanner = async () => {
    await destroyScanner(scannerRef.current);
    scannerRef.current = null;
    setScannerState("idle");
  };

  const handleManualCheckIn = async (registrationId: string) => {
    if (!eventId) return;
    setIsSubmitting(true);

    try {
      const result = await manualCheckIn(eventId, registrationId, manualNotes);
      if (result.error || !result.data) {
        setFeedback({
          tone: "error",
          title: "Check-in manual gagal",
          message: result.error ?? "Peserta tidak dapat di-check-in.",
        });
        return;
      }

      applyActionResult(result.data);
      await loadDeskData();
      const lookupResult = await lookupCheckInCandidates(eventId, lookupQuery.trim(), 8);
      if (lookupResult.data) setLookupItems(lookupResult.data.items ?? []);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!eventId) {
    return (
      <div className="rounded-[24px] border border-dashed border-[#D7E1F0] bg-white px-6 py-12 text-center text-sm text-[#6B7280]">
        Event ID tidak ditemukan di URL.
      </div>
    );
  }

  if (!canCheckIn) {
    return (
      <div className="rounded-[24px] border border-dashed border-[#D7E1F0] bg-white px-6 py-12 text-center">
        <ShieldAlert className="mx-auto mb-4 text-[#94A3B8]" size={28} />
        <p className="text-base font-semibold text-[#0A2647]">Akses check-in tidak tersedia</p>
        <p className="mt-2 text-sm text-[#6B7280]">
          Akun Anda memerlukan permission <code>registrations:checkin</code>.
        </p>
      </div>
    );
  }

  const counts = stats?.counts;
  const statCards = [
    { label: "Ready Tickets", value: counts?.totalReadyCount ?? 0, icon: ClipboardCheck },
    { label: "Checked In", value: counts?.checkedInCount ?? 0, icon: UserCheck },
    { label: "Remaining Today", value: counts?.remainingCount ?? 0, icon: Users },
    { label: "Approved", value: counts?.approvedCount ?? 0, icon: CheckCircle2 },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-[#D7E1F0] bg-[#F8FAFD] p-8 shadow-[0_14px_30px_rgba(10,38,71,0.05)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#94A3B8]">
                Event Workspace
              </p>
              <span className="rounded-full border border-[#C9D7F3] bg-white px-3 py-1 text-xs font-semibold text-[#5B7398]">
                Check-In Desk
              </span>
            </div>
            <h1 className="text-[2.15rem] font-bold tracking-[-0.04em] text-[#0A2647]">
              {stats?.event?.title ?? "Check-In Desk"}
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-[#5B6B7F]">
              Scan QR tiket atau cari peserta secara manual untuk mencatat kehadiran.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to={`/events/${eventId}/participants`}
              className="inline-flex items-center justify-center rounded-[14px] border border-[#DCE5F2] bg-white px-4 py-3 text-sm font-semibold text-[#0A2647] transition hover:bg-[#F5F8FF]"
            >
              Kelola Peserta
            </Link>
            <button
              type="button"
              onClick={() => void loadDeskData()}
              className="inline-flex items-center justify-center gap-2 rounded-[14px] bg-[#0A2647] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#133A6F]"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-[18px] border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="rounded-[22px] border border-[#D7E1F0] bg-white p-5 shadow-[0_12px_28px_rgba(10,38,71,0.06)]"
          >
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">
                {card.label}
              </p>
              <card.icon size={18} className="text-[#2F5BFF]" />
            </div>
            <p className="mt-3 text-[1.9rem] font-bold tracking-[-0.04em] text-[#0A2647]">
              {isLoading ? "—" : card.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-[24px] border border-[#D7E1F0] bg-white p-6 shadow-[0_12px_28px_rgba(10,38,71,0.06)]">
          <div className="flex flex-wrap gap-3 border-b border-[#E5ECF6] pb-4">
            <button
              type="button"
              onClick={() => setWorkspaceMode("scanner")}
              className={`inline-flex items-center gap-2 rounded-[14px] px-4 py-2 text-sm font-semibold transition ${
                workspaceMode === "scanner"
                  ? "bg-[#0A2647] text-white"
                  : "bg-[#EDF3FF] text-[#5B6B7F] hover:text-[#0A2647]"
              }`}
            >
              <QrCode size={16} /> Scan QR
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceMode("manual")}
              className={`inline-flex items-center gap-2 rounded-[14px] px-4 py-2 text-sm font-semibold transition ${
                workspaceMode === "manual"
                  ? "bg-[#0A2647] text-white"
                  : "bg-[#EDF3FF] text-[#5B6B7F] hover:text-[#0A2647]"
              }`}
            >
              <Search size={16} /> Manual Lookup
            </button>
          </div>

          {workspaceMode === "scanner" ? (
            <div className="pt-6">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleStartScanner()}
                  disabled={!canUseCamera || scannerState === "starting" || scannerState === "running" || isSubmitting}
                  className="inline-flex items-center gap-2 rounded-[14px] bg-[#0A2647] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#133A6F] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Camera size={16} />
                  {scannerState === "running" ? "Scanner aktif" : "Mulai Scanner"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleStopScanner()}
                  disabled={scannerState !== "running"}
                  className="inline-flex items-center gap-2 rounded-[14px] border border-[#DCE5F2] bg-white px-4 py-2.5 text-sm font-semibold text-[#43556E] transition hover:bg-[#F5F8FF] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CameraOff size={16} /> Stop
                </button>
                <span className="rounded-full bg-[#F1F5F9] px-3 py-1 text-xs font-semibold text-[#64748B]">
                  Status: {scannerState}
                </span>
              </div>

              {!canUseCamera ? (
                <p className="mt-4 rounded-[14px] border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Kamera hanya tersedia di HTTPS atau localhost. Gunakan tab Manual Lookup.
                </p>
              ) : null}
              {scannerError ? (
                <p className="mt-4 rounded-[14px] border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {scannerError}
                </p>
              ) : null}

              <div
                id={SCANNER_REGION_ID}
                className="mt-6 min-h-[280px] overflow-hidden rounded-[20px] border border-[#DCE5F2] bg-[#0A2647]"
              />
              <p className="mt-3 text-xs leading-6 text-[#7B8CA3]">
                Arahkan kamera ke QR tiket peserta. Duplikat scan dalam 2,5 detik diabaikan otomatis.
              </p>
            </div>
          ) : (
            <div className="pt-6">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7B8CA3]">
                Cari peserta
              </label>
              <div className="mt-3 flex items-center gap-3 rounded-[16px] border border-[#DCE5F2] bg-[#F8FAFD] px-4 py-3">
                <Search size={16} className="text-[#7B8CA3]" />
                <input
                  value={lookupQuery}
                  onChange={(event) => setLookupQuery(event.target.value)}
                  placeholder="Minimal 2 karakter: nama, email, atau perusahaan"
                  className="w-full bg-transparent text-sm text-[#0A2647] outline-none placeholder:text-[#94A3B8]"
                />
              </div>
              <label className="mt-5 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7B8CA3]">
                Catatan check-in (opsional)
              </label>
              <textarea
                value={manualNotes}
                onChange={(event) => setManualNotes(event.target.value)}
                rows={2}
                className="mt-3 w-full rounded-[16px] border border-[#DCE5F2] bg-[#F8FAFD] p-4 text-sm text-[#0A2647] outline-none focus:border-[#AFC4F6]"
                placeholder="Contoh: tiket dicetak di lokasi"
              />

              <div className="mt-6 overflow-hidden rounded-[18px] border border-[#E5ECF6]">
                {lookupQuery.trim().length < 2 ? (
                  <p className="px-5 py-8 text-center text-sm text-[#7B8CA3]">
                    Ketik minimal 2 karakter untuk mencari peserta.
                  </p>
                ) : lookupItems.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-[#7B8CA3]">
                    Tidak ada peserta yang cocok.
                  </p>
                ) : (
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-[#F8FAFD] text-[11px] font-semibold uppercase tracking-[0.16em] text-[#94A3B8]">
                      <tr>
                        <th className="px-4 py-3">Peserta</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EEF3FA]">
                      {lookupItems.map((item) => {
                        const alreadyCheckedIn =
                          Boolean(item.checkIn?.checkedInAt) || item.status === "checked_in";

                        return (
                          <tr key={item._id} className="hover:bg-[#F8FAFF]">
                            <td className="px-4 py-3">
                              <p className="font-semibold text-[#0A2647]">{getDisplayName(item)}</p>
                              <p className="text-xs text-[#7B8CA3]">
                                {item.companySnapshot?.name ?? "-"}
                              </p>
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex rounded-full bg-[#EAF1FF] px-3 py-1 text-xs font-semibold text-[#3B82F6]">
                                {item.status ?? "-"}
                              </span>
                              {alreadyCheckedIn ? (
                                <p className="mt-1 text-xs text-emerald-600">
                                  {formatCheckInTime(item.checkIn?.checkedInAt)}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => void handleManualCheckIn(item._id)}
                                disabled={alreadyCheckedIn || isSubmitting}
                                className="rounded-[12px] bg-[#0A2647] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#133A6F] disabled:cursor-not-allowed disabled:bg-slate-300"
                              >
                                {alreadyCheckedIn ? "Sudah hadir" : "Check-in"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <div className="rounded-[24px] border border-[#D7E1F0] bg-white p-6 shadow-[0_12px_28px_rgba(10,38,71,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7B8CA3]">
              Event Snapshot
            </p>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-[14px] bg-[#F8FAFD] px-4 py-3">
                <span className="text-[#6B7280]">Disetujui</span>
                <span className="font-bold text-[#0A2647]">{counts?.approvedCount ?? 0}</span>
              </div>
              <div className="flex items-center justify-between rounded-[14px] bg-[#EAF1FF] px-4 py-3">
                <span className="text-[#5B7398]">Sudah check-in</span>
                <span className="font-bold text-[#0A2647]">{counts?.checkedInCount ?? 0}</span>
              </div>
              <div className="flex items-center justify-between rounded-[14px] bg-[#F8FAFD] px-4 py-3">
                <span className="text-[#6B7280]">Belum hadir</span>
                <span className="font-bold text-[#0A2647]">{counts?.remainingCount ?? 0}</span>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-[#D7E1F0] bg-white p-6 shadow-[0_12px_28px_rgba(10,38,71,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7B8CA3]">
              Hasil Terakhir
            </p>
            {feedback ? (
              <div className={`mt-4 rounded-[16px] border px-4 py-4 text-sm ${feedbackStyles[feedback.tone]}`}>
                <p className="font-bold">{feedback.title}</p>
                {feedback.name ? <p className="mt-1">{feedback.name}</p> : null}
                <p className="mt-1 text-xs opacity-80">{feedback.message}</p>
                {feedback.at ? (
                  <p className="mt-2 text-xs opacity-80">
                    {feedback.method?.toUpperCase()} • {formatCheckInTime(feedback.at)}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-sm text-[#7B8CA3]">
                Belum ada check-in pada sesi ini.
              </p>
            )}
          </div>
        </aside>
      </div>

      <section className="rounded-[24px] border border-[#D7E1F0] bg-white p-6 shadow-[0_12px_28px_rgba(10,38,71,0.06)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7B8CA3]">
              Aktivitas Terbaru
            </p>
            <h2 className="mt-1 text-lg font-bold text-[#0A2647]">Check-in tercatat</h2>
          </div>
          <button
            type="button"
            onClick={() => void loadDeskData()}
            className="inline-flex items-center gap-2 rounded-[12px] border border-[#DCE5F2] px-3 py-2 text-xs font-semibold text-[#43556E] transition hover:bg-[#F5F8FF]"
          >
            <RefreshCw size={14} /> Refresh tabel
          </button>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#F8FAFD] text-[11px] font-semibold uppercase tracking-[0.16em] text-[#94A3B8]">
              <tr>
                <th className="px-6 py-4">Nama</th>
                <th className="px-6 py-4">Perusahaan</th>
                <th className="px-6 py-4">Metode</th>
                <th className="px-6 py-4">Waktu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF3FA]">
              {recentItems.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-sm text-[#7B8CA3]">
                    Belum ada peserta yang check-in.
                  </td>
                </tr>
              ) : (
                recentItems.map((item) => (
                  <tr key={item._id} className="hover:bg-[#F8FAFF]">
                    <td className="px-6 py-4 font-semibold text-[#0A2647]">
                      {getDisplayName(item)}
                    </td>
                    <td className="px-6 py-4 text-[#5B6B7F]">
                      {item.companySnapshot?.name ?? "-"}
                    </td>
                    <td className="px-6 py-4">
                      <span className="rounded-full bg-[#E6F9F0] px-3 py-1 text-xs font-semibold text-emerald-700">
                        {item.checkIn?.scanMethod ?? "-"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-[#5B6B7F]">
                      {formatCheckInTime(item.checkIn?.checkedInAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default CheckInDesk;
