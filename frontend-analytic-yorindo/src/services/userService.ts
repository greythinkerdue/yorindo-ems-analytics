import { api } from "@/services/api";

export interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
  organizationName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  permissions: string[];
  createdAt: string;
}

export interface GetUsersParams {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
}

export interface UserFormData {
  name: string;
  email: string;
  role: string;
  organizationName: string | null;
  permissions: string[];
}

export interface UpdateUserData {
  name?: string;
  role?: string;
  organizationName?: string | null;
  permissions?: string[];
}

export const SYSTEM_ROLES = [
  "super_admin",
  "admin",
  "event_operator",
  "communication_operator",
  "survey_analyst",
] as const;

export const PERMISSION_GROUPS = [
  {
    group: "Events & Operations",
    items: [
      { label: "View events list",       value: "events:view" },
      { label: "Create new events",      value: "events:create" },
      { label: "Edit events",            value: "events:edit" },
      { label: "Delete / cancel events", value: "events:delete" },
    ],
  },
  {
    group: "Registrations & Check-In",
    items: [
      { label: "View registrations",       value: "registrations:view" },
      { label: "Approve / reject",         value: "registrations:approve" },
      { label: "Scan & check in participants", value: "registrations:checkin" },
    ],
  },
  {
    group: "Communication",
    items: [
      { label: "View communication page", value: "communication:view" },
      { label: "Send broadcasts",         value: "communication:send" },
    ],
  },
  {
    group: "Survey & Analytics",
    items: [
      { label: "View surveys",       value: "surveys:view" },
      { label: "Manage surveys",     value: "surveys:manage" },
      { label: "View analytics",     value: "analytics:view" },
    ],
  },
] as const;

export function getUsers(params: GetUsersParams = {}) {
  const query = new URLSearchParams();
  if (params.page)   query.set("page",   String(params.page));
  if (params.limit)  query.set("limit",  String(params.limit));
  if (params.search) query.set("search", params.search);
  if (params.role)   query.set("role",   params.role);
  return api.get<{ items: User[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(
    `/api/v1/users?${query.toString()}`,
  );
}

export function createUser(data: UserFormData) {
  return api.post<User>("/api/v1/users", data);
}

export function updateUser(id: string, data: UpdateUserData) {
  return api.patch<User>(`/api/v1/users/${id}`, data);
}

export function toggleUserActive(id: string) {
  return api.patch<User>(`/api/v1/users/${id}/toggle-active`);
}
