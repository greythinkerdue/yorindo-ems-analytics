import { useAuth } from "@/hooks/useAuth";

/**
 * Gating aksi operasional di frontend. Backend tetap menjadi penegak akhir
 * lewat requirePermission; hook ini hanya menyembunyikan UI yang tidak bisa
 * dipakai oleh role bersangkutan.
 */
export function usePermission(permission: string) {
  const { user } = useAuth();

  if (!user) return false;
  if (user.role === "super_admin" || user.role === "admin") return true;

  return user.permissions?.includes(permission) ?? false;
}
