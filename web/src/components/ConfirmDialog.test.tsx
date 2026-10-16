import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders title, message, and action buttons when open', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        isOpen={true}
        title="Putuskan & Reset Perangkat?"
        message="Perangkat sedang offline."
        confirmLabel="Ya, Putuskan Perangkat"
        cancelLabel="Batal"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('Putuskan & Reset Perangkat?')).toBeDefined();
    expect(screen.getByText('Perangkat sedang offline.')).toBeDefined();
    expect(screen.getByText('Ya, Putuskan Perangkat')).toBeDefined();
    expect(screen.getByText('Batal')).toBeDefined();
  });

  it('disables button and displays indicator when isLoading is true', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        isOpen={true}
        title="Putuskan & Reset Perangkat?"
        message="Perangkat sedang offline."
        confirmLabel="Ya, Putuskan Perangkat"
        isLoading={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    const submitBtn = screen.getByText('Memproses...') as HTMLButtonElement;
    expect(submitBtn).toBeDefined();
    expect(submitBtn.disabled).toBe(true);

    fireEvent.click(submitBtn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('displays error message and handles retry button', () => {
    const onRetry = vi.fn();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        isOpen={true}
        title="Putuskan & Reset Perangkat?"
        message="Perangkat sedang offline."
        error="Gagal menghubungi broker MQTT."
        onRetry={onRetry}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('Gagal menghubungi broker MQTT.')).toBeDefined();
    const retryBtn = screen.getByText('Coba lagi');
    expect(retryBtn).toBeDefined();

    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
