/**
 * Pemetaan terpusat label peran pengguna Nexa Home
 * Di seluruh antarmuka pengguna (UI), peran tertinggi selalu ditampilkan sebagai "Pemilik".
 */
export function getRoleLabel(role?: string | null): string {
  if (!role || role === 'unassigned' || role === 'biasa') return 'Belum Ada Peran';
  const r = role.toLowerCase().trim();
  if (r === 'admin' || r === 'pemilik' || r === 'owner') return 'Pemilik';
  if (r === 'member' || r === 'anggota') return 'Anggota';
  if (r === 'child' || r === 'anak') return 'Anak';
  return 'Belum Ada Peran';
}

export function isOwnerRole(role?: string | null): boolean {
  if (!role) return false;
  const r = role.toLowerCase().trim();
  return r === 'admin' || r === 'pemilik' || r === 'owner';
}
