/**
 * @file scripts/seedDummy.mts
 * @description Generate realistic dummy data directly into MongoDB.
 *
 * Tidak ada daftar nama/perusahaan hardcode di file ini. Semua nilai
 * dibuat oleh @faker-js/faker locale id_ID lalu ditulis ke MongoDB.
 * Script ini append-only dan aman dijalankan ulang.
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import mongoose, { Types } from "mongoose";
import { faker } from "@faker-js/faker/locale/id_ID";
import { connectDB } from "../config/db.ts";
import {
  City,
  Company,
  CommunicationCampaign,
  Event,
  Industry,
  JobTitle,
  Participant,
  Registration,
  Survey,
  SurveyResponse,
  User,
} from "../models/index.ts";
import { STATUS } from "../models/constants/enums.ts";

const EVENT_COUNT = Number(process.env.DUMMY_EVENT_COUNT ?? 12);
const REG_PER_EVENT = Number(process.env.DUMMY_REG_PER_EVENT ?? 14);
const SEED = Number(process.env.DUMMY_SEED ?? 20261122);
const SEED_TAG = "dummy-faker-id-v1";

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to seed dummy data in production");
}

faker.seed(SEED);

const norm = (value: string) => value.trim().toLowerCase();
const slugify = (value: string) =>
  norm(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);

async function loadNameTokens(): Promise<Record<string, string[]>> {
  const docs = await mongoose.connection.db!
    .collection("event_name_tokens")
    .find({})
    .toArray();

  const grouped: Record<string, string[]> = {};
  for (const doc of docs) {
    const kind = String(doc.kind);
    const value = String(doc.value);
    grouped[kind] = [...(grouped[kind] ?? []), value];
  }
  return grouped;
}

function uniqueValues(generate: () => string, count: number): string[] {
  const values = new Set<string>();
  let guard = 0;
  while (values.size < count && guard < count * 60) {
    const value = generate()?.trim();
    if (value) values.add(value);
    guard += 1;
  }
  return [...values];
}

async function upsertMaster(
  model: any,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<any> {
  const normalizedName = norm(name);
  return model.findOneAndUpdate(
    { normalizedName },
    { $setOnInsert: { name, normalizedName, ...extra } },
    { upsert: true, returnDocument: "after" },
  ).lean();
}

const DAY = 24 * 60 * 60 * 1000;
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Jam mulai event yang wajar untuk konferensi/workshop di Indonesia. */
const EVENT_START_SLOTS = [
  { hour: 8, minute: 0 },
  { hour: 9, minute: 0 },
  { hour: 9, minute: 30 },
  { hour: 10, minute: 0 },
  { hour: 13, minute: 0 },
  { hour: 13, minute: 30 },
  { hour: 14, minute: 0 },
];

/** Set jam mulai event pada slot siang WIB, lalu simpan sebagai UTC. */
function atJakartaStart(
  date: Date,
  slot: { hour: number; minute: number } = faker.helpers.arrayElement(
    EVENT_START_SLOTS,
  ),
): Date {
  const jakarta = new Date(date.getTime() + JAKARTA_OFFSET_MS);
  jakarta.setUTCHours(slot.hour, slot.minute, 0, 0);
  return new Date(jakarta.getTime() - JAKARTA_OFFSET_MS);
}

const REGION_CITY: Record<string, string> = {
  Jakarta: "Jakarta",
  Surabaya: "Surabaya",
  Bali: "Bali",
  Yogyakarta: "Yogyakarta",
  Asia: "Jakarta",
  "Asia Pacific": "Jakarta",
  ASEAN: "Jakarta",
  "Southeast Asia": "Jakarta",
};

function fillTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(values[key] ?? ""),
  );
}

function registrationCountFor(eventStatus: string, index: number): number {
  const offsets: Record<string, number> = {
    draft: -6,
    upcoming: -3,
    registration: -1,
    ongoing: 1,
    done: 4,
    cancelled: -5,
  };
  const jitter = index % 2 === 0 ? 0 : 1;
  return Math.max(4, REG_PER_EVENT + (offsets[eventStatus] ?? 0) + jitter);
}

function distributeStatuses(
  count: number,
  weights: Array<[string, number]>,
): string[] {
  const totalWeight = weights.reduce((sum, [, weight]) => sum + weight, 0);
  const result: string[] = [];
  let assigned = 0;

  weights.forEach(([status, weight], index) => {
    const amount =
      index === weights.length - 1
        ? count - assigned
        : Math.round((weight / totalWeight) * count);
    for (let step = 0; step < amount; step += 1) result.push(status);
    assigned += amount;
  });

  return faker.helpers.shuffle(result);
}

/** Komposisi status pendaftar mengikuti fase event, bukan campuran acak. */
function statusesForEvent(eventStatus: string, count: number): string[] {
  switch (eventStatus) {
    case "done":
      return distributeStatuses(count, [
        ["checked_in", 10],
        ["approved", 3],
        ["rejected", 1],
      ]);
    case "ongoing":
      return distributeStatuses(count, [
        ["checked_in", 6],
        ["approved", 5],
        ["pending", 2],
        ["rejected", 1],
      ]);
    case "registration":
      return distributeStatuses(count, [
        ["approved", 5],
        ["pending", 7],
        ["rejected", 2],
      ]);
    case "upcoming":
      return distributeStatuses(count, [
        ["approved", 4],
        ["pending", 8],
        ["rejected", 2],
      ]);
    case "cancelled":
      return distributeStatuses(count, [
        ["rejected", 9],
        ["pending", 5],
      ]);
    default:
      return distributeStatuses(count, [
        ["approved", 2],
        ["pending", 12],
      ]);
  }
}

/** Event "bersih": tidak ada pending, tiket terkirim, kehadiran sehat. */
function cleanStatusesForEvent(eventStatus: string, count: number): string[] {
  if (eventStatus === "done" || eventStatus === "ongoing") {
    return distributeStatuses(count, [
      ["checked_in", 8],
      ["approved", 2],
    ]);
  }
  return distributeStatuses(count, [["approved", 1]]);
}

function eventDateForStatus(status: string): Date {
  if (status === "done" || status === "cancelled") {
    return atJakartaStart(faker.date.past({ years: 1 }));
  }
  if (status === "ongoing") {
    const nowJakarta = new Date(Date.now() + JAKARTA_OFFSET_MS);
    const nowMinutes =
      nowJakarta.getUTCHours() * 60 + nowJakarta.getUTCMinutes();
    const activeSlots = EVENT_START_SLOTS.filter(
      (slot) => slot.hour * 60 + slot.minute <= nowMinutes,
    );
    const todayJakarta = new Date(nowJakarta);
    todayJakarta.setUTCHours(0, 0, 0, 0);
    const todayReal = new Date(
      todayJakarta.getTime() - JAKARTA_OFFSET_MS,
    );
    const base = activeSlots.length ? todayReal : new Date(todayReal.getTime() - DAY);
    const slot = activeSlots.length
      ? faker.helpers.arrayElement(activeSlots)
      : EVENT_START_SLOTS[EVENT_START_SLOTS.length - 1];
    return atJakartaStart(base, slot);
  }
  return atJakartaStart(faker.date.soon({ days: 150 }));
}

function approvalDateFor(eventDate: Date): Date {
  const now = Date.now();
  if (eventDate.getTime() >= now) {
    // Event mendatang: approval dibuat dalam 30 hari terakhir agar tren
    // pendaftaran tidak kehabisan data di ujung grafik.
    return faker.date.between({
      from: new Date(now - 14 * DAY),
      to: new Date(now),
    });
  }
  return faker.date.between({
    from: new Date(eventDate.getTime() - 60 * DAY),
    to: eventDate,
  });
}

function checkInDateFor(eventDate: Date): Date {
  const eventTime = eventDate.getTime();
  const windowEnd =
    eventTime < Date.now()
      ? Math.min(eventTime + 8 * 60 * 60 * 1000, Date.now())
      : Date.now();
  const windowStart =
    eventTime < Date.now() ? eventTime : eventTime - 2 * 60 * 60 * 1000;
  return faker.date.between({
    from: new Date(windowStart),
    to: new Date(windowEnd),
  });
}

/**
 * Bobot harian untuk tren 30 hari: gelombang lembut + sedikit kenaikan,
 * supaya grafik garis tidak flat dan tidak bergerigi tajam.
 */
const TREND_DAY_WEIGHTS = Array.from({ length: 30 }, (_, index) => {
  const phase = (index / 29) * Math.PI * 2;
  const wave = Math.sin(phase - 0.9) * 1.5;
  const ripple = Math.sin(phase * 3 + 0.4) * 0.7;
  const lift = index / 29;
  return Math.max(1, Math.round(3.2 + wave + ripple + lift));
});
const TREND_TOTAL_WEIGHT = TREND_DAY_WEIGHTS.reduce(
  (sum, weight) => sum + weight,
  0,
);

/** Waktu registrasi dibuat, dibatasi sebelum approval dan waktu event. */
function registrationCreatedAt(eventDate: Date, decidedAt: Date): Date {
  const now = Date.now();
  const windowEnd = Math.min(eventDate.getTime(), decidedAt.getTime(), now);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const windowStart = today.getTime() - 29 * DAY;

  if (windowEnd <= windowStart) {
    return new Date(windowEnd - faker.number.int({ min: 0, max: DAY }));
  }

  let pick = faker.number.int({ min: 1, max: TREND_TOTAL_WEIGHT });
  let dayOffset = 0;
  for (let index = 0; index < TREND_DAY_WEIGHTS.length; index += 1) {
    pick -= TREND_DAY_WEIGHTS[index]!;
    if (pick <= 0) {
      dayOffset = index;
      break;
    }
  }

  const chosen =
    windowStart +
    dayOffset * DAY +
    faker.number.int({ min: 8 * 60 * 60 * 1000, max: 20 * 60 * 60 * 1000 });

  return new Date(Math.min(Math.max(chosen, windowStart), windowEnd));
}

function ticketDeliveryFor(
  status: string,
  decidedAt: Date,
  failureReason: string,
) {
  const deliveryStart = decidedAt.getTime();
  const deliveryTime = faker.date.between({
    from: new Date(deliveryStart),
    to: new Date(
      Math.max(deliveryStart + 1000, Math.min(deliveryStart + 7 * DAY, Date.now())),
    ),
  });

  if (status === "sent") {
    return {
      status: "sent",
      queuedAt: deliveryTime,
      lastAttemptAt: deliveryTime,
      sentAt: deliveryTime,
      failedAt: null,
      failureReason: null,
      attempts: 1,
    };
  }

  if (status === "failed") {
    return {
      status: "failed",
      queuedAt: deliveryTime,
      lastAttemptAt: deliveryTime,
      sentAt: null,
      failedAt: deliveryTime,
      failureReason,
      attempts: 2,
    };
  }

  return {
    status: "idle",
    queuedAt: null,
    lastAttemptAt: null,
    sentAt: null,
    failedAt: null,
    failureReason: null,
    attempts: 0,
  };
}

function answerValue(
  key: string,
  participant: any,
  company: any,
  industry: any,
  jobTitle: any,
  city: any,
  customValue: string,
): unknown {
  switch (key) {
    case "full_name":
      return participant.fullName;
    case "company_name":
      return company.name;
    case "company_location":
      return city.name;
    case "industry":
      return industry.name;
    case "job_title":
      return jobTitle.name;
    case "company_email":
      return participant.companyEmail;
    case "personal_email":
      return participant.personalEmail;
    case "phone":
      return participant.phone;
    default:
      return customValue;
  }
}

async function main() {
  await connectDB();

  if (process.env.DUMMY_RESET === "true") {
    const dummyEvents = await Event.find({ slug: { $regex: /^dummy-/ } })
      .select("_id")
      .lean<any[]>();
    const dummyEventIds = dummyEvents.map((event) => event._id);

    await Registration.deleteMany({ eventId: { $in: dummyEventIds } });
    await SurveyResponse.deleteMany({ eventId: { $in: dummyEventIds } });
    await Survey.deleteMany({ eventId: { $in: dummyEventIds } });
    await CommunicationCampaign.deleteMany({
      "filtersSnapshot.seedTag": SEED_TAG,
    });
    await Event.deleteMany({ _id: { $in: dummyEventIds } });
    await Participant.deleteMany({ notes: SEED_TAG });

    console.log(`[DUMMY SEED] reset removed ${dummyEventIds.length} dummy events`);
  }

  const admin = await User.findOne({ role: "super_admin" }).lean<any>();
  if (!admin) throw new Error("Super admin user tidak ditemukan; jalankan seed utama dulu.");

  // Audit event/registrasi tetap memakai admin pertama (Daffa), tetapi campaign
  // dibagikan ke beberapa super admin agar history tidak semuanya "by Daffa".
  // Cece didahulukan supaya akun yang biasa dipakai memiliki draft sendiri.
  const campaignAdmins = await User.find({ role: "super_admin" }).lean<any[]>();
  const ceceAdmin = campaignAdmins.find((item) =>
    /cecilya|cece|caroline/i.test(String(item.name ?? "")),
  );
  const orderedCampaignAdmins = ceceAdmin
    ? [
        ceceAdmin,
        ...campaignAdmins.filter(
          (item) => String(item._id) !== String(ceceAdmin._id),
        ),
      ]
    : campaignAdmins;

  const nameTokens = await loadNameTokens();
  if (!nameTokens.format?.length || !nameTokens.theme?.length) {
    throw new Error("Kosakata nama event belum ada. Jalankan npm run seed:event-names dulu.");
  }

  const templateEvent = await Event.findOne({
    "registrationForm.fields.0": { $exists: true },
  }).lean<any>();

  await Promise.all(
    [Event, Registration, Participant, Survey, SurveyResponse, CommunicationCampaign].map(
      (model) => model.init(),
    ),
  );

  const industryNames = uniqueValues(() => faker.commerce.department(), 8);
  const cityNames = uniqueValues(() => faker.location.city(), 8);
  const jobTitleNames = uniqueValues(() => faker.person.jobTitle(), 10);
  const companyNames = uniqueValues(() => faker.company.name(), 14);

  const industries: any[] = [];
  for (const name of industryNames) {
    industries.push(await upsertMaster(Industry, name));
  }

  const cities: any[] = [];
  for (const name of cityNames) {
    cities.push(
      await upsertMaster(City, name, {
        province: faker.location.state(),
        country: "Indonesia",
      }),
    );
  }

  const jobTitles: any[] = [];
  for (const name of jobTitleNames) {
    jobTitles.push(await upsertMaster(JobTitle, name));
  }

  const companies: any[] = [];
  for (const name of companyNames) {
    const industry = faker.helpers.arrayElement(industries);
    companies.push(
      await Company.findOneAndUpdate(
        { normalizedName: norm(name) },
        {
          $setOnInsert: {
            name,
            normalizedName: norm(name),
            industry: { masterId: industry._id, name: industry.name },
            website: `https://${slugify(name)}.co.id`,
            phone: faker.phone.number(),
            isActive: true,
          },
        },
        { upsert: true, returnDocument: "after" },
      ).lean(),
    );
  }

  const templateFields = templateEvent?.registrationForm?.fields as any[] | undefined;
  const formFields: any[] = templateFields?.length
    ? templateFields.map((field) => ({ ...field, fieldId: randomUUID() }))
    : [
        "full_name",
        "company_name",
        "company_location",
        "industry",
        "job_title",
        "company_email",
        "personal_email",
        "phone",
      ].map((key, index) => ({
        fieldId: randomUUID(),
        key,
        label: key
          .split("_")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" "),
        type:
          key === "company_email" || key === "personal_email"
            ? "email"
            : key === "phone"
              ? "phone"
              : key === "industry"
                ? "select"
                : "text",
        order: index + 1,
        isFixed: true,
        isActive: true,
        validation: { required: true },
        ...(key === "industry"
          ? { options: industries.map((item) => ({ value: item.name, label: item.name, isDefault: false })) }
          : {}),
      }));

  const nowYear = new Date().getFullYear();
  const usedTitles = new Set<string>();
  const events: any[] = [];
  const eventRegCounts: number[] = [];
  for (let index = 0; index < EVENT_COUNT; index += 1) {
    const industry = faker.helpers.arrayElement(industries);
    const city = faker.helpers.arrayElement(cities);

    let title = "";
    let titlePattern = 0;
    let locationCity = city.name;
    let copyValues: Record<string, string | number> = {};
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const format = faker.helpers.arrayElement(nameTokens.format);
      const theme = faker.helpers.arrayElement(nameTokens.theme);
      const organizer = faker.helpers.arrayElement(nameTokens.organizer ?? ["Yorindo"]);
      const region = faker.helpers.arrayElement(nameTokens.region ?? ["Indonesia"]);
      const edition = faker.helpers.arrayElement(nameTokens.edition ?? [String(nowYear)]);
      const hasYear = /\d/.test(edition);
      const yearLabel = hasYear ? edition : String(nowYear);
      const editionSuffix = hasYear ? "" : ` (${edition})`;
      const pattern = (index + attempt) % 5;

      locationCity = REGION_CITY[region] || city.name;
      copyValues = {
        organizer,
        format,
        theme,
        region,
        year: pattern === 1 || pattern === 2 ? String(nowYear) : yearLabel,
        city: locationCity,
        industry: industry.name,
      };

      switch (pattern) {
        case 0:
          titlePattern = 0;
          title = `${organizer} ${theme} ${format} ${yearLabel}`;
          break;
        case 1:
          titlePattern = 1;
          title = `${format} ${theme} ${region} ${nowYear}`;
          break;
        case 2:
          titlePattern = 2;
          title = `${organizer} ${format} ${region} ${nowYear}`;
          break;
        case 3:
          titlePattern = 3;
          title = `${theme} ${format} ${yearLabel}`;
          break;
        default:
          titlePattern = 4;
          title = `${organizer} ${format} ${nowYear}: ${theme}${editionSuffix}`;
      }

      if (!usedTitles.has(title)) break;
    }
    usedTitles.add(title);

    const slug = `dummy-${String(index + 1).padStart(2, "0")}-${slugify(title)}`;
    const status = String(STATUS.EVENT[index % STATUS.EVENT.length] ?? "draft");
    const eventDate = eventDateForStatus(status);
    const regCount = registrationCountFor(status, index);
    eventRegCounts.push(regCount);

    const patternTokens = nameTokens[`description_p${titlePattern}`] ?? [];
    const descriptionTemplate = patternTokens.length
      ? String(faker.helpers.arrayElement(patternTokens))
      : "{organizer} {format} {year} di {city}.";
    const description = fillTemplate(descriptionTemplate, copyValues);

    const event = await Event.findOneAndUpdate(
      { slug },
      {
        $setOnInsert: {
          title,
          slug,
          description,
          category: faker.commerce.department(),
          industry: { refId: industry._id, name: industry.name },
          eventDate,
          location: `${faker.location.streetAddress()}, ${locationCity}`,
          status,
          registrationForm: {
            name: `Formulir Pendaftaran ${title}`,
            version: 1,
            fields: formFields,
            publishedAt: status === "draft" ? null : faker.date.recent({ days: 60 }),
          },
          surveyId: null,
          createdBy: admin._id,
          updatedBy: admin._id,
        },
      },
      { upsert: true, returnDocument: "after" },
    ).lean();

    (event as any)._copyValues = copyValues;
    events.push(event);
  }

  const totalParticipants = eventRegCounts.reduce((sum, count) => sum + count, 0);
  const usedNames = new Set<string>();
  const participants: any[] = [];

  while (participants.length < totalParticipants) {
    const firstName = faker.person.firstName();
    let lastName = faker.person.lastName();
    if (norm(lastName) === norm(firstName)) lastName = faker.person.lastName();
    const fullName = `${firstName} ${lastName}`;
    const normalizedFullName = norm(fullName);
    if (usedNames.has(normalizedFullName)) continue;
    usedNames.add(normalizedFullName);

    const company = faker.helpers.arrayElement(companies);
    const industry = faker.helpers.arrayElement(industries);
    const jobTitle = faker.helpers.arrayElement(jobTitles);
    const city = faker.helpers.arrayElement(cities);
    const nameParts = fullName.trim().split(/\s+/);
    const personalEmail = faker.internet.email({
      firstName: nameParts[0] || "Peserta",
      lastName: nameParts.at(-1) ?? "Yorindo",
    }).toLowerCase();
    const companyEmail = `${slugify(normalizedFullName).replace(/-/g, ".")}@${slugify(company.name)}.co.id`;

    const participant = await Participant.findOneAndUpdate(
      { normalizedFullName },
      {
        $setOnInsert: {
          fullName,
          normalizedFullName,
          personalEmail,
          companyEmail,
          phone: `08${faker.string.numeric(9)}`,
          company: { companyId: company._id, name: company.name },
          industry: { refId: industry._id, name: industry.name },
          jobTitle: { refId: jobTitle._id, name: jobTitle.name },
          city: { refId: city._id, name: city.name },
          defaultParticipantType: faker.helpers.arrayElement(["participant", "exhibitor"]),
          sourceChannel: null,
          identityFingerprint: randomUUID(),
          notes: SEED_TAG,
          isActive: true,
        },
      },
      { upsert: true, returnDocument: "after" },
    ).lean();

    participants.push(participant);
  }

  const registrationsByEvent = new Map<string, any[]>();
  let participantCursor = 0;

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex]!;
    const regCount = eventRegCounts[eventIndex] ?? REG_PER_EVENT;
    const eventRegistrations: any[] = [];
    const isCleanEvent =
      event.status !== "cancelled" && eventIndex % 4 === 0;
    const allowedStatuses = isCleanEvent
      ? cleanStatusesForEvent(event.status, regCount)
      : statusesForEvent(event.status, regCount);

    for (let index = 0; index < regCount; index += 1) {
      const participant = participants[participantCursor % participants.length];
      participantCursor += 1;

      const company =
        companies.find((item) => String(item._id) === String(participant.company?.companyId)) ??
        faker.helpers.arrayElement(companies);
      const industry =
        industries.find((item) => String(item._id) === String(participant.industry?.refId)) ??
        faker.helpers.arrayElement(industries);
      const jobTitle =
        jobTitles.find((item) => String(item._id) === String(participant.jobTitle?.refId)) ??
        faker.helpers.arrayElement(jobTitles);
      const city =
        cities.find((item) => String(item._id) === String(participant.city?.refId)) ??
        faker.helpers.arrayElement(cities);

      const status = faker.helpers.arrayElement(allowedStatuses);
      const decidedAt = approvalDateFor(new Date(event.eventDate));
      const approval =
        status === "pending"
          ? {
              approvedBy: null,
              approvedAt: null,
              rejectedBy: null,
              rejectedAt: null,
              rejectionReason: null,
            }
          : status === "rejected"
            ? {
                approvedBy: null,
                approvedAt: null,
                rejectedBy: admin._id,
                rejectedAt: decidedAt,
                rejectionReason: fillTemplate(
                  faker.helpers.arrayElement(nameTokens.rejection_reason ?? ["{industry}"]),
                  { industry: industry.name },
                ),
              }
            : {
                approvedBy: admin._id,
                approvedAt: decidedAt,
                rejectedBy: null,
                rejectedAt: null,
                rejectionReason: null,
              };

      const hasTicket = status === "approved" || status === "checked_in";
      const ticket = hasTicket
        ? {
            qrCode: `DUMMY-${randomUUID()}`,
            qrPayload: null,
            issuedAt: decidedAt,
            reissueCount: faker.number.int({ max: 2 }),
            isActive: true,
          }
        : null;
      const deliveryStatus = ticket
        ? isCleanEvent
          ? "sent"
          : faker.helpers.arrayElement(["sent", "sent", "sent", "idle", "failed"])
        : "idle";
      const ticketDelivery = ticketDeliveryFor(
        deliveryStatus,
        decidedAt,
        faker.helpers.arrayElement(nameTokens.ticket_failure_reason ?? [""]),
      );

      const checkedIn = status === "checked_in";
      const answers = formFields.map((field: any) => ({
        fieldId: field.fieldId,
        key: field.key,
        label: field.label,
        type: field.type,
        value: answerValue(
          field.key,
          participant,
          company,
          industry,
          jobTitle,
          city,
          faker.helpers.arrayElement(nameTokens.theme ?? ["Peserta"]) ?? "Peserta",
        ),
      }));

      const formSnapshot = {
        version: event.registrationForm.version ?? 1,
        fields: formFields.map((field: any) => ({
          fieldId: field.fieldId,
          key: field.key,
          label: field.label,
          type: field.type,
          order: field.order,
          isFixed: field.isFixed,
          options: field.options,
        })),
      };

      const registeredAt = registrationCreatedAt(
        new Date(event.eventDate),
        decidedAt,
      );

      // Raw collection dipakai supaya timestamps Mongoose tidak menimpa
      // createdAt/updatedAt yang sudah diatur sesuai distribusi tren 30 hari.
      await Registration.collection.findOneAndUpdate(
        {
          eventId: new Types.ObjectId(String(event._id)),
          participantId: new Types.ObjectId(String(participant._id)),
        },
        {
          $setOnInsert: {
            eventId: new Types.ObjectId(String(event._id)),
            participantId: new Types.ObjectId(String(participant._id)),
            participantType: participant.defaultParticipantType ?? "participant",
            status,
            approval,
            formSnapshot,
            answers,
            companySnapshot: { companyId: company._id, name: company.name },
            industrySnapshot: { refId: industry._id, name: industry.name },
            jobTitleSnapshot: { refId: jobTitle._id, name: jobTitle.name },
            citySnapshot: { refId: city._id, name: city.name },
            ticket,
            ticketDelivery,
            createdAt: registeredAt,
            updatedAt: registeredAt,
            checkIn: checkedIn
              ? {
                  isAttended: true,
                  checkedInAt: checkInDateFor(new Date(event.eventDate)),
                  checkedInBy: admin._id,
                  scanMethod: faker.helpers.arrayElement(["qr", "manual"]),
                  notes: null,
                }
              : {
                  isAttended: false,
                  checkedInAt: null,
                  checkedInBy: null,
                  scanMethod: "qr",
                  notes: null,
                },
          },
        },
        { upsert: true, returnDocument: "after" },
      );

      const registration = await Registration.findOne({
        eventId: event._id,
        participantId: participant._id,
      }).lean();

      if (!registration) continue;
      eventRegistrations.push(registration);
    }

    registrationsByEvent.set(String(event._id), eventRegistrations);
  }

  const surveyEvents = events.filter((event: any) =>
    ["done", "ongoing", "registration"].includes(event.status),
  );

  for (const event of surveyEvents) {
    const values: Record<string, string | number> = event._copyValues ?? {};
    const eventTime = new Date(event.eventDate).getTime();
    const questionTemplates = faker.helpers
      .shuffle([...(nameTokens.survey_question ?? ["{theme}"])])
      .slice(0, 3);
    const optionValues = uniqueValues(
      () => faker.helpers.arrayElement(nameTokens.theme ?? ["Indonesia"]),
      3,
    );

    const questions = [
      {
        questionId: randomUUID(),
        label: fillTemplate(questionTemplates[0] ?? "{theme}", values),
        type: "rating",
        order: 1,
        required: true,
        options: [1, 2, 3, 4, 5].map((value) => ({
          value: String(value),
          label: String(value),
          isDefault: false,
        })),
      },
      {
        questionId: randomUUID(),
        label: fillTemplate(questionTemplates[1] ?? "{theme}", values),
        type: "textarea",
        order: 2,
        required: false,
      },
      {
        questionId: randomUUID(),
        label: fillTemplate(questionTemplates[2] ?? "{theme}", values),
        type: "select",
        order: 3,
        required: false,
        options: optionValues.map((value) => ({
          value,
          label: value,
          isDefault: false,
        })),
      },
    ];

    const publishedStart =
      eventTime < Date.now() ? eventTime - 30 * DAY : Date.now() - 30 * DAY;
    const publishedEnd =
      eventTime < Date.now()
        ? Math.min(eventTime + 7 * DAY, Date.now())
        : Date.now();
    const publishedAt = faker.date.between({
      from: new Date(publishedStart),
      to: new Date(Math.max(publishedStart + 1000, publishedEnd)),
    });

    const survey = await Survey.findOneAndUpdate(
      { eventId: event._id },
      {
        $setOnInsert: {
          eventId: new Types.ObjectId(String(event._id)),
          title: `Survey ${event.title}`,
          questions,
          isPublished: true,
          publishedAt,
          createdBy: admin._id,
        },
      },
      { upsert: true, returnDocument: "after" },
    ).lean<any>();

    await Event.updateOne({ _id: event._id }, { $set: { surveyId: survey._id } });

    // Event yang belum berlangsung belum mungkin memiliki respons survey.
    if (!["done", "ongoing"].includes(event.status)) continue;

    const surveyQuestions = survey.questions as any[];
    const registrations = registrationsByEvent.get(String(event._id)) ?? [];
    const eligible = registrations.filter((item: any) =>
      ["approved", "checked_in"].includes(item.status),
    );
    const responseStart =
      eventTime < Date.now() ? eventTime : eventTime - 6 * 60 * 60 * 1000;
    const responseEnd =
      eventTime < Date.now()
        ? Math.min(eventTime + 2 * DAY, Date.now())
        : Date.now();

    for (const registration of eligible) {
      const submittedAt = faker.date.between({
        from: new Date(responseStart),
        to: new Date(Math.max(responseStart + 1000, responseEnd)),
      });

      await SurveyResponse.findOneAndUpdate(
        { eventId: event._id, participantId: registration.participantId },
        {
          $setOnInsert: {
            eventId: new Types.ObjectId(String(event._id)),
            surveyId: new Types.ObjectId(String(survey._id)),
            participantId: new Types.ObjectId(String(registration.participantId)),
            answers: surveyQuestions.map((question: any) => ({
              questionId: question.questionId,
              label: question.label,
              type: question.type,
              value:
                question.type === "rating"
                  ? faker.number.int({ min: 3, max: 5 })
                  : question.type === "textarea"
                    ? fillTemplate(
                        faker.helpers.arrayElement(nameTokens.survey_answer_text ?? ["{theme}"]),
                        values,
                      )
                    : faker.helpers.arrayElement(question.options as any[]).value,
            })),
            submittedAt,
          },
        },
        { upsert: true, returnDocument: "after" },
      );
    }
  }

  const campaignCount = Math.min(8, events.length);
  const campaignStatuses = [
    "draft",
    "sent",
    "sent",
    "partial",
    "queued",
    "failed",
    "sent",
    "processing",
  ] as const;
  const campaignTemplates = [
    "executive_brief",
    "event_spotlight",
    "minimal_notice",
  ] as const;
  const campaignSubjectTemplates = [
    "Konfirmasi pendaftaran {format} {theme} {year}",
    "Jadwal dan lokasi {format} {theme}",
    "Pengingat pendaftaran {format} {theme}",
    "Update terbaru {format} {theme} {year}",
    "Tiket {format} {theme} siap dikirim",
    "Konfirmasi kehadiran {format} {theme}",
    "Undangan resmi {format} {theme} {year}",
    "Pemberitahuan akhir {format} {theme}",
  ];

  for (let index = 0; index < campaignCount; index += 1) {
    const event = events[index];
    const values: Record<string, string | number> = event._copyValues ?? {};
    const eventTime = new Date(event.eventDate).getTime();
    const registrations = registrationsByEvent.get(String(event._id)) ?? [];
    const recipients = registrations
      .slice(0, faker.number.int({ min: 3, max: 10 }))
      .map((registration: any) => {
        const participant = participants.find(
          (item: any) => String(item._id) === String(registration.participantId),
        );
        return {
          registrationId: new Types.ObjectId(String(registration._id)),
          participantId: new Types.ObjectId(String(registration.participantId)),
          email: String(participant?.companyEmail ?? participant?.personalEmail ?? ""),
          name: String(participant?.fullName ?? ""),
        };
      });

    const status = campaignStatuses[index % campaignStatuses.length];
    const templateId = campaignTemplates[index % campaignTemplates.length];
    const creator =
      orderedCampaignAdmins[index % orderedCampaignAdmins.length] ?? admin;
    const subject = fillTemplate(
      campaignSubjectTemplates[index % campaignSubjectTemplates.length] ?? "{format} {theme}",
      values,
    );
    const body = [
      "Halo peserta,",
      "",
      `Informasi terbaru untuk ${subject} dapat dibaca pada pesan ini.`,
      "",
      "Terima kasih,",
      "Yorindo EMS",
    ].join("\n");

    const successCount =
      status === "sent"
        ? recipients.length
        : status === "partial"
          ? Math.ceil(recipients.length / 2)
          : 0;
    const failedRecipients =
      status === "failed"
        ? recipients
        : status === "partial"
          ? recipients.slice(successCount)
          : [];
    const failures = failedRecipients.map((recipient) => ({
      email: recipient.email,
      reason: "Alamat email tidak dapat dihubungi.",
    }));

    const sentStart = eventTime < Date.now() ? eventTime - 30 * DAY : Date.now() - 30 * DAY;
    const sentEnd = eventTime < Date.now() ? eventTime : Date.now();
    const sentAt = faker.date.between({
      from: new Date(sentStart),
      to: new Date(Math.max(sentStart + 1000, sentEnd)),
    });
    const hasSentAt = status === "sent" || status === "partial" || status === "failed";

    await CommunicationCampaign.findOneAndUpdate(
      {
        eventId: event._id,
        "filtersSnapshot.seedTag": SEED_TAG,
        "filtersSnapshot.campaignIndex": index,
      },
      {
        $set: {
          eventId: new Types.ObjectId(String(event._id)),
          createdBy: creator._id,
          sentBy: hasSentAt ? creator._id : null,
          status,
          templateId,
          previewText: subject,
          subject,
          bodyHtml: body.split("\n\n").map((part) => `<p>${part}</p>`).join(""),
          bodyText: body,
          bodyJson: null,
          filtersSnapshot: { seedTag: SEED_TAG, eventStatus: event.status, campaignIndex: index },
          audience: { recipientCount: recipients.length, recipients },
          delivery: {
            successCount,
            failureCount: failures.length,
            failures,
          },
          sentAt: hasSentAt ? sentAt : null,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
  }

  const dummyEventIds = events.map((event: any) => event._id);
  const summary = {
    events: await Event.countDocuments({ _id: { $in: dummyEventIds } }),
    registrations: await Registration.countDocuments({ eventId: { $in: dummyEventIds } }),
    participants: await Participant.countDocuments({ notes: SEED_TAG }),
    surveys: await Survey.countDocuments({ eventId: { $in: dummyEventIds } }),
    surveyResponses: await SurveyResponse.countDocuments({ eventId: { $in: dummyEventIds } }),
    campaigns: await CommunicationCampaign.countDocuments({
      "filtersSnapshot.seedTag": SEED_TAG,
    }),
  };

  console.log(`[DUMMY SEED] seed=${SEED} tag=${SEED_TAG}`);
  console.log(`[DUMMY SEED] ${JSON.stringify(summary)}`);

  await mongoose.connection.close();
}

main().catch(async (error) => {
  console.error("[DUMMY SEED] failed:", error instanceof Error ? error.message : error);
  await mongoose.connection.close().catch(() => undefined);
  process.exit(1);
});
