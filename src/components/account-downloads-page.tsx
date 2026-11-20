'use client';

import { useEffect, useState } from 'react';
import type { Order } from '../types';
import { getOrdersByUser } from '../services/order-service';
import { useAuth } from '../context/auth-context';
import { useCaspianFirebase, useCaspianLink } from '../provider/caspian-store-provider';
import { useLocale, useT } from '../i18n/locale-context';
import { Badge, Skeleton } from '../ui/misc';
import { OrderDownloads } from './order-downloads';

export interface AccountDownloadsPageProps {
  /** Build the link to an order. Default: `/orders/{id}`. */
  getOrderHref?: (orderId: string) => string;
  /** How many recent orders to scan for downloads. Default: 50. */
  max?: number;
  className?: string;
}

/**
 * Every file the signed-in buyer has bought, grouped by order (v15.4.0).
 * Reads the same order query as `<OrderHistoryList>` and keeps the orders
 * that carry `downloads`. Rendered by `<AccountPage>`'s Downloads section,
 * which `<CaspianRoot>` serves at `/account/downloads`.
 */
export function AccountDownloadsPage({
  getOrderHref = (id) => `/orders/${id}`,
  max = 50,
  className,
}: AccountDownloadsPageProps) {
  const { user, loading: authLoading } = useAuth();
  const { db } = useCaspianFirebase();
  const Link = useCaspianLink();
  const t = useT();
  const locale = useLocale();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      setFailed(false);
      try {
        const data = await getOrdersByUser(db, user.uid, max);
        if (alive) setOrders(data.filter((o) => (o.downloads?.length ?? 0) > 0));
      } catch (err) {
        console.error('[caspian-store] Failed to load downloads:', err);
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [db, user, max]);

  if (authLoading || loading) {
    return (
      <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skeleton style={{ height: 56, width: '100%' }} />
        <Skeleton style={{ height: 56, width: '100%' }} />
      </div>
    );
  }

  if (!user) {
    return <p className={className} style={{ color: '#888' }}>{t('orderHistory.signInHint')}</p>;
  }

  if (failed) {
    return (
      <p className={className} role="alert" style={{ color: '#b91c1c' }}>
        {t('downloads.loadFailed')}
      </p>
    );
  }

  if (orders.length === 0) {
    return <p className={className} style={{ color: '#888' }}>{t('downloads.empty')}</p>;
  }

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {orders.map((order) => {
        const placed = order.createdAt?.toDate ? order.createdAt.toDate() : null;
        return (
          <div key={order.id}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
                fontSize: 13,
              }}
            >
              <Link href={getOrderHref(order.id)}>
                <span style={{ fontWeight: 600 }}>
                  {t('orderHistory.orderPrefix')}
                  {order.id.slice(0, 10)}
                </span>
              </Link>
              {placed && <span style={{ color: '#888' }}>{placed.toLocaleDateString(locale)}</span>}
              <Badge variant="secondary">{t(`order.status.${order.status}`)}</Badge>
            </div>
            <OrderDownloads order={order} hideTitle />
          </div>
        );
      })}
    </div>
  );
}
