import React, { useState, useEffect, useId } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { CaretRight } from '@phosphor-icons/react';
import styles from './NavGroup.module.css';

export interface NavSubItemDef {
  path: string;
  label: string;
  badge?: string;
  roles?: ('' | 'pemilik' | 'anggota' | 'biasa' | 'admin' | 'member' | 'child' | string)[];
  children?: NavSubItemDef[];
}

export interface NavGroupProps {
  id?: string;
  label: string;
  icon: React.ComponentType<{ size?: number; weight?: 'regular' | 'bold' | 'fill' }>;
  items: NavSubItemDef[];
  userRole?: string;
  storageKey?: string;
  onItemClick?: () => void;
}

export interface NavSubItemProps {
  item: NavSubItemDef;
  userRole?: string;
  onItemClick?: () => void;
  level?: number;
}

export const NavSubItem: React.FC<NavSubItemProps> = ({
  item,
  userRole,
  onItemClick,
  level = 0,
}) => {
  const location = useLocation();
  const [nestedOpen, setNestedOpen] = useState(false);

  // Filter role-based items
  if (item.roles && userRole && !item.roles.includes(userRole)) {
    return null;
  }

  const hasChildren = item.children && item.children.length > 0;
  const isChildActive = hasChildren && item.children?.some((c) => location.pathname === c.path);

  useEffect(() => {
    if (isChildActive) {
      setNestedOpen(true);
    }
  }, [isChildActive]);

  if (hasChildren) {
    return (
      <li className={styles.nestedGroup}>
        <button
          type="button"
          className={styles.subItem}
          onClick={() => setNestedOpen(!nestedOpen)}
          aria-expanded={nestedOpen}
          style={{ paddingLeft: `calc(var(--space-3) + ${level * 12}px)` }}
        >
          <span>{item.label}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            {item.badge && <span className={styles.badge}>{item.badge}</span>}
            <CaretRight
              size={14}
              className={`${styles.chevron} ${nestedOpen ? styles.chevronOpen : ''}`}
            />
          </div>
        </button>
        {nestedOpen && (
          <ul className={styles.subList} style={{ borderLeftWidth: '1px' }}>
            {item.children?.map((child) => (
              <NavSubItem
                key={child.path}
                item={child}
                userRole={userRole}
                onItemClick={onItemClick}
                level={level + 1}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <NavLink
        to={item.path}
        className={({ isActive }) =>
          `${styles.subItem} ${isActive ? styles.subItemActive : ''}`
        }
        aria-current={location.pathname === item.path ? 'page' : undefined}
        onClick={() => {
          try {
            localStorage.setItem('nexa_last_pengaturan_subroute', item.path);
          } catch {
            // Ignore localStorage errors
          }
          if (onItemClick) {
            onItemClick();
          }
        }}
        style={{ paddingLeft: `calc(var(--space-3) + ${level * 12}px)` }}
      >
        <span>{item.label}</span>
        {item.badge && <span className={styles.badge}>{item.badge}</span>}
      </NavLink>
    </li>
  );
};

export const NavGroup: React.FC<NavGroupProps> = ({
  id,
  label,
  icon: Icon,
  items,
  userRole,
  storageKey = 'nexa_nav_group_settings',
  onItemClick,
}) => {
  const generatedId = useId();
  const contentId = id || `nav-group-${generatedId}`;
  const location = useLocation();

  // Check if any child item matches current route
  const isAnyChildActive = items.some(
    (item) =>
      location.pathname === item.path ||
      item.children?.some((child) => location.pathname === child.path)
  );

  // Initialize open state from localStorage or if a child route is active
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (isAnyChildActive) return true;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        return stored === 'true';
      }
    } catch {
      // Fallback
    }
    return false;
  });

  // Automatically open group when active route is within this group
  useEffect(() => {
    if (isAnyChildActive) {
      setIsOpen(true);
    }
  }, [isAnyChildActive]);

  const handleToggle = () => {
    setIsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        // Ignore localStorage error
      }
      return next;
    });
  };

  // Filter items based on user role
  const visibleItems = items.filter(
    (item) => !item.roles || !userRole || item.roles.includes(userRole)
  );

  return (
    <div className={styles.navGroup}>
      <button
        type="button"
        id={`${contentId}-btn`}
        className={styles.headerButton}
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <div className={styles.headerLeft}>
          <Icon size={20} />
          <span>{label}</span>
        </div>
        <CaretRight
          size={16}
          className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}
        />
      </button>

      <div
        id={contentId}
        role="region"
        aria-labelledby={`${contentId}-btn`}
        className={`${styles.childrenWrapper} ${isOpen ? styles.childrenWrapperOpen : ''}`}
      >
        <div className={styles.childrenInner}>
          <ul className={styles.subList}>
            {visibleItems.map((item) => (
              <NavSubItem
                key={item.path}
                item={item}
                userRole={userRole}
                onItemClick={onItemClick}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
