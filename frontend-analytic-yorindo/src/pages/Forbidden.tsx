import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";

export function Forbidden() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="w-full max-w-md rounded-[24px] border border-[#D7E1F0] bg-white px-8 py-10 text-center shadow-[0_14px_30px_rgba(10,38,71,0.06)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF3FF] text-[#1A40A8]">
          <ShieldAlert size={24} />
        </div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.24em] text-[#8DA0BC]">
          Access denied
        </p>
        <h1 className="mt-2 text-2xl font-bold text-[#0A2647]">403 — Tidak ada akses</h1>
        <p className="mt-3 text-sm leading-6 text-[#6B7280]">
          Akun kamu tidak memiliki izin untuk membuka halaman ini. Hubungi super admin
          jika kamu merasa ini adalah kesalahan.
        </p>
        <Link
          to="/dashboard"
          className="mt-6 inline-flex items-center justify-center rounded-[12px] bg-[#0A2647] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#133A6F]"
        >
          Kembali ke Dashboard
        </Link>
      </div>
    </div>
  );
}
