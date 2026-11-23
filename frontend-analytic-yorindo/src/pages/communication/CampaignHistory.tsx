import { useDeferredValue, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Clock3, Info, LoaderCircle, Search, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, apiPaths } from "@/services/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type CampaignStatus =
  | "all"
  | "draft"
  | "queued"
  | "processing"
  | "sent"
  | "partial"
  | "failed";

type CampaignHistoryResponse = {
  items: CampaignHistoryItem[];
  summary: {
    total: number;
    statusCounts: Record<string, number>;
  };
};

type CampaignHistoryItem = {
  id: string;
  status: Exclude<CampaignStatus, "all">;
  templateId: "executive_brief" | "event_spotlight" | "minimal_notice";
  templateName: string;
  previewText: string | null;
  subject: string;
  recipientCount: number;
  delivery: {
    successCount: number;
    failureCount: number;
    failures: Array<{
      email: string;
      reason: string;
    }>;
  };
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  event: {
    id: string | null;
    title: string | null;
    eventDate: string | null;
  };
  createdBy: {
    id: string;
    name: string;
    email: string;
  } | null;
};

const STATUS_OPTIONS: Array<{
  value: CampaignStatus;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "processing", label: "Processing" },
  { value: "sent", label: "Sent" },
  { value: "partial", label: "Partial" },
  { value: "failed", label: "Failed" },
  { value: "draft", label: "Drafts" },
];

const STATUS_HELP = [
  "Draft: pesan tersimpan, belum dikirim.",
  "Queued: menunggu antrean pengiriman.",
  "Processing: sedang dikirim ke penerima.",
  "Sent: seluruh penerima berhasil menerima email.",
  "Partial: sebagian berhasil, sebagian gagal.",
  "Failed: seluruh pengiriman gagal.",
].join("\n");

function readStatus(value: string | null): CampaignStatus {
  return STATUS_OPTIONS.some((option) => option.value === value)
    ? (value as CampaignStatus)
    : "all";
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not sent";
  }

  return new Date(value).toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatEventDate(value: string | null) {
  if (!value) {
    return "No event date";
  }

  return new Date(value).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const statusStyles: Record<string, string> = {
  sent: "bg-emerald-50 text-emerald-600 border-emerald-200",
  partial: "bg-indigo-50 text-indigo-600 border-indigo-200",
  queued: "bg-blue-50 text-blue-600 border-blue-200",
  processing: "bg-yellow-50 text-yellow-600 border-yellow-200",
  draft: "bg-[#F8FAFD] text-[#94A3B8] border-[#E3EAF5]",
  failed: "bg-red-50 text-red-600 border-red-200",
};

const dotStyles: Record<string, string> = {
  sent: "bg-emerald-400",
  partial: "bg-indigo-400",
  queued: "bg-blue-400",
  processing: "bg-yellow-400",
  draft: "bg-slate-300",
  failed: "bg-red-400",
};

function getDeliveryLabel(item: CampaignHistoryItem) {
  if (item.status === "draft") {
    return "Not sent";
  }

  if (item.status === "queued") {
    return "Waiting to send";
  }

  if (item.status === "processing") {
    return "Sending";
  }

  return `${item.delivery.successCount} sent · ${item.delivery.failureCount} failed`;
}

export function CampaignHistory() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<CampaignStatus>(() =>
    readStatus(searchParams.get("status")),
  );
  const [searchInput, setSearchInput] = useState(
    () => searchParams.get("search") ?? "",
  );
  const [history, setHistory] = useState<CampaignHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const deferredSearch = useDeferredValue(searchInput);

  useEffect(() => {
    const nextStatus = readStatus(searchParams.get("status"));
    if (nextStatus !== status) {
      setStatus(nextStatus);
    }
  }, [searchParams]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);

    if (status !== "all") {
      nextParams.set("status", status);
    } else {
      nextParams.delete("status");
    }

    const normalizedSearch = deferredSearch.trim();
    if (normalizedSearch) {
      nextParams.set("search", normalizedSearch);
    } else {
      nextParams.delete("search");
    }

    // Only update if something actually changed
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [deferredSearch, status]); // Removed searchParams to stop the loop

  useEffect(() => {
    const params = new URLSearchParams();

    if (status !== "all") {
      params.set("status", status);
    }

    const normalizedSearch = deferredSearch.trim();

    if (normalizedSearch) {
      params.set("search", normalizedSearch);
    }

    setIsLoading(true);
    setError("");

    void api
      .get<CampaignHistoryResponse>(
        `${apiPaths.communications}/campaigns${params.toString() ? `?${params.toString()}` : ""}`,
      )
      .then((result) => {
        if (!result.data) {
          setHistory(null);
          setError(result.error ?? "Failed to load campaign history.");
          setIsLoading(false);
          return;
        }

        setHistory(result.data);
        setError("");
        setIsLoading(false);
      });
  }, [deferredSearch, status]);

  const totalCampaigns = history?.summary.total ?? 0;
  const queuedCount =
    (history?.summary.statusCounts.queued ?? 0) +
    (history?.summary.statusCounts.processing ?? 0);
  const deliveredCount =
    (history?.summary.statusCounts.sent ?? 0) +
    (history?.summary.statusCounts.partial ?? 0);
  const failedCount = history?.summary.statusCounts.failed ?? 0;
  const draftCount = history?.summary.statusCounts.draft ?? 0;

  return (
    <div className="workspace-shell">
      <title>Yorindo EMS - Campaign History</title>
      <div className="space-y-8">
        <div className="workspace-header">
          <div className="space-y-2">
            <p className="workspace-eyebrow">Communication Workspace</p>
            <h1 className="workspace-title">Campaign History</h1>
            <p className="workspace-subtitle">
              Monitor drafts and delivery results after the broadcast is sent.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              size="lg"
              asChild
              className="flex items-center gap-2 rounded-[14px] bg-[#0A2647] px-6 py-2.5 text-sm font-bold text-white shadow-lg transition hover:bg-[#133A6F] active:scale-95"
            >
              <Link to="/communication">
                <SendHorizontal className="mr-2 h-4 w-4" aria-hidden="true" />
                Create Campaign
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="workspace-card bg-[#F8FAFD]">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#94A3B8]">
              Total
            </p>
            <p className="mt-2 text-3xl font-bold text-[#1d376b] tabular-nums">
              {totalCampaigns}
            </p>
            <p className="mt-1 text-xs text-[#5B6B7F]">
              Total campaigns in this view.
            </p>
          </div>

          <div className="workspace-card border-amber-200 bg-amber-50/70">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-700">
              Sending
            </p>
            <p className="mt-2 text-3xl font-bold text-amber-900 tabular-nums">
              {queuedCount}
            </p>
            <p className="mt-1 text-xs text-amber-700/80">
              Campaigns currently being sent.
            </p>
          </div>

          <div className="workspace-card border-emerald-200 bg-emerald-50/70">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-700">
              Delivered
            </p>
            <p className="mt-2 text-3xl font-bold text-emerald-900 tabular-nums">
              {deliveredCount}
            </p>
            <p className="mt-1 text-xs text-emerald-700/80">
              Campaigns sent successfully.
            </p>
          </div>

          <div className="workspace-card border-rose-200 bg-rose-50/70">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-rose-700">
              Failed / Draft
            </p>
            <p className="mt-2 text-3xl font-bold text-rose-900 tabular-nums">
              {failedCount + draftCount}
            </p>
            <p className="mt-1 text-xs text-rose-700/80">
              Failed or not yet sent.
            </p>
          </div>
        </div>

        <section className="workspace-card">
          <div className="flex flex-col gap-4 border-b border-[#E3EAF5] pb-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((option) => {
                const isActive = status === option.value;
                const count =
                  option.value === "all"
                    ? (history?.summary.total ?? 0)
                    : (history?.summary.statusCounts[option.value] ?? 0);

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStatus(option.value)}
                    className={`rounded-[14px] px-4 py-2 text-sm font-semibold transition ${
                      isActive
                        ? "bg-[#0A2647] text-white shadow-[0_10px_18px_rgba(10,38,71,0.16)]"
                        : "bg-[#EDF3FF] text-[#5B6B7F] hover:bg-[#DCE7FF] hover:text-[#0A2647]"
                    }`}
                  >
                    {option.label}{" "}
                    <span
                      className={isActive ? "text-white/70" : "text-[#94A3B8]"}
                    >
                      ({count})
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative w-full lg:max-w-sm">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]"
                aria-hidden="true"
              />
              <Input
                type="search"
                name="campaign-history-search"
                value={searchInput}
                autoComplete="off"
                placeholder="Search subject, event, creator…"
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-11 pl-10 bg-background border-[#E3EAF5] rounded-[14px] focus-visible:ring-1 focus-visible:ring-indigo-400 transition-all"
              />
            </div>
          </div>

          {draftCount > 0 ? (
            <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {draftCount} drafts are still active and can be reopened from the
              composer or directly from the table below.
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="mt-5 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-4 text-sm text-rose-600"
            >
              {error}
            </div>
          ) : null}

          <div className="mt-5 overflow-hidden rounded-[24px] border border-[#D7E1F0]">
            <Table>
              <TableHeader className="bg-[#F8FAFD]">
                <TableRow className="hover:bg-[#F8FAFD]">
                  <TableHead className="px-4">Event</TableHead>
                  <TableHead className="px-4">Campaign</TableHead>
                  <TableHead className="px-4">Delivery</TableHead>
                  <TableHead className="w-[100px] px-6 text-center">
                    <span className="inline-flex items-center justify-center gap-1.5">
                      Status
                      <span
                        title={STATUS_HELP}
                        aria-label={STATUS_HELP}
                        className="inline-flex cursor-help items-center text-[#94A3B8] transition hover:text-[#0A2647]"
                      >
                        <Info className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    </span>
                  </TableHead>
                  <TableHead className="text-center px-6">Action</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {isLoading ? (
                  <TableRow className="hover:bg-white ">
                    <TableCell colSpan={5} className="h-48 text-center ">
                      <div className="flex items-center justify-center gap-3 text-sm text-[#5B6B7F]">
                        <LoaderCircle
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                        Loading campaign history…
                      </div>
                    </TableCell>
                  </TableRow>
                ) : history?.items.length ? (
                  history.items.map((item) => (
                    <TableRow key={item.id} className="align-top">
                      {/* Event */}
                      <TableCell className="min-w-[12rem] px-4">
                        <div className="space-y-1">
                          <p className="font-medium text-slate-700">
                            {item.event.title ?? "All events"}
                          </p>
                          <p className="text-xs text-[#5B6B7F]">
                            {formatEventDate(item.event.eventDate)}
                          </p>
                        </div>
                      </TableCell>

                      {/* Campaign */}
                      <TableCell className="min-w-[18rem] px-4">
                        <div className="space-y-1">
                          <p className="font-semibold text-slate-800">
                            {item.subject || "Untitled campaign"}
                          </p>
                          <p className="text-xs text-[#5B6B7F]">
                            {item.templateName}
                            {item.previewText ? ` · ${item.previewText}` : ""}
                          </p>
                          <p className="text-xs text-[#94A3B8]">
                            by {item.createdBy?.name ?? "Unknown user"}
                            {item.createdBy?.email
                              ? ` · ${item.createdBy.email}`
                              : ""}
                          </p>
                        </div>
                      </TableCell>

                      {/* Delivery */}
                      <TableCell className="min-w-[12rem] px-4">
                        <div className="space-y-1">
                          <p className="font-medium text-slate-700">
                            {getDeliveryLabel(item)}
                          </p>
                          <p className="text-xs text-[#5B6B7F]">
                            Sent: {formatDateTime(item.sentAt)}
                          </p>
                        </div>
                      </TableCell>

                      {/* Status */}
                      <TableCell className="min-w-[6rem] px-7 text-center">
                        <div className="space-y-2">
                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold border ${statusStyles[item.status]}`}
                          >
                            <span
                              className={`w-1 h-1 rounded-full ${dotStyles[item.status] ?? "bg-slate-300"}`}
                              aria-hidden="true"
                            />
                            {item.status.toUpperCase()}
                          </span>
                          <p className="text-xs text-[#5B6B7F]">
                            {item.recipientCount} recipient
                            {item.recipientCount !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </TableCell>

                      {/* Action */}
                      <TableCell className="text-center min-w-[3rem] px-6">
                        {item.status === "draft" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            asChild
                            className="border-dashed"
                          >
                            <Link
                              to="/communication"
                              state={{ draftId: item.id }}
                            >
                              Open Draft
                            </Link>
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            asChild
                            className="border-dashed"
                          >
                            <Link to="/communication">New Message</Link>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="hover:bg-white">
                    <TableCell colSpan={5} className="h-48 text-center">
                      <div className="space-y-3 text-sm text-[#5B6B7F]">
                        <div className="inline-flex items-center gap-2 rounded-full border border-dashed border-[#D7E1F0] bg-[#F8FAFD] px-3 py-2 text-xs font-semibold text-slate-600">
                          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                          No campaign activity yet
                        </div>
                        <p>
                          Send your first campaign from the composer to see
                          queue and delivery activity here.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </div>
  );
}
