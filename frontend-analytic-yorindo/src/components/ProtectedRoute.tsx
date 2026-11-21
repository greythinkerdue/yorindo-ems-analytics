import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePermission } from "@/hooks/usePermission";
import { Forbidden } from "@/pages/Forbidden";

/**
 * Role yang diizinkan masuk dashboard internal.
 * Sama dengan SYSTEM_ROLE di backend EMS.
 */
const DASHBOARD_ROLES = [
  "super_admin",
  "admin",
  "event_operator",
  "communication_operator",
  "survey_analyst",
] as const;

function LoadingState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F5F7FB]">
      <div className="rounded-2xl border border-[#D7E1F0] bg-white px-5 py-3 text-sm font-semibold text-[#5B6B7F] shadow-[0_10px_20px_rgba(10,38,71,0.06)]">
        Menyiapkan workspace...
      </div>
    </div>
  );
}

/** Melindungi semua halaman internal. */
export function ProtectedRoute() {
  const { isAuthenticated, isInitializing, user } = useAuth();

  if (isInitializing) {
    return <LoadingState />;
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (!(DASHBOARD_ROLES as readonly string[]).includes(user.role)) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

/** Halaman login hanya untuk yang belum login. */
export function GuestRoute() {
  const { isAuthenticated, isInitializing } = useAuth();

  if (isInitializing) {
    return <LoadingState />;
  }

  if (isAuthenticated) {
    return <Navigate to="/events" replace />;
  }

  return <Outlet />;
}

/** Halaman yang butuh permission tertentu (selain role dasar dashboard). */
export function PermissionRoute({ permission }: { permission: string }) {
  const { isAuthenticated, isInitializing } = useAuth();
  const hasPermission = usePermission(permission);

  if (isInitializing) return <LoadingState />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!hasPermission) return <Forbidden />;

  return <Outlet />;
}

/** User management hanya untuk super_admin (sesuai aturan backend). */
export function SuperAdminRoute() {
  const { user, isAuthenticated, isInitializing } = useAuth();

  if (isInitializing) return <LoadingState />;
  if (!isAuthenticated || !user) return <Navigate to="/login" replace />;
  if (user.role !== "super_admin") return <Forbidden />;

  return <Outlet />;
}

export default ProtectedRoute;
