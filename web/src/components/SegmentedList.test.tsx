import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Avatar, ListRow, InfoRow, SegmentedList } from './SegmentedList';

describe('SegmentedList Components', () => {
  describe('Avatar', () => {
    it('renders the uppercase first initial of a name', () => {
      render(<Avatar name="Budi Prasetyo" />);
      expect(screen.getByText('B')).toBeDefined();
    });

    it('falls back to "U" when given an empty name', () => {
      render(<Avatar name="" />);
      expect(screen.getByText('U')).toBeDefined();
    });

    it('handles size 72', () => {
      const { container } = render(<Avatar name="Siti" size={72} />);
      const avatarEl = container.firstChild as HTMLElement;
      expect(avatarEl.className).toContain('avatar72');
    });
  });

  describe('ListRow', () => {
    it('renders as a router Link when "to" is provided', () => {
      render(
        <MemoryRouter>
          <ListRow
            title="Budi Prasetyo"
            subtitle="Pengelola akun keluarga"
            to="/keluarga/1"
            showChevron={true}
          />
        </MemoryRouter>
      );

      const link = screen.getByRole('link');
      expect(link.getAttribute('href')).toBe('/keluarga/1');
      expect(screen.getByText('Budi Prasetyo')).toBeDefined();
      expect(screen.getByText('Pengelola akun keluarga')).toBeDefined();
    });

    it('renders "(Anda)" when isSelf is true', () => {
      render(
        <MemoryRouter>
          <ListRow
            title="Budi Prasetyo"
            isSelf={true}
            subtitle="Pengelola akun keluarga"
            to="/keluarga/1"
          />
        </MemoryRouter>
      );

      expect(screen.getByText('(Anda)')).toBeDefined();
    });

    it('renders as a button when "onClick" is provided', () => {
      const handleClick = vi.fn();
      render(
        <ListRow
          title="Tombol Anggota"
          subtitle="Keterangan"
          onClick={handleClick}
        />
      );

      const button = screen.getByRole('button');
      fireEvent.click(button);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('renders as a div when neither "to" nor "onClick" is provided', () => {
      render(
        <ListRow
          title="Static Row"
          subtitle="Static Subtitle"
        />
      );

      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.getByText('Static Row')).toBeDefined();
    });

    it('renders rightAction node', () => {
      render(
        <ListRow
          title="Pending Row"
          subtitle="Menunggu diterima"
          rightAction={<button type="button">Batalkan</button>}
          showChevron={false}
        />
      );

      expect(screen.getByRole('button', { name: 'Batalkan' })).toBeDefined();
    });
  });

  describe('InfoRow', () => {
    it('renders text with note role', () => {
      render(
        <InfoRow text="Pengaturan ini berlaku untuk semua perangkat di Nexa Home." />
      );

      const note = screen.getByRole('note');
      expect(note.textContent).toContain('Pengaturan ini berlaku untuk semua perangkat di Nexa Home.');
    });
  });

  describe('SegmentedList', () => {
    it('renders a list container with role="list"', () => {
      render(
        <SegmentedList ariaLabel="Daftar Anggota">
          <ListRow title="Anggota 1" />
          <ListRow title="Anggota 2" />
        </SegmentedList>
      );

      const list = screen.getByRole('list', { name: 'Daftar Anggota' });
      expect(list).toBeDefined();
      expect(screen.getByText('Anggota 1')).toBeDefined();
      expect(screen.getByText('Anggota 2')).toBeDefined();
    });
  });

  describe('Family Protection Logic', () => {
    const isProtectedFromKickOrDemotion = (
      userId: number,
      targetMember: { id: number; role: string; is_owner?: boolean },
      members: Array<{ id: number; role: string; is_owner?: boolean }>
    ) => {
      const isSelf = userId === targetMember.id;
      if (isSelf) return { allowed: false, reason: 'Tidak dapat mengeluarkan akun sendiri' };

      const isTargetOwner = targetMember.is_owner || targetMember.role === 'admin' || targetMember.role === 'pemilik';
      const totalOwners = members.filter(
        (m) => m.is_owner || m.role === 'admin' || m.role === 'pemilik'
      ).length;

      if (isTargetOwner && totalOwners <= 1) {
        return { allowed: false, reason: 'Tidak dapat mengeluarkan atau menurunkan pemilik rumah terakhir' };
      }

      return { allowed: true, reason: undefined };
    };

    it('prevents self-removal with appropriate reason', () => {
      const members = [
        { id: 1, role: 'pemilik', is_owner: true },
        { id: 2, role: 'anggota', is_owner: false },
      ];
      const result = isProtectedFromKickOrDemotion(1, members[0], members);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Tidak dapat mengeluarkan akun sendiri');
    });

    it('prevents removing or demoting the last owner', () => {
      const members = [
        { id: 1, role: 'pemilik', is_owner: true },
        { id: 2, role: 'anggota', is_owner: false },
      ];
      // User 2 (or admin) attempting to remove user 1 when user 1 is the sole owner
      const result = isProtectedFromKickOrDemotion(2, members[0], members);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Tidak dapat mengeluarkan atau menurunkan pemilik rumah terakhir');
    });

    it('allows demoting/removing an owner if there are multiple owners', () => {
      const members = [
        { id: 1, role: 'pemilik', is_owner: true },
        { id: 2, role: 'pemilik', is_owner: false },
      ];
      const result = isProtectedFromKickOrDemotion(1, members[1], members);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('allows removing a regular member', () => {
      const members = [
        { id: 1, role: 'pemilik', is_owner: true },
        { id: 2, role: 'anggota', is_owner: false },
      ];
      const result = isProtectedFromKickOrDemotion(1, members[1], members);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });
});
