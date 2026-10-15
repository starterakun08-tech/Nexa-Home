import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppButton } from './AppButton';
import { AppSwitch } from './AppSwitch';
import { AppCard } from './AppCard';
import { AppBadge } from './AppBadge';
import { EmptyState } from './EmptyState';
import { ConfirmDialog } from './ConfirmDialog';

describe('Komponen Dasar UI — Nexa Home', () => {
  describe('AppButton', () => {
    it('merender teks tombol dan merespons klik', () => {
      const handleClick = vi.fn();
      render(<AppButton onClick={handleClick}>Kirim Perintah</AppButton>);

      const btn = screen.getByRole('button', { name: /kirim perintah/i });
      expect(btn).toBeInTheDocument();

      fireEvent.click(btn);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('tidak memicu event jika tombol berstatus disabled', () => {
      const handleClick = vi.fn();
      render(
        <AppButton disabled onClick={handleClick}>
          Mati
        </AppButton>
      );

      const btn = screen.getByRole('button', { name: /mati/i });
      expect(btn).toBeDisabled();

      fireEvent.click(btn);
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe('AppSwitch (56x32px Pil & 24px Knob)', () => {
    it('merender saklar dan memanggil onChange saat diklik', () => {
      const handleChange = vi.fn();
      render(
        <AppSwitch
          checked={false}
          onChange={handleChange}
          ariaLabel="Saklar Lampu Tamu"
        />
      );

      const checkbox = screen.getByRole('checkbox', { name: /saklar lampu tamu/i });
      expect(checkbox).not.toBeChecked();

      fireEvent.click(checkbox);
      expect(handleChange).toHaveBeenCalledWith(true);
    });

    it('dalam kondisi checked bernilai true', () => {
      const handleChange = vi.fn();
      render(
        <AppSwitch
          checked={true}
          onChange={handleChange}
          ariaLabel="Saklar Kipas"
        />
      );

      const checkbox = screen.getByRole('checkbox', { name: /saklar kipas/i });
      expect(checkbox).toBeChecked();
    });
  });

  describe('AppCard', () => {
    it('merender konten kartu tanpa border', () => {
      render(
        <AppCard>
          <div>Konten Ringkasan Nexa Home</div>
        </AppCard>
      );

      expect(screen.getByText('Konten Ringkasan Nexa Home')).toBeInTheDocument();
    });
  });

  describe('AppBadge', () => {
    it('merender badge dengan teks dan varian', () => {
      render(<AppBadge variant="ok">Server terhubung</AppBadge>);
      expect(screen.getByText('Server terhubung')).toBeInTheDocument();
    });
  });

  describe('EmptyState (Kejujuran Data UI)', () => {
    it('merender pesan kosong yang jujur tanpa data sintetis', () => {
      render(
        <EmptyState
          title="Belum ada aktivitas tercatat"
          description="Perintah pengguna akan tercatat otomatis di sini."
        />
      );

      expect(screen.getByText('Belum ada aktivitas tercatat')).toBeInTheDocument();
      expect(screen.getByText(/perintah pengguna akan tercatat/i)).toBeInTheDocument();
    });
  });

  describe('ConfirmDialog', () => {
    it('merender dialog konfirmasi dan merespons Ya dan Batal', () => {
      const handleConfirm = vi.fn();
      const handleCancel = vi.fn();

      const { rerender } = render(
        <ConfirmDialog
          open={false}
          title="Matikan Semua Perangkat?"
          message="Apakah Anda yakin?"
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      );

      expect(screen.queryByText('Matikan Semua Perangkat?')).not.toBeInTheDocument();

      rerender(
        <ConfirmDialog
          open={true}
          title="Matikan Semua Perangkat?"
          message="Apakah Anda yakin?"
          confirmLabel="Ya, Matikan Semua"
          cancelLabel="Batal"
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      );

      expect(screen.getByText('Matikan Semua Perangkat?')).toBeInTheDocument();
      expect(screen.getByText('Apakah Anda yakin?')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /ya, matikan semua/i }));
      expect(handleConfirm).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: /batal/i }));
      expect(handleCancel).toHaveBeenCalledTimes(1);
    });
  });
});
