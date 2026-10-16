import React from 'react';
import { AppButton } from './AppButton';
import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  isOpen?: boolean;
  open?: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
  danger?: boolean;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  icon?: React.ReactNode;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  open,
  title,
  message,
  confirmLabel = 'Ya, lanjutkan',
  cancelLabel = 'Batal',
  isDanger,
  danger,
  isLoading = false,
  error = null,
  onRetry,
  onConfirm,
  onCancel,
  icon,
}) => {
  const showModal = isOpen ?? open ?? false;
  const isDangerous = isDanger ?? danger ?? false;

  if (!showModal) return null;

  return (
    <div className={styles.backdrop} onClick={isLoading ? undefined : onCancel} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          {icon && (
            <div className={`${styles.iconCircle} ${isDangerous ? styles.danger : ''}`}>
              {icon}
            </div>
          )}
          <h3 className={styles.title}>{title}</h3>
        </div>
        <p className={styles.message}>{message}</p>

        {error && (
          <div
            style={{
              backgroundColor: 'var(--color-status-danger-subtle, rgba(239, 68, 68, 0.1))',
              color: 'var(--color-status-danger)',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-sm)',
              lineHeight: 1.4,
            }}
          >
            <div>{error}</div>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                disabled={isLoading}
                style={{
                  marginTop: 'var(--space-2)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-status-danger)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                  fontSize: 'var(--text-sm)',
                }}
              >
                Coba lagi
              </button>
            )}
          </div>
        )}

        <div className={styles.actions}>
          <AppButton variant="outline" onClick={onCancel} disabled={isLoading}>
            {cancelLabel}
          </AppButton>
          <AppButton
            variant={isDangerous ? 'danger' : 'primary'}
            className={isDangerous ? styles.btnDanger : ''}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Memproses...' : confirmLabel}
          </AppButton>
        </div>
      </div>
    </div>
  );
};
