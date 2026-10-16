import React from 'react';
import { Link } from 'react-router-dom';
import { CaretRight, Info } from '@phosphor-icons/react';
import styles from './SegmentedList.module.css';

export interface AvatarProps {
  name: string;
  size?: 48 | 72;
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({ name, size = 48, className = '' }) => {
  const initial = (name.trim().charAt(0) || 'U').toUpperCase();
  const sizeClass = size === 72 ? styles.avatar72 : styles.avatar48;

  return (
    <div className={`${styles.avatar} ${sizeClass} ${className}`} aria-hidden="true">
      {initial}
    </div>
  );
};

export interface ListRowProps {
  title: string;
  isSelf?: boolean;
  subtitle?: React.ReactNode;
  avatarName?: string;
  to?: string;
  onClick?: () => void;
  rightAction?: React.ReactNode;
  showChevron?: boolean;
  ariaLabel?: string;
  className?: string;
}

export const ListRow: React.FC<ListRowProps> = ({
  title,
  isSelf = false,
  subtitle,
  avatarName,
  to,
  onClick,
  rightAction,
  showChevron = true,
  ariaLabel,
  className = '',
}) => {
  const isClickable = Boolean(to || onClick);
  const rowClasses = `${styles.listRow} ${isClickable ? styles.listRowClickable : ''} ${className}`;
  const computedAriaLabel = ariaLabel || `${title}${isSelf ? ' (Anda)' : ''} ${typeof subtitle === 'string' ? subtitle : ''}`.trim();

  const content = (
    <>
      <div className={styles.listRowLeft}>
        {avatarName && <Avatar name={avatarName} size={48} />}
        <div className={styles.listRowContent}>
          <div className={styles.listRowTitle}>
            {title}
            {isSelf && <span className={styles.listRowTitleSelf}> (Anda)</span>}
          </div>
          {subtitle && <div className={styles.listRowSubtitle}>{subtitle}</div>}
        </div>
      </div>
      <div className={styles.listRowRight}>
        {rightAction}
        {isClickable && showChevron && (
          <CaretRight size={18} className={styles.chevron} aria-hidden="true" />
        )}
      </div>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={rowClasses} aria-label={computedAriaLabel}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        className={rowClasses}
        onClick={onClick}
        aria-label={computedAriaLabel}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={rowClasses} aria-label={computedAriaLabel}>
      {content}
    </div>
  );
};

export interface InfoRowProps {
  text: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  className?: string;
}

export const InfoRow: React.FC<InfoRowProps> = ({
  text,
  icon: Icon = Info,
  className = '',
}) => {
  return (
    <div className={`${styles.infoRow} ${className}`} role="note">
      <Icon size={18} className={styles.infoIcon} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
};

export interface SegmentedListProps {
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

export const SegmentedList: React.FC<SegmentedListProps> = ({
  children,
  className = '',
  ariaLabel,
}) => {
  return (
    <div
      className={`${styles.segmentedList} ${className}`}
      role="list"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
};
