/**
 * @file routes/survey.routes.ts
 * @description CRUD routes for event surveys. Survey forms and their questions
 * live in MongoDB; no form data is hardcoded in the application.
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { requireAuth, requirePermission } from "../middlewares/auth.middleware.ts";
import { Event, Survey } from "../models/index.ts";
import { STATUS } from "../models/constants/enums.ts";
import type { SurveyQuestionType } from "../models/constants/enums.ts";
import { sendError, sendSuccess } from "../utils/apiResponse.ts";

const router = Router();

const QUESTION_TYPES = new Set<string>(STATUS.SURVEY_QUESTION_TYPE);

type QuestionInput = {
  questionId?: string;
  question?: string;
  label?: string;
  type?: string;
  required?: boolean;
  options?: Array<string | { value?: string; label?: string }>;
  order?: number;
};

function normalizeQuestions(input: unknown): Array<{
  questionId: string;
  label: string;
  type: SurveyQuestionType;
  required: boolean;
  order: number;
  options?: Array<{ value: string; label: string; isDefault: boolean }>;
}> {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("Minimal satu pertanyaan survey diperlukan.");
  }

  return input.map((raw, index) => {
    const question = raw as QuestionInput;
    const type = String(question.type ?? "text");
    if (!QUESTION_TYPES.has(type)) {
      throw new Error(`Tipe pertanyaan tidak dikenal: ${type}`);
    }

    const label = String(question.question ?? question.label ?? "").trim();
    if (!label) {
      throw new Error(`Pertanyaan ke-${index + 1} belum diisi.`);
    }

    const options = (question.options ?? [])
      .map((option) => {
        if (typeof option === "string") {
          const value = option.trim();
          return value ? { value, label: value, isDefault: false } : null;
        }
        const value = String(option.value ?? option.label ?? "").trim();
        return value
          ? { value, label: String(option.label ?? value).trim(), isDefault: false }
          : null;
      })
      .filter((option): option is { value: string; label: string; isDefault: boolean } =>
        Boolean(option),
      );

    if (["radio", "checkbox", "select", "rating"].includes(type) && options.length === 0) {
      throw new Error(`Pertanyaan "${label}" memerlukan opsi jawaban.`);
    }

    return {
      questionId: String(question.questionId ?? new Types.ObjectId().toString()),
      label,
      type: type as SurveyQuestionType,
      required: Boolean(question.required),
      order: Number(question.order ?? index + 1),
      ...(options.length ? { options } : {}),
    };
  });
}

function serializeSurvey(survey: any) {
  return {
    id: String(survey._id),
    eventId: String(survey.eventId),
    title: survey.title,
    description: survey.description ?? null,
    isPublished: Boolean(survey.isPublished),
    publishedAt: survey.publishedAt ?? null,
    createdAt: survey.createdAt ?? null,
    updatedAt: survey.updatedAt ?? null,
    questions: (survey.questions ?? []).map((question: any) => ({
      questionId: String(question.questionId),
      question: question.label,
      type: question.type,
      required: Boolean(question.required),
      order: question.order,
      options: (question.options ?? []).map((option: any) => ({
        value: option.value,
        label: option.label,
      })),
    })),
  };
}

async function handleList(_req: Request, res: Response, next: NextFunction) {
  try {
    const surveys = await Survey.find().sort({ createdAt: -1 }).lean();
    sendSuccess(res, 200, "Daftar survey berhasil diambil", surveys.map(serializeSurvey));
  } catch (error) {
    next(error);
  }
}

async function handleGetByEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const eventId = String(req.params.eventId ?? "");
    if (!Types.ObjectId.isValid(eventId)) {
      sendError(res, 400, "Event ID tidak valid.");
      return;
    }

    const survey = await Survey.findOne({ eventId: new Types.ObjectId(eventId) }).lean();
    if (!survey) {
      sendError(res, 404, "Survey untuk event ini belum dibuat.");
      return;
    }

    sendSuccess(res, 200, "Survey berhasil diambil", serializeSurvey(survey));
  } catch (error) {
    next(error);
  }
}

async function handleGetById(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id ?? "");
    if (!Types.ObjectId.isValid(id)) {
      sendError(res, 400, "Survey ID tidak valid.");
      return;
    }

    const survey = await Survey.findById(new Types.ObjectId(id)).lean();
    if (!survey) {
      sendError(res, 404, "Survey tidak ditemukan.");
      return;
    }

    sendSuccess(res, 200, "Survey berhasil diambil", serializeSurvey(survey));
  } catch (error) {
    next(error);
  }
}

async function handleUpsert(req: Request, res: Response, next: NextFunction) {
  try {
    const { eventId, title, description, questions, isPublished } = req.body ?? {};
    if (!Types.ObjectId.isValid(eventId)) {
      sendError(res, 400, "Event ID tidak valid.");
      return;
    }

    const event = await Event.findById(new Types.ObjectId(eventId)).lean();
    if (!event) {
      sendError(res, 404, "Event tidak ditemukan.");
      return;
    }

    let normalizedQuestions;
    try {
      normalizedQuestions = normalizeQuestions(questions);
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : "Pertanyaan tidak valid.");
      return;
    }

    const userId = new Types.ObjectId(String(req.auth?.sub));
    const publish = Boolean(isPublished ?? true);
    const existing = await Survey.findOne({ eventId: new Types.ObjectId(eventId) }).lean();

    const survey = await Survey.findOneAndUpdate(
      { eventId: new Types.ObjectId(eventId) },
      {
        $set: {
          title: String(title ?? `Survey ${event.title ?? ""}`).trim(),
          description: description ? String(description).trim() : null,
          questions: normalizedQuestions,
          isPublished: publish,
          publishedAt: publish ? (existing?.publishedAt ?? new Date()) : null,
          ...(existing ? {} : { createdBy: userId }),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    sendSuccess(res, 200, "Survey berhasil disimpan ke database.", serializeSurvey(survey));
  } catch (error) {
    next(error);
  }
}

async function handleDelete(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id ?? "");
    if (!Types.ObjectId.isValid(id)) {
      sendError(res, 400, "Survey ID tidak valid.");
      return;
    }

    const deleted = await Survey.findByIdAndDelete(new Types.ObjectId(id)).lean();
    if (!deleted) {
      sendError(res, 404, "Survey tidak ditemukan.");
      return;
    }

    sendSuccess(res, 200, "Survey berhasil dihapus.", { id: String(deleted._id) });
  } catch (error) {
    next(error);
  }
}

router.get("/", requireAuth, requirePermission("surveys:view"), handleList);
router.get("/event/:eventId", requireAuth, requirePermission("surveys:view"), handleGetByEvent);
router.get("/:id", requireAuth, requirePermission("surveys:view"), handleGetById);
router.post("/", requireAuth, requirePermission("surveys:manage"), handleUpsert);
router.patch("/:id", requireAuth, requirePermission("surveys:manage"), handleUpsert);
router.delete("/:id", requireAuth, requirePermission("surveys:manage"), handleDelete);

export default router;
