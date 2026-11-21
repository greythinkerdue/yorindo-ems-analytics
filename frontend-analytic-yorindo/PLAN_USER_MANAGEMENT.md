# Plan: User Management CRUD + Feature Permissions

Super admin can invite, edit, and deactivate users — and control exactly which features each user can access.

---

## Core Concept: Roles vs Permissions

The system currently uses **roles** (`super_admin`, `admin`, `staff`, `scanner`).  
Roles alone are coarse — "admin can do everything, staff can do less."

This plan adds **permissions on top of roles**:
- Each user gets a `permissions` array stored in their DB record
- When super admin creates or edits a user, they check/uncheck specific feature access
- `super_admin` always bypasses permission checks — they have full access always
- Backend has a new `requirePermission()` middleware (alongside the existing `requireRole()`)

**Permission string format:** `"feature:action"`

---

## Permission List (covers current + future features)

```
events:view       → can see the Events page and list
events:create     → can create new events
events:edit       → can edit existing events
events:delete     → can cancel/soft-delete events

communication:view   → can see the Communication page  (future feature)

settings:view        → can see the Settings page        (future feature)
```

> `users:*` is NOT a configurable permission. User management is always super_admin only — hardcoded, never in the checkbox UI.

---

## How Permissions Flow (end to end)

```
super_admin creates user with permissions: ["events:view", "events:create"]
       │
       ▼
Saved in MongoDB: user.permissions = ["events:view", "events:create"]
       │
       ▼
User logs in → backend signs JWT with permissions array inside token payload
       │
       ▼
Frontend stores token → AuthContext reads permissions from /api/v1/auth/me
       │
       ▼
Events page: "Create Event" button only renders if user has "events:create"
       │
       ▼
Even if user calls API directly: requirePermission("events:create") blocks them → 403
```

Permission is enforced in **two places**: frontend (hide UI) + backend (block API). Both are needed.

---

## What Changes vs the Original Plan

The original plan had 11 steps. This updated plan has **15 steps** — 4 extra steps for the permission layer.

New steps added:
- Step 1b — Add `PERMISSION` constant to `enums.ts`
- Step 2b — Add `permissions` field to `user.schema.ts`  
- Step 3b — Add `requirePermission()` to `auth.middleware.ts`
- Step 3c — Update JWT to include permissions in token payload

---

## BACKEND STEPS

---

### Step 1 — Validators

**File to create:** `backend-ems-yorindo/src/validators/user.validators.ts`

Zod schemas:

- `getUsersQuerySchema` — `page`, `limit`, `search`, `role`
- `createUserBodySchema` — required: `name`, `email`, `role` / optional: `organizationName`, `permissions`
- `updateUserBodySchema` — optional: `name`, `role`, `organizationName`, `permissions`
- `userParamsSchema` — `id` (MongoDB ObjectId)

For `permissions` field in both create and update schemas:
```ts
permissions: z.array(z.enum([...all permission strings...])).optional().default([])
```

---

### Step 1b — Add PERMISSION Constant to Enums

**File to edit:** `backend-ems-yorindo/src/models/constants/enums.ts`

Add to the `STATUS` object:

```ts
PERMISSION: [
  "events:view",
  "events:create",
  "events:edit",
  "events:delete",
  "communication:view",
  "settings:view",
] as const,
```

Also add the derived TypeScript type below with the other types:
```ts
export type Permission = typeof STATUS.PERMISSION[number];
```

**Why here:** All permission strings are defined once. Every other file imports from this single source of truth — same pattern as `EventStatus`, `UserRole`, etc.

---

### Step 2 — User Service

**File to create:** `backend-ems-yorindo/src/services/user.service.ts`

Functions:

```
getAllUsers(query)                    → paginated list with search + role filter
createUser(data)                      → insert new user with permissions array
updateUser(id, data)                  → partial update including permissions
toggleUserActive(id, requestingUserId) → flip isActive, block self-deactivation
getUserById(id)                       → single user fetch (internal use)
```

Key rules:
- `createUser`: check duplicate email before inserting
- `toggleUserActive`: throw error if `id === requestingUserId` (can't deactivate yourself)
- `updateUser`: never touch `email` or `lastLoginAt` — auth service owns those
- `permissions` defaults to `[]` if not provided in create

---

### Step 2b — Add `permissions` Field to User Schema

**File to edit:** `backend-ems-yorindo/src/models/schemas/user.schema.ts`

Add to `IUser` interface:
```ts
/**
 * Feature-level permissions granted to this user.
 * super_admin bypasses this array entirely — they always have full access.
 * Empty array = can log in but sees nothing beyond their own profile.
 */
permissions: Permission[];
```

Add to the Mongoose schema inside `UserSchema`:
```ts
permissions: {
  type: [String],
  enum: STATUS.PERMISSION,
  default: [],
},
```

No new DB index needed — permissions are checked in application logic, not queried directly.

---

### Step 3 — Controller

**File to create:** `backend-ems-yorindo/src/controllers/user.controller.ts`

One handler per endpoint:

```
getAllUsersHandler    → res.locals.parsed.query → getAllUsers()
createUserHandler    → res.locals.parsed.body  → createUser()
updateUserHandler    → params.id + body        → updateUser()
toggleActiveHandler  → params.id               → toggleUserActive(id, req.auth.sub)
```

Same try/catch pattern as `event.controller.ts`. Pass errors to `next(error)`.

---

### Step 3b — Add `requirePermission()` Middleware

**File to edit:** `backend-ems-yorindo/src/middlewares/auth.middleware.ts`

Add a new exported function alongside the existing `requireRole()`:

```ts
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return sendError(res, 401, "Access denied. Please log in again.");
    }

    // super_admin always passes — no permission check needed
    if (req.auth.role === "super_admin") {
      return next();
    }

    if (!req.auth.permissions.includes(permission)) {
      return sendError(res, 403, "Access denied. You don't have permission for this action.");
    }

    next();
  };
}
```

**Why `super_admin` bypasses:** Super admin is the owner of the system. They should never be locked out by a misconfigured permission array.

---

### Step 3c — Include Permissions in JWT

Two files need updating so that permissions travel inside the token:

**File to edit:** `backend-ems-yorindo/src/utils/jwt.ts`

Add `permissions` to the token payload when signing:
```ts
// In signAccessToken():
{ sub: userId, email, role, permissions, type: "access" }

// In AuthTokenPayload interface:
permissions: Permission[];
```

**File to edit:** `backend-ems-yorindo/src/types/express/index.d.ts`

Add `permissions` to the `auth` object on `Request`:
```ts
auth: {
  sub: string;
  email: string;
  role: string;
  permissions: string[];
  type: string;
};
```

**File to edit:** `backend-ems-yorindo/src/services/auth.service.ts`

In `verifyOtp()`, when signing the token, pass the user's `permissions` array:
```ts
const token = signAccessToken({
  userId: user._id.toString(),
  email: user.email,
  role: user.role,
  permissions: user.permissions,  // ← add this
});
```

Also in the `/me` response, include `permissions` in the returned user object.

> **Important tradeoff:** Permissions are baked into the JWT at login time. If super_admin changes a user's permissions, those changes only take effect the next time that user logs in (when a new token is issued). For an internal tool this is acceptable — document this in a comment in `auth.service.ts`.

---

### Step 4 — Routes

**File to create:** `backend-ems-yorindo/src/routes/user.routes.ts`

```
GET    /                  requireAuth → requireRole("super_admin") → validate(query) → getAllUsersHandler
POST   /                  requireAuth → requireRole("super_admin") → validate(body)  → createUserHandler
PATCH  /:id               requireAuth → requireRole("super_admin") → validate(params) → validate(body) → updateUserHandler
PATCH  /:id/toggle-active requireAuth → requireRole("super_admin") → validate(params) → toggleActiveHandler
```

**Also update event routes** to use `requirePermission` instead of `requireRole`:

**File to edit:** `backend-ems-yorindo/src/routes/event.routes.ts`

```ts
// Before (role-only):
router.post("/", requireAuth, requireRole("super_admin", "admin"), ...)

// After (permission-based):
router.get("/",       requireAuth, requirePermission("events:view"),   ...)
router.post("/",      requireAuth, requirePermission("events:create"), ...)
router.patch("/:id",  requireAuth, requirePermission("events:edit"),   ...)
router.delete("/:id", requireAuth, requirePermission("events:delete"), ...)
```

`super_admin` still passes all of these because `requirePermission` has the super_admin bypass built in.

---

### Step 5 — Mount the Route

**File to edit:** `backend-ems-yorindo/src/routes/index.ts`

```ts
router.use("/users", userRoutes);
```

---

### Step 6 — Test Backend

Test order:

```
1.  Login as super_admin → get token
2.  GET  /api/v1/users                               → 200 list
3.  POST /api/v1/users  { name, email, role, permissions: ["events:view"] }
4.  GET  /api/v1/users/<id>                          → verify permissions saved
5.  PATCH /api/v1/users/<id>  { permissions: ["events:view", "events:create"] }
6.  PATCH /api/v1/users/<id>/toggle-active           → isActive flips
7.  Login as that new user → check token has permissions in payload (decode at jwt.io)
8.  GET  /api/v1/events with new user's token        → 200 (has events:view)
9.  POST /api/v1/events with new user's token        → 200 (has events:create)
10. Remove events:create → re-login → POST /api/v1/events → 403
11. Try toggle-active on yourself as super_admin     → should get error
```

Do not proceed to frontend until all 11 tests pass.

---

## FRONTEND STEPS

---

### Step 7 — Update AuthContext Types

**File to edit:** `frontend-analytic-yorindo/src/context/AuthContext.tsx`

Add `permissions` to `AuthUser`:
```ts
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  organizationName: string | null;
  lastLoginAt: string | null;
  permissions: string[];   // ← add this
}
```

This is already populated from `/api/v1/auth/me` — once the backend returns it, the frontend receives it automatically.

---

### Step 8 — Add `usePermission` Hook

**File to create:** `frontend-analytic-yorindo/src/hooks/usePermission.ts`

```ts
export function usePermission(permission: string): boolean {
  const { user } = useAuth();
  if (!user) return false;
  if (user.role === "super_admin") return true;  // super_admin bypasses
  return user.permissions.includes(permission);
}
```

Usage anywhere in the app:
```ts
const canCreate = usePermission("events:create");
// Then: {canCreate && <Button>+ Create Event</Button>}
```

---

### Step 9 — API Service for Users

**File to create:** `frontend-analytic-yorindo/src/services/userService.ts`

```ts
export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  organizationName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  permissions: string[];
  createdAt: string;
}

getUsers(params)          → GET /api/v1/users
createUser(data)          → POST /api/v1/users
updateUser(id, data)      → PATCH /api/v1/users/:id
toggleUserActive(id)      → PATCH /api/v1/users/:id/toggle-active
```

---

### Step 10 — Route Guards in App.tsx

**File to edit:** `frontend-analytic-yorindo/src/App.tsx`

Add `SuperAdminRoute`:
```tsx
function SuperAdminRoute({ children }) {
  const { user, isAuthenticated, isInitializing } = useAuth();
  if (isInitializing) return <FullPageStatus label="Memuat..." />;
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (user?.role !== "super_admin") return <Navigate to="/events" replace />;
  return <>{children}</>;
}
```

Add route:
```tsx
<Route path="/users" element={<SuperAdminRoute><Users /></SuperAdminRoute>} />
```

---

### Step 11 — Users Page

**File to create:** `frontend-analytic-yorindo/src/pages/users/Users.tsx`

Layout:
```
┌──────────────────────────────────────────────────────┐
│  Users                             [+ Invite User]   │
│  Manage who can access the EMS dashboard.            │
├──────────────────────────────────────────────────────┤
│  [Search name or email...]   [All Roles ▼]           │
├──────────────┬────────────┬───────┬──────────────────┤
│ Name         │ Email      │ Role  │ Status  Actions  │
├──────────────┼────────────┼───────┼──────────────────┤
│ Ahmad Fauzi  │ ahmad@...  │ admin │ ● Active    ···  │
│ Budi Santoso │ budi@...   │ staff │ ○ Inactive  ···  │
└──────────────┴────────────┴───────┴──────────────────┘
  Showing 1–10 of 24 users        [← Prev]  [Next →]
```

State: `users`, `isLoading`, `search` (debounced 400ms), `roleFilter`, `page`, `isModalOpen`, `editingUser`

Dropdown actions per row: Edit → Deactivate/Activate

---

### Step 12 — User Form Modal with Permission Checkboxes

**File to create:** `frontend-analytic-yorindo/src/pages/users/UserFormModal.tsx`

This is the most important UI piece. The modal has two sections:

**Section 1 — User Details:**
| Field | Create | Edit |
|-------|--------|------|
| Full Name | editable | editable |
| Email | editable | read-only |
| Role | dropdown | dropdown |
| Organization / Team | optional | optional |

**Section 2 — Feature Permissions (checkbox grid):**

```
┌─────────────────────────────────────────────────┐
│  Feature Access                                  │
│                                                  │
│  Events                                          │
│  ☑ View events list                              │
│  ☑ Create new events                             │
│  ☑ Edit events                                   │
│  ☐ Delete / cancel events                        │
│                                                  │
│  Communication                                   │
│  ☐ View communication page                       │
│                                                  │
│  Settings                                        │
│  ☐ View settings page                            │
└─────────────────────────────────────────────────┘
```

Each checkbox maps directly to a permission string:
```ts
const PERMISSION_UI = [
  {
    group: "Events",
    items: [
      { label: "View events list",      value: "events:view" },
      { label: "Create new events",     value: "events:create" },
      { label: "Edit events",           value: "events:edit" },
      { label: "Delete / cancel events",value: "events:delete" },
    ],
  },
  {
    group: "Communication",
    items: [
      { label: "View communication page", value: "communication:view" },
    ],
  },
  {
    group: "Settings",
    items: [
      { label: "View settings page", value: "settings:view" },
    ],
  },
];
```

**Dependency rule (UX):** If user unchecks `events:view`, automatically also uncheck `events:create`, `events:edit`, `events:delete` — you can't create events you can't see.

**Props:**
```ts
interface UserFormModalProps {
  mode: "create" | "edit";
  user?: User;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}
```

---

### Step 13 — Apply Permissions in Existing Pages

Once permissions exist, existing pages must respect them.

**File to edit:** `frontend-analytic-yorindo/src/pages/events/Events.tsx`

```tsx
const canCreate = usePermission("events:create");
const canEdit   = usePermission("events:edit");
const canDelete = usePermission("events:delete");

// Hide create button if no permission:
{canCreate && <Button>+ Create Event</Button>}

// Hide edit/delete options in the dropdown:
{canEdit   && <DropdownMenuItem>Edit Event</DropdownMenuItem>}
{canDelete && <DropdownMenuItem>Delete Event</DropdownMenuItem>}
```

---

### Step 14 — Sidebar Nav Link (Role-Gated)

**File to edit:** `frontend-analytic-yorindo/src/components/Sidebar.tsx`

```tsx
const { user } = useAuth();

{user?.role === "super_admin" && (
  <NavItem to="/users" icon={<UsersIcon />} label="Users" />
)}
```

---

## Full Build Order Summary

```
BACKEND
  Step 1   → backend/src/validators/user.validators.ts          (new file)
  Step 1b  → backend/src/models/constants/enums.ts              (edit: add PERMISSION)
  Step 2   → backend/src/services/user.service.ts               (new file)
  Step 2b  → backend/src/models/schemas/user.schema.ts          (edit: add permissions field)
  Step 3   → backend/src/controllers/user.controller.ts         (new file)
  Step 3b  → backend/src/middlewares/auth.middleware.ts          (edit: add requirePermission)
  Step 3c  → backend/src/utils/jwt.ts                           (edit: add permissions to token)
           → backend/src/types/express/index.d.ts               (edit: add permissions to req.auth)
           → backend/src/services/auth.service.ts               (edit: pass permissions when signing)
  Step 4   → backend/src/routes/user.routes.ts                  (new file)
           → backend/src/routes/event.routes.ts                  (edit: switch to requirePermission)
  Step 5   → backend/src/routes/index.ts                        (edit: mount /users)
  Step 6   → test all endpoints (11 test cases)

FRONTEND
  Step 7   → frontend/src/context/AuthContext.tsx               (edit: add permissions to AuthUser)
  Step 8   → frontend/src/hooks/usePermission.ts                (new file)
  Step 9   → frontend/src/services/userService.ts               (new file)
  Step 10  → frontend/src/App.tsx                               (edit: SuperAdminRoute + /users route)
  Step 11  → frontend/src/pages/users/Users.tsx                 (new file)
  Step 12  → frontend/src/pages/users/UserFormModal.tsx         (new file — with checkbox grid)
  Step 13  → frontend/src/pages/events/Events.tsx               (edit: usePermission guards on buttons)
  Step 14  → frontend/src/components/Sidebar.tsx               (edit: gated Users nav link)
```

---

## What You Will NOT Build

- Password reset — no passwords in this system
- Email invitation on user creation — new user logs in via OTP normally
- User hard delete — only `isActive: false` (protects audit log history)
- Per-record permissions (e.g. "can only edit events they created") — role + feature permission is enough for now
- Real-time permission updates — changes take effect on next login (acceptable for internal tool)
