/**
 * Base URL yang dipakai untuk link publik (registration / QR).
 *
 * Prioritas:
 * 1. VITE_PUBLIC_SITE_URL — alamat publik yang sudah ditentukan (mis. domain ngrok).
 * 2. window.location.origin — origin tempat dashboard dibuka.
 *
 * Jangan pakai `window.location.origin` saja: kalau dashboard dibuka di
 * localhost, link yang di-copy akan jadi localhost dan tidak bisa diakses
 * peserta di perangkat lain.
 */

const configuredUrl = (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)
  ?.trim()
  .replace(/\/+$/, "");

export function getPublicSiteUrl(): string {
  if (configuredUrl) return configuredUrl;
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export function isLocalPublicUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1/i.test(url);
}

export function buildPublicRegistrationUrl(slug: string): string {
  const base = getPublicSiteUrl().replace(/\/+$/, "");
  return `${base}/register/${encodeURIComponent(slug)}`;
}
