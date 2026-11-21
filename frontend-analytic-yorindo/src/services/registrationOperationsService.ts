import { api } from "@/services/api";

type RegistrationRef = {
  _id: string;
  status?: string;
  [key: string]: unknown;
};

export interface ApproveRegistrationResult {
  registration: RegistrationRef;
  ticketDelivery?: unknown;
  message?: string;
}

export interface RejectRegistrationResult {
  _id: string;
  status?: string;
  [key: string]: unknown;
}

export interface BulkActionResult {
  modifiedCount: number;
  queuedCount?: number;
  failedQueueCount?: number;
  queueFailures?: unknown[];
  message?: string;
}

const getRegistrationBasePath = (eventId: string) =>
  `/api/v1/events/${eventId}/registrations`;

export function approveRegistration(eventId: string, registrationId: string) {
  return api.patch<ApproveRegistrationResult>(
    `${getRegistrationBasePath(eventId)}/${registrationId}/approve`,
  );
}

export function rejectRegistration(
  eventId: string,
  registrationId: string,
  rejectionReason?: string,
) {
  return api.patch<RejectRegistrationResult>(
    `${getRegistrationBasePath(eventId)}/${registrationId}/reject`,
    rejectionReason?.trim() ? { rejectionReason: rejectionReason.trim() } : {},
  );
}

export function bulkApproveRegistrations(eventId: string, ids: string[]) {
  return api.patch<BulkActionResult>(
    `${getRegistrationBasePath(eventId)}/bulk-approve`,
    { ids },
  );
}

export function bulkRejectRegistrations(eventId: string, ids: string[]) {
  return api.patch<BulkActionResult>(
    `${getRegistrationBasePath(eventId)}/bulk-reject`,
    { ids },
  );
}
