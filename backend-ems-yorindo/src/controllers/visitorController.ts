import type { Request, Response, NextFunction } from "express"; // 💡 Wajib di-import
import City from "../models/City.ts";
import Company from "../models/Company.ts";
import Industry from "../models/Industry.ts";
import JobTitle from "../models/JobTitle.ts";
import Participant from "../models/Participant.ts";
import Registration from "../models/Registration.ts";
import SurveyResponse from "../models/SurveyResponse.ts";
import { Event } from "../models/index.ts";
import { bumpEventMetrics } from "../services/event-metric-rollup.service.ts";
import type { VisitorRegistrationBody } from "../validators/visitor.validators.ts";

interface CustomAnswerInput {
  questionId?: string;
  label: string;
  type?: string;
  value: unknown;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function buildCustomValueMap(input: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (!input) return map;
  if (Array.isArray(input)) {
    for (const item of input as CustomAnswerInput[]) {
      if (item?.label) map.set(normalizeKey(item.label), item.value);
    }
    return map;
  }
  if (typeof input === "object") {
    for (const [label, value] of Object.entries(
      input as Record<string, unknown>,
    )) {
      map.set(normalizeKey(label), value);
    }
  }
  return map;
}

export const submitVisitorRegistration = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const data = req.body as VisitorRegistrationBody;

    const {
      event_id,
      nama_lengkap,
      email_pribadi,
      email_perusahaan,
      no_hp,
      nama_company,
      lokasi_perusahaan,
      jenis_industri,
      jabatan,
      survei_result,
    } = data;

    const event = await Event.findById(event_id).lean();
    if (!event) {
      return res
        .status(404)
        .json({ success: false, message: "Event tidak ditemukan" });
    }

    const queryKondisi = [];
    if (email_perusahaan) queryKondisi.push({ companyEmail: email_perusahaan });
    if (email_pribadi) queryKondisi.push({ personalEmail: email_pribadi });
    if (no_hp) queryKondisi.push({ phone: no_hp });

    if (queryKondisi.length > 0) {
      const existingParticipants = await Participant.find({
        $or: queryKondisi,
      });

      for (const p of existingParticipants) {
        const isAlreadyRegistered = await Registration.findOne({
          eventId: event_id,
          $or: [{ participantId: p._id }, { participantId: String(p._id) }],
        });

        if (isAlreadyRegistered) {
          return res.status(409).json({
            success: false,
            message:
              "Email atau nomor HP Anda sudah terdaftar untuk event ini.",
          });
        }
      }
    }

    const city = await City.findOneAndUpdate(
      { name: lokasi_perusahaan },
      {
        name: lokasi_perusahaan,
        normalizedName: lokasi_perusahaan.toLowerCase(),
      },
      { new: true, upsert: true },
    );

    const company = await Company.findOneAndUpdate(
      { name: nama_company },
      { name: nama_company, normalizedName: nama_company.toLowerCase() },
      { new: true, upsert: true },
    );

    const industry = await Industry.findOneAndUpdate(
      { name: jenis_industri },
      { name: jenis_industri, normalizedName: jenis_industri.toLowerCase() },
      { new: true, upsert: true },
    );

    const jobTitle = await JobTitle.findOneAndUpdate(
      { name: jabatan },
      { name: jabatan, normalizedName: jabatan.toLowerCase() },
      { new: true, upsert: true },
    );

    const participant = await Participant.findOneAndUpdate(
      { companyEmail: email_perusahaan },
      {
        fullName: nama_lengkap,
        normalizedFullName: nama_lengkap.toLowerCase(),
        personalEmail: email_pribadi,
        companyEmail: email_perusahaan,
        phone: no_hp,
        company: { companyId: company!._id, name: company!.name },
        industry: { refId: industry!._id, name: industry!.name },
        jobTitle: { refId: jobTitle!._id, name: jobTitle!.name },
        city: { refId: city!._id, name: city!.name },
      },
      { new: true, upsert: true },
    );

    // Use the raw driver so we can read `lastErrorObject.upserted` and bump
    // counters only for a real insert. The unique (eventId, participantId)
    // index prevents a concurrent request from inserting a second document.
    // Timestamps are set explicitly because the driver bypasses Mongoose hooks.
    const now = new Date();
    const upsertResult = await Registration.collection.findOneAndUpdate(
      { eventId: event_id, participantId: participant!._id },
      {
        $set: {
          companySnapshot: { companyId: company!._id, name: company!.name },
          industrySnapshot: { refId: industry!._id, name: industry!.name },
          jobTitleSnapshot: { refId: jobTitle!._id, name: jobTitle!.name },
          citySnapshot: { refId: city!._id, name: city!.name },
          updatedAt: now,
        },
        $setOnInsert: {
          eventId: event_id,
          participantId: participant!._id,
          participantType: "participant",
          status: "pending",
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    const registration = upsertResult?.value ?? null;

    if (upsertResult?.lastErrorObject?.upserted) {
      // A fresh registration has no ticketDelivery yet, which still counts as
      // "not sent" in the dashboard definition.
      await bumpEventMetrics(event_id, {
        registrations: 1,
        pending: 1,
        ticketsNotSent: 1,
      });
    }

    const answersMap = buildCustomValueMap(survei_result);

    if (answersMap.size > 0) {
      const existingSurvey = await SurveyResponse.findOne({
        eventId: event_id,
        participantId: participant!._id,
      });

      if (!existingSurvey) {
        const survey = new SurveyResponse({
          eventId: event_id,
          surveyId: event.surveyId || null,
          participantId: participant!._id,
          registrationId: registration!._id,
          answers: Object.fromEntries(answersMap),
        });

        await survey.save();
      }
    }

    return res.status(201).json({
      success: true,
      message: "Proses registrasi berhasil!",
      data: {
        participant_id: participant!._id,
        registration_id: registration!._id,
      },
    });
  } catch (error) {
    next(error);
  }
};
