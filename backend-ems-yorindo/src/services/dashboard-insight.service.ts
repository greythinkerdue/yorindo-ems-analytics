/**
 * @file services/dashboard-insight.service.ts
 * @description AI operations brief for the global dashboard.
 *
 * Prinsip: backend sudah menghitung fakta. AI hanya memilih prioritas
 * dan merangkai kalimat eksekusi, bukan mengulang angka KPI.
 */

import {
  DashboardCache,
  DASHBOARD_BRIEF_CACHE_KEY,
} from "../models/index.ts";
import { chat } from "../utils/llmClient.ts";
import { getCachedDashboardOverview } from "./dashboard-overview-cache.service.ts";
import type { DashboardOverview } from "./dashboard.service.ts";

export interface DashboardOperationsBrief {
  focus: string;
  reason: string;
  actions: string[];
  generatedAt: string;
  dataUpdatedAt: string;
  cached: boolean;
}

type BriefInsight = Omit<DashboardOperationsBrief, "cached">;

/** Safety net: regenerate at least once a day even if the version is stable. */
const BRIEF_TTL_MS = 24 * 60 * 60 * 1000;

/** Singleflight for the cold-cache case (two dashboard requests in parallel). */
let inflight: Promise<BriefInsight> | null = null;

function normalizeText(value: string): string {
  return value
    .replace(/ticket delivery idle/gi, "tiket belum dikirim")
    .replace(/(\d+)\s+tiket idle/gi, "$1 tiket")
    .replace(/tiket idle/gi, "tiket belum dikirim")
    .replace(/approval rate/gi, "approval")
    .replace(/attendance rate/gi, "kehadiran")
    .replace(/tickets? not sent/gi, "tiket belum dikirim")
    .replace(/pending approvals?/gi, "pendaftar yang menunggu")
    .replace(/pending persetujuan/gi, "pendaftar yang menunggu")
    .replace(/approval tertunda/gi, "pendaftar yang menunggu")
    .replace(/approval\s+(yang\s+)?menunggu/gi, "pendaftar yang menunggu")
    .replace(/\bbacklog\b/gi, "pendaftar yang menunggu")
    .replace(/\sdalam\s+\d+\s*(jam|hari)\b/gi, "")
    .replace(/\s+hari ini\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/hubungi peserta[^.]*konfirmasi\./gi, "Perbarui data kehadiran peserta.")
    .replace(/kirim survei[^.]*\./gi, "Perbarui data kehadiran peserta.")
    .replace(/\s+([.,])/g, "$1")
    .trim();
}

function tidyText(value: string): string {
  const text = normalizeText(value);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function buildOverviewPrompt(overview: DashboardOverview): string {
  const payload = {
    dataUpdatedAt: overview.dataUpdatedAt,
    watchlist: overview.watchlist,
    nextEvent: overview.nextEvent,
    kpis: overview.kpis,
  };

  return `
Kamu manajer operasional event Yorindo Communication. Buat SATU prioritas eksekusi dari data di bawah. Ini bukan ringkasan dashboard dan bukan laporan mingguan.

DATA:
${JSON.stringify(payload)}

CARA KERJA:
1. Pilih SATU event paling mendesak dari watchlist. Utamakan attention "high", lalu kedekatan tanggal event, lalu jumlah pendaftar yang menunggu.
2. "focus" = SATU kalimat, diawali kata kerja konkret, menyebut judul event PERSIS dan SATU angka dari data. Maksimal satu angka. Dilarang membuka dengan "Fokus", "Perlu", "Pastikan", atau "Pastikan bahwa". Contoh benar: "Setujui 12 pendaftar di SEMICON 2026."
3. "reason" = SATU kalimat yang menjelaskan angka yang SAMA PERSIS dengan "focus". Pakai metrik yang sama, jangan metrik lain. Diawali nama metrik, bukan "Ada". Contoh: focus "Kirim 14 tiket ke peserta SEMICON 2026." → reason "Tiket belum dikirim di event tersebut 14." Gunakan istilah: tiket belum dikirim, pendaftar yang menunggu, approval, kehadiran.
4. "actions" = 0 sampai 2 kalimat lanjutan dengan metrik BERBEDA dari focus dan saling berbeda. Jika event masih sama, sebut "event tersebut", jangan ulang judul panjang. Jika beda event, sebut judul event PERSIS. Tiap aksi menyebut SATU angka dan kata kerja konkret. Dilarang mengulang aksi di "focus". Jika tidak ada metrik lain yang benar-benar bisa dieksekusi, berikan SATU aksi saja.
5. Kata kerja yang diperbolehkan: setujui, kirim, update, rapikan, arsipkan, konfirmasi. Dilarang kata kerja abstrak: dorong, tingkatkan, percepat, optimalkan, perkuat, maksimalkan, evaluasi, awasi, pastikan, perbaiki, fokus. Dilarang aksi mengubah angka ringkasan seperti "update total pendaftaran menjadi 16". Aksi hanya boleh menyentuh pendaftar, tiket, data kehadiran, atau arsip event.
6. Sesuaikan status event. Untuk event "done" atau "cancelled", hanya gunakan "rapikan" atau "arsipkan". Dilarang menyarankan konfirmasi kehadiran, survei, kampanye, atau email broadcast.
7. Dilarang mengarang nama tim/divisi, tenggat ("dalam 24 jam", "hari ini"), tanggal baru, pendapatan, atau data yang tidak ada di input.
8. Bahasa Indonesia, tanpa Markdown, tanpa label "Prioritas 1", maksimal 80 kata total.
9. Jika watchlist kosong: focus = "Rapikan arsip event yang sudah selesai.", reason = "Belum ada event yang perlu tindakan.", actions = [].

BALAS HANYA JSON valid dengan format:
{
  "focus": "Kirim 14 tiket ke peserta NAMA EVENT.",
  "reason": "Tiket belum dikirim di event tersebut 14.",
  "actions": ["Setujui 4 pendaftar di event tersebut."]
}
`.trim();
}

function safeParse(
  content: string,
  dataUpdatedAt: string,
  fallback: Pick<BriefInsight, "focus" | "reason">,
): BriefInsight {
  const generatedAt = new Date().toISOString();

  try {
    const parsed = JSON.parse(content) as {
      focus?: unknown;
      reason?: unknown;
      actions?: unknown;
    };
    const actions = Array.isArray(parsed.actions)
      ? parsed.actions
          .filter((item): item is string => typeof item === "string")
          .map(tidyText)
          .filter(Boolean)
          .slice(0, 2)
      : [];

    return {
      focus: tidyText(typeof parsed.focus === "string" ? parsed.focus : "") || fallback.focus,
      reason: tidyText(typeof parsed.reason === "string" ? parsed.reason : "") || fallback.reason,
      actions,
      generatedAt,
      dataUpdatedAt,
    };
  } catch {
    return {
      focus: tidyText(content.trim()) || fallback.focus,
      reason: fallback.reason,
      actions: [],
      generatedAt,
      dataUpdatedAt,
    };
  }
}

function buildFallback(overview: DashboardOverview) {
  const first = overview.watchlist[0];
  if (!first) {
    return {
      focus: "Rapikan arsip event yang sudah selesai.",
      reason: "Belum ada event yang perlu tindakan.",
    };
  }
  return {
    focus: `${first.title}: ${first.reason}`,
    reason: first.attention === "high" ? "Event ini masuk kategori perlu tindakan." : "Event ini masuk kategori dipantau.",
  };
}

export async function getDashboardOperationsBrief(
  refresh = false,
): Promise<DashboardOperationsBrief> {
  // Shares the cached overview with /analytics/overview, so its aggregations
  // and rollup reads run at most once per data version even when both
  // endpoints are hit in the same request window.
  const overview = await getCachedDashboardOverview(refresh);
  const version = overview.dataUpdatedAt;

  if (!refresh) {
    const cached = await DashboardCache.findOne({
      key: DASHBOARD_BRIEF_CACHE_KEY,
      version,
    })
      .select("payload expiresAt")
      .lean<{ payload: BriefInsight; expiresAt: Date } | null>();

    if (cached && new Date(cached.expiresAt).getTime() > Date.now()) {
      return { ...cached.payload, cached: true };
    }
  }

  if (inflight) return { ...(await inflight), cached: true };

  inflight = (async () => {
    const content = await chat([
      {
        role: "developer",
        content: "Kamu manajer operasional event. Ikuti format JSON dengan ketat dan pilih satu prioritas saja.",
      },
      { role: "user", content: buildOverviewPrompt(overview) },
    ]);

    const insight = safeParse(
      String(content),
      version,
      buildFallback(overview),
    );

    await DashboardCache.findOneAndUpdate(
      { key: DASHBOARD_BRIEF_CACHE_KEY },
      {
        $set: {
          payload: insight,
          version,
          generatedAt: new Date(),
          expiresAt: new Date(Date.now() + BRIEF_TTL_MS),
        },
      },
      { upsert: true },
    );

    return insight;
  })();

  try {
    return { ...(await inflight), cached: false };
  } finally {
    inflight = null;
  }
}
