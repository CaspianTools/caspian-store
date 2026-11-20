'use client';

import { useState } from 'react';
import type { Order, OrderStatus } from '../types';
import { getDownloadLink } from '../services/download-service';
import { useCaspianFirebase } from '../provider/caspian-store-provider';
import { useT } from '../i18n/locale-context';
import { Button } from '../ui/button';
import { cn } from '../utils/cn';
import { formatBytes } from '../utils/format-bytes';

/** Statuses the `getDownloadUrl` callable delivers files for. */
const DELIVERABLE_STATUSES: ReadonlySet<OrderStatus> = new Set([
  'paid',
  'processing',
  'shipped',
  'delivered',
]);

/** True when the order lists files and its payment has cleared. */
export function orderHasDeliverableDownloads(order: Pick<Order, 'downloads' | 'status'>): boolean {
  return (order.downloads?.length ?? 0) > 0 && DELIVERABLE_STATUSES.has(order.status);
}

export interface OrderDownloadsProps {
  order: Pick<Order, 'id' | 'downloads' | 'status'>;
  /** Hide the "Downloads" heading, e.g. when the host page already labels the section. */
  hideTitle?: boolean;
  className?: string;
}

function errorKey(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  if (code.endsWith('not-found')) return 'downloads.error.notFound';
  if (code.endsWith('failed-precondition')) return 'downloads.error.unpaid';
  if (code.endsWith('resource-exhausted')) return 'downloads.error.limitReached';
  if (code.endsWith('unauthenticated')) return 'downloads.error.signIn';
  return 'downloads.error.generic';
}

/**
 * The files a paid order entitles the buyer to (v15.4.0). Each Download
 * click asks `getDownloadUrl` for a short-lived signed link, which counts
 * one download, then hands the browser to it.
 */
export function OrderDownloads({ order, hideTitle, className }: OrderDownloadsProps) {
  const { functions } = useCaspianFirebase();
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<Record<string, number | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const downloads = order.downloads ?? [];
  if (downloads.length === 0) return null;
  const paid = DELIVERABLE_STATUSES.has(order.status);

  const handleDownload = async (fileId: string) => {
    setBusy(fileId);
    setErrors((e) => {
      const next = { ...e };
      delete next[fileId];
      return next;
    });
    try {
      const link = await getDownloadLink(functions, order.id, fileId);
      setRemaining((r) => ({ ...r, [fileId]: link.remaining }));
      // The signed URL is an external file, not an in-app route.
      window.location.assign(link.url);
    } catch (error) {
      console.error('[caspian-store] Download failed:', error);
      setErrors((e) => ({ ...e, [fileId]: t(errorKey(error)) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={cn('caspian-order-downloads', className)}>
      {!hideTitle && (
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>{t('downloads.title')}</h2>
      )}
      {!paid && (
        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#666' }}>{t('downloads.awaitingPayment')}</p>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {downloads.map((d) => {
          const left = remaining[d.fileId];
          const error = errors[d.fileId];
          return (
            <li
              key={`${d.productId}:${d.fileId}`}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 'var(--caspian-radius, 6px)',
              }}
            >
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 500, overflowWrap: 'anywhere' }}>{d.name}</p>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#888' }}>
                  {formatBytes(d.size)}
                  {d.downloadLimit > 0 &&
                    ` · ${
                      typeof left === 'number'
                        ? t('downloads.remaining', { count: left })
                        : t('downloads.limit', { count: d.downloadLimit })
                    }`}
                </p>
                {error && (
                  <p role="alert" style={{ margin: '4px 0 0', fontSize: 12, color: '#b91c1c' }}>
                    {error}
                  </p>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleDownload(d.fileId)}
                loading={busy === d.fileId}
                disabled={!paid || busy !== null}
                aria-label={t('downloads.downloadFile', { name: d.name })}
              >
                {t('downloads.download')}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
