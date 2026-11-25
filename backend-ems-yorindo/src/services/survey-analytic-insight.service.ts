/**
 * @file services/survey-analytic-insight.service.ts
 * @description AI-generated insights for event survey responses.
 */

import {
  Event,
  EventAiInsightCache,
  SurveyResponse,
} from "../models/index.ts";
import { chat } from "../utils/llmClient.ts";

/** Bound the LLM prompt. totalResponses keeps the real count for the UI. */
const INSIGHT_SAMPLE_LIMIT = 200;

/** Safety net: regenerate at least once a day even if the version is stable. */
const INSIGHT_TTL_MS = 24 * 60 * 60 * 1000;

async function readSourceState(
  eventId: string,
): Promise<{ totalResponses: number; signature: string }> {
  const [totalResponses, latest] = await Promise.all([
    SurveyResponse.countDocuments({ eventId }),
    SurveyResponse.findOne({ eventId })
      .select("submittedAt updatedAt")
      .sort({ submittedAt: -1 })
      .lean<{ submittedAt?: Date; updatedAt?: Date } | null>(),
  ]);

  const latestAt = latest?.updatedAt ?? latest?.submittedAt;
  return {
    totalResponses,
    signature: `${totalResponses}:${
      latestAt ? new Date(latestAt).toISOString() : ""
    }`,
  };
}

export class SurveyInsightUnavailableError extends Error {
  statusCode = 400;
}

export interface SurveyAnalyticsInsight {
  summary: string;
  keyFindings: string[];
  exhibitorActions: string[];
  opportunityWatchout: string;
}

export interface EventSurveyInsightResult {
  eventId: string;
  insight: SurveyAnalyticsInsight;
  totalResponses: number;
}

/**
 * Survey tiap event berbeda. Prompt ini sengaja meminta hal yang bisa
 * dikerjakan panitia/exhibitor, bukan ringkasan jawaban atau jargon analis.
 */
function buildPrompt(eventTitle: string, answers: unknown[]): string {
  return `
Kamu adalah analyst operasional Yorindo Communication. Setiap event punya audiens berbeda, jangan pakai asumsi dari event lain. Baca jawaban survey event "${eventTitle}" dan beri catatan singkat yang bisa langsung dipakai.

DATA JAWABAN (JSON):
${JSON.stringify(answers)}

CARA KERJA:
1. Jangan mengulang data mentah atau menjelaskan struktur JSON.
2. Cari yang bisa diubah: apa yang mereka mau, apa yang bikin ragu, apa yang belum terjawab, dan kata khas yang mereka pakai. Kutip maksimal 6 kata kalau perlu.
3. Tulis seperti analyst yang mempresentasikan finding ke atasan: ringkas, sopan, profesional. Bila pola bisa dihitung, pakai persentase ("60% menyebut harga"), bukan "6 dari 10". Dilarang jargon: pain point, buying signal, conversion, product-market fit, engagement. Satu kalimat = satu metrik. Dilarang menggabung dua angka dengan "dengan", "serta", atau "dan juga". Dilarang kata kerja abstrak: dorong, tingkatkan, meningkatkan, optimalkan, perkuat, maksimalkan, evaluasi, awasi, pastikan, perbaiki, fokus. Pakai kata kerja konkret: hubungi, kirim, siapkan, sediakan, tanyakan, jadwalkan, minta, update.
4. Jangan mengarang demografi, pendapatan, niat beli, atau alasan. Kalau tidak ada pola yang jelas, katakan terus terang dan sarankan satu pertanyaan lanjutan.
5. keyFindings[i] = temuan + artinya SAJA, TANPA aksi dan tanpa tanda panah (pakai persentase bila bisa dihitung). exhibitorActions[i] = SATU aksi konkret untuk temuan pada indeks yang sama. Jumlah dan urutan 1:1. Dilarang mengulang teks aksi di keyFindings. Aksi diawali kata kerja, bisa langsung dikerjakan exhibitor/panitia, tanpa nama tim dan tanpa tanggal buatan.
6. Maksimal 150 kata. Tanpa Markdown, tanpa label "Bukti/Makna", tanpa "Sinyal 1", tanpa basa-basi.

BALAS HANYA JSON valid dengan format:
{
  "summary": "Satu kalimat: pola audiens paling penting, diawali kata kerja konkret, maksimal satu angka. Contoh: 'Siapkan paket harga bertingkat.'",
  "keyFindings": ["60% menyebut harga.", "Temuan lain dan artinya."],
  "exhibitorActions": ["Siapkan paket harga bertingkat.", "Aksi lain."],
  "opportunityWatchout": "Satu kalimat: pertanyaan lanjutan yang perlu ditanyakan lagi."
}
`.trim();
}

function safeParse(content: string): SurveyAnalyticsInsight {
  try {
    const parsed = JSON.parse(content) as Partial<SurveyAnalyticsInsight>;

    const summary = typeof parsed.summary === "string" ? parsed.summary : "";
    const keyFindings = Array.isArray(parsed.keyFindings)
      ? parsed.keyFindings.filter((item): item is string => typeof item === "string")
      : [];
    const exhibitorActions = Array.isArray(parsed.exhibitorActions)
      ? parsed.exhibitorActions.filter((item): item is string => typeof item === "string")
      : [];
    const opportunityWatchout =
      typeof parsed.opportunityWatchout === "string" ? parsed.opportunityWatchout : "";

    // Jamin tiap finding survey punya pasangan aksi yang sejajar.
    const pairCount = Math.min(keyFindings.length, exhibitorActions.length, 3);

    return {
      summary,
      keyFindings: keyFindings.slice(0, pairCount),
      exhibitorActions: exhibitorActions.slice(0, pairCount),
      opportunityWatchout,
    };
  } catch {
    const fallback = content.trim();
    return {
      summary: fallback,
      keyFindings: [],
      exhibitorActions: [],
      opportunityWatchout: "",
    };
  }
}

export async function getEventSurveyInsight(
  eventId: string,
  options?: { refresh?: boolean },
): Promise<EventSurveyInsightResult | null> {
  const refresh = options?.refresh ?? false;

  const event = await Event.findById(eventId).select("title").lean();
  if (!event) {
    return null;
  }

  // Cheap version check before touching the (potentially large) answers and
  // before calling the LLM. Previously every request regenerated the insight.
  const source = await readSourceState(eventId);

  if (!refresh && source.totalResponses > 0) {
    const cached = await EventAiInsightCache.findOne({ eventId })
      .select("insight totalResponses sourceSignature generatedAt")
      .lean<{
        insight: SurveyAnalyticsInsight;
        totalResponses: number;
        sourceSignature: string;
        generatedAt: Date;
      } | null>();

    const stillFresh =
      cached?.generatedAt &&
      Date.now() - new Date(cached.generatedAt).getTime() < INSIGHT_TTL_MS;

    if (cached && stillFresh && cached.sourceSignature === source.signature) {
      return {
        eventId,
        insight: cached.insight,
        // Always report the live count, not the one stored with the cache.
        totalResponses: source.totalResponses,
      };
    }
  }

  if (source.totalResponses === 0) {
    throw new SurveyInsightUnavailableError(
      "Belum ada data survey untuk dianalisis oleh AI.",
    );
  }

  const rawResponses = await SurveyResponse.find({ eventId })
    .select("answers")
    .sort({ submittedAt: -1 })
    .limit(INSIGHT_SAMPLE_LIMIT)
    .lean();

  const cleanDataForAI = rawResponses.map((response) => response.answers);

  const insight = await chat([
    {
      role: "developer",
      content:
        "Kamu adalah analis bisnis event. Ikuti instruksi format JSON dengan ketat dan jangan gunakan Markdown.",
    },
    {
      role: "user",
      content: buildPrompt(event.title, cleanDataForAI),
    },
  ]);

  const parsedInsight = safeParse(String(insight));

  await EventAiInsightCache.findOneAndUpdate(
    { eventId },
    {
      $set: {
        insight: parsedInsight,
        totalResponses: source.totalResponses,
        sourceSignature: source.signature,
        generatedAt: new Date(),
      },
    },
    { upsert: true },
  );

  return {
    eventId,
    insight: parsedInsight,
    totalResponses: source.totalResponses,
  };
}
