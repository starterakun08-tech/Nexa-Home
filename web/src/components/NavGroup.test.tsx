import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Gear } from '@phosphor-icons/react';
import { NavGroup, type NavSubItemDef } from './NavGroup';

const testItems: NavSubItemDef[] = [
  { path: '/pengaturan/akun', label: 'Akun & 2FA' },
  { path: '/pengaturan/privasi', label: 'Privasi & Data' },
  { path: '/pengaturan/audit', label: 'Log Audit', roles: ['admin', 'pemilik'] },
];

describe('NavGroup Component', () => {
  it('renders parent button with aria-expanded and label', () => {
    render(
      <MemoryRouter initialEntries={['/beranda']}>
        <NavGroup
          id="test-nav-group"
          label="Pengaturan"
          icon={Gear}
          items={testItems}
          userRole="pemilik"
        />
      </MemoryRouter>
    );

    const button = screen.getByRole('button', { name: /Pengaturan/i });
    expect(button).toBeDefined();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('toggles open and closed state on click', () => {
    render(
      <MemoryRouter initialEntries={['/beranda']}>
        <NavGroup
          id="test-nav-group"
          label="Pengaturan"
          icon={Gear}
          items={testItems}
          userRole="pemilik"
        />
      </MemoryRouter>
    );

    const button = screen.getByRole('button', { name: /Pengaturan/i });
    expect(button.getAttribute('aria-expanded')).toBe('false');

    // Click to open
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Akun & 2FA')).toBeDefined();

    // Click to close
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('automatically opens when active route is a child item and sets aria-current', () => {
    render(
      <MemoryRouter initialEntries={['/pengaturan/privasi']}>
        <NavGroup
          id="test-nav-group"
          label="Pengaturan"
          icon={Gear}
          items={testItems}
          userRole="pemilik"
        />
      </MemoryRouter>
    );

    const button = screen.getByRole('button', { name: /Pengaturan/i });
    expect(button.getAttribute('aria-expanded')).toBe('true');

    const privasiLink = screen.getByRole('link', { name: /Privasi & Data/i });
    expect(privasiLink.getAttribute('aria-current')).toBe('page');
  });

  it('filters out items that require pemilik role when user is member', () => {
    render(
      <MemoryRouter initialEntries={['/pengaturan/akun']}>
        <NavGroup
          id="test-nav-group"
          label="Pengaturan"
          icon={Gear}
          items={testItems}
          userRole="member"
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Akun & 2FA')).toBeDefined();
    expect(screen.queryByText('Log Audit')).toBeNull();
  });

  it('calls onItemClick when a sub-item is clicked', () => {
    const onItemClick = vi.fn();
    render(
      <MemoryRouter initialEntries={['/pengaturan/akun']}>
        <NavGroup
          id="test-nav-group"
          label="Pengaturan"
          icon={Gear}
          items={testItems}
          userRole="pemilik"
          onItemClick={onItemClick}
        />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: /Akun & 2FA/i });
    fireEvent.click(link);
    expect(onItemClick).toHaveBeenCalled();
  });
});
