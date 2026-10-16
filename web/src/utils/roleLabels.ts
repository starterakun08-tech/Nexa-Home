/**
 * Pemetaan terpusat label peran pengguna Nexa Home
 * Di seluruh antarmuka pengguna (UI), peran tertinggi selalu ditampilkan sebagai "Pemilik".
 */
export function getRoleLabel(role?: string | null): string {
  if (!role) return 'Akun Biasa';
  const r = role.toLowerCase().trim();
  if (r === 'admin' || r === 'pemilik' || r === 'owner') return 'Pengelola';
  if (r === 'member' || r === 'anggota') return 'Anggota';
  if (r === 'child' || r === 'anak') return 'Anak';
  return 'Akun Biasa';
}

export function isOwnerRole(role?: string | null): boolean {
  if (!role) return false;
  const r = role.toLowerCase().trim();
  return r === 'admin' || r === 'pemilik' || r === 'owner';
}
