'use client';

import { useT } from '../i18n/locale-context';
import { DownloadIcon } from '../ui/icons';
import { cn } from '../utils/cn';

export interface DigitalDownloadBadgeProps {
  className?: string;
  style?: React.CSSProperties;
}

/** "Digital download" label for products delivered as files (v15.4.0). */
export function DigitalDownloadBadge({ className, style }: DigitalDownloadBadgeProps) {
  const t = useT();
  return (
    <span
      className={cn('caspian-digital-badge', className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        borderRadius: 999,
        border: '1px solid currentColor',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.02em',
        color: 'var(--caspian-primary, #111)',
        ...style,
      }}
    >
      <DownloadIcon size={12} aria-hidden />
      {t('product.digital.label')}
    </span>
  );
}
