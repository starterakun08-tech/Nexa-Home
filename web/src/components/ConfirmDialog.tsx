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
  onConfirm,
  onCancel,
  icon,
}) => {
  const showModal = isOpen ?? open ?? false;
  const isDangerous = isDanger ?? danger ?? false;

  if (!showModal) return null;

  return (
    <div className={styles.backdrop} onClick={onCancel}>
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
        <div className={styles.actions}>
          <AppButton variant="outline" onClick={onCancel}>
            {cancelLabel}
          </AppButton>
          <AppButton
            variant={isDangerous ? 'danger' : 'primary'}
            className={isDangerous ? styles.btnDanger : ''}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AppButton>
        </div>
      </div>
    </div>
  );
};
