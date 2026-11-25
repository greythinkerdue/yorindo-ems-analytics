/**
 * @file services/event-analytic-insight.service.ts
 * @description AI-generated insights for event analytics.
 */

import { Types } from "mongoose";
import {
  getEventAnalyticsOverview,
  type EventAnalyticsOverview,
} from "./event-analytic.service.ts";
import { EventAnalyticInsightCache, Registration } from "../models/index.ts";
import { chat } from "../utils/llmClient.ts";

export interface EventAnalyticsInsight {
  summary: string;
  highlights: string[];
  recommendations: string[];
}

/** Mirrors parseMonthRange() in event-analytic.service.ts without DB work. */
function resolveMonthLabel(month?: string): string {
  if (month) return month;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Cheap cache signature (2 indexed queries) compared with the ~14 aggregate
 * queries needed to rebuild the insight. Any new/updated registration changes
 * it and invalidates the cached insight.
 */
async function buildSourceSignature(eventId: Types.ObjectId): Promise<string> {
  const [count, latest] = await Promise.all([
    Registration.countDocuments({ eventId }),
    Registration.findOne({ eventId })
      .select("updatedAt")
      .sort({ updatedAt: -1 })
      .lean<{ updatedAt: Date } | null>(),
  ]);
  const latestAt = latest?.updatedAt
    ? new Date(latest.updatedAt).toISOString()
    : "";
  return `${count}:${latestAt}`;
}

/**
 * Insight harus dipakai untuk puluhan event dengan status berbeda, bukan
 * satu event contoh. Karena itu prompt-nya:
 * - lifecycle-aware (upcoming/ongoing/done/cancelled diperlakukan beda),
 * - diberi konteks event + benchmark agar tidak mengarang "bagus/buruk",
 * - ditulis untuk orang lapangan, bukan jargon analis,
 * - highlights = metrik + makna, recommendations = satu aksi (1:1, tanpa duplikasi).
 */
function buildPrompt(overview: EventAnalyticsOverview): string {
  return `
Kamu adalah analyst operasional Yorindo Communication. Yorindo punya banyak event dengan status dan tanggal berbeda-beda. Baca data SATU event di bawah, lalu beri catatan singkat yang bisa langsung dipakai panitia event itu. Jangan meniru pola insight dari event lain.

KONTEKS EVENT:
${JSON.stringify(overview.event)}

DATA EVENT INI:
${JSON.stringify({
  summary: overview.summary,
  statusBreakdown: overview.statusBreakdown,
  registrationsOverTime: overview.registrationsOverTime,
  topIndustries: overview.topIndustries,
  topCities: overview.topCities,
  topRejectionReasons: overview.topRejectionReasons,
  ticketDeliveryBreakdown: overview.ticketDeliveryBreakdown,
})}

PEMBANDING (rata-rata event lain):
${JSON.stringify(overview.benchmark)}

CARA KERJA:
1. Ikuti STATUS event. upcoming/registration = fokus kesiapan pendaftaran, approval, dan tiket sebelum acara. ongoing = fokus check-in dan yang belum hadir. done = evaluasi dan rapikan data; jangan menghubungi peserta untuk konfirmasi kehadiran dan jangan bilang "sebelum acara". cancelled = konfirmasi pembatalan dan bersihkan data.
2. Tanggal asli sudah ada di KONTEKS EVENT. Jangan mengarang tanggal lain, nama tim/divisi, kapasitas, biaya, atau alasan yang tidak tertulis di data.
3. Tulis seperti analyst yang mempresentasikan finding ke atasan: ringkas, sopan, profesional, tanpa basa-basi. Sajikan angka sebagai persentase, misal "Kehadiran 77.8%", "Approval 20%", "100% tiket belum dikirim" — bukan "7 dari 9 hadir". Dilarang pola "Dari 5 pendaftar, hanya 1 ..."; cukup "Approval 20%, di bawah rata-rata 62.7%.". Jangan pakai istilah teknis "ticket delivery idle" atau "tiket idle"; cukup "tiket belum dikirim". Dilarang jargon: conversion, funnel, upsell, no-show rate, product-market fit, segmentasi, engagement. Satu kalimat = satu metrik. Dilarang menggabung dua angka dengan "dengan", "serta", atau "dan juga". Dilarang kata kerja abstrak: dorong, tingkatkan, meningkatkan, optimalkan, perkuat, maksimalkan, evaluasi, awasi, pastikan, perbaiki, fokus. Pakai kata kerja konkret: hubungi, kirim, setujui, arsipkan, konfirmasi, jadwalkan, minta, update.
4. Tulis hanya hal yang bisa dicek atau dikerjakan. Maksimal 3 poin. Kalau cuma satu yang penting, tulis satu saja. Jangan mengisi poin dengan kalimat basa-basi seperti "perlu ditingkatkan".
5. highlights[i] = metrik + artinya SAJA, TANPA aksi dan tanpa tanda panah. recommendations[i] = SATU aksi konkret untuk temuan pada indeks yang sama. Jumlah dan urutan harus sama persis (1:1). Dilarang mengulang teks aksi di highlights. Aksi diawali kata kerja, menyebut objek jelas, bisa langsung dikerjakan panitia — bukan "perlu ditingkatkan", tanpa nama tim dan tanpa tanggal buatan.
6. Pakai PEMBANDING hanya kalau membantu, sebut sebagai "rata-rata event lain". Abaikan kalau eventsCompared = 0.
7. Kalau event belum punya pendaftar, jangan menulis "data masih sedikit". Tulis satu hal yang memang bisa dicek dari tahap event dan satu langkah konkret.
8. Maksimal 150 kata. Tanpa Markdown, tanpa label "Fakta/Makna/Tindakan", tanpa "Prioritas 1".

BALAS HANYA JSON valid dengan format:
{
  "summary": "Satu kalimat keputusan, diawali kata kerja konkret, satu prioritas, maksimal satu angka.",
  "highlights": ["Approval 20%, di bawah rata-rata 62.7%.", "100% tiket belum dikirim."],
  "recommendations": ["Setujui pendaftar yang menunggu.", "Kirim tiket ke seluruh peserta."]
}
`.trim();
}

function normalizeInsightText(value: string): string {
  return value
    .replace(/ticket delivery idle/gi, "tiket belum dikirim")
    .replace(/(\d+)\s+tiket idle/gi, "$1 tiket")
    .replace(/tiket idle/gi, "tiket belum dikirim")
    .trim();
}

function safeParse(content: string): EventAnalyticsInsight {
  try {
    const parsed = JSON.parse(content) as Partial<EventAnalyticsInsight>;
    const highlights = Array.isArray(parsed.highlights)
      ? parsed.highlights
          .filter((item): item is string => typeof item === "string")
          .map(normalizeInsightText)
      : [];
    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations
          .filter((item): item is string => typeof item === "string")
          .map(normalizeInsightText)
      : [];

    // Jamin tiap finding punya pasangan aksi, walau LLM keliru jumlahnya.
    const pairCount = Math.min(highlights.length, recommendations.length);

    return {
      summary: normalizeInsightText(
        typeof parsed.summary === "string" ? parsed.summary : "",
      ),
      highlights: highlights.slice(0, pairCount),
      recommendations: recommendations.slice(0, pairCount),
    };
  } catch {
    return {
      summary: content.trim(),
      highlights: [],
      recommendations: [],
    };
  }
}

export async function getEventAnalyticsInsights(
  eventId: string,
  month?: string,
  options?: { refresh?: boolean },
): Promise<EventAnalyticsInsight | null> {
  const refresh = options?.refresh ?? false;
  const eventObjectId = new Types.ObjectId(eventId);
  const monthLabel = resolveMonthLabel(month);

  // Cache check comes FIRST. Previously the 14-query overview was computed
  // before this lookup, so a cache hit still paid the full aggregation cost.
  let sourceSignature = "";
  if (!refresh) {
    sourceSignature = await buildSourceSignature(eventObjectId);
    const cached = await EventAnalyticInsightCache.findOne({
      eventId: eventObjectId,
      month: monthLabel,
    })
      .select("summary highlights recommendations sourceSignature")
      .lean();

    if (cached && cached.sourceSignature === sourceSignature) {
      return {
        summary: cached.summary,
        highlights: cached.highlights,
        recommendations: cached.recommendations,
      };
    }
  }

  const overview = await getEventAnalyticsOverview(eventId, month);
  if (!overview) return null;

  if (!sourceSignature) {
    sourceSignature = await buildSourceSignature(eventObjectId);
  }

  const content = await chat([
    {
      role: "developer",
      content:
        "Kamu analis data yang ringkas. Ikuti instruksi format JSON dengan ketat.",
    },
    {
      role: "user",
      content: buildPrompt(overview),
    },
  ]);

  const insight = safeParse(String(content));

  await EventAnalyticInsightCache.findOneAndUpdate(
    { eventId: eventObjectId, month: monthLabel },
    {
      $set: {
        summary: insight.summary,
        highlights: insight.highlights,
        recommendations: insight.recommendations,
        sourceSignature,
        generatedAt: new Date(),
      },
    },
    { upsert: true },
  );

  return insight;
}
