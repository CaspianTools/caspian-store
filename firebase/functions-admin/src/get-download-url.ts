import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { reportFunctionError } from './error-report';
import { storeCol } from './store-names';

export interface GetDownloadUrlRequest {
  orderId: string;
  fileId: string;
}

export interface GetDownloadUrlResponse {
  url: string;
  /** Downloads left for this file on this order; null = unlimited. */
  remaining: number | null;
}

/** Orders whose payment has cleared. `pending` / `on-hold` / `cancelled` get nothing. */
const DELIVERABLE = new Set(['paid', 'processing', 'shipped', 'delivered']);
const LINK_TTL_MS = 10 * 60 * 1000;

interface OrderDownloadEntry {
  productId: string;
  fileId: string;
  name: string;
  downloadLimit?: number;
}

/**
 * Hands the buyer of a digital product a short-lived signed link to one of
 * its files (v15.4.0).
 *
 * The files sit in the store's private `downloads/` Storage folder, which the
 * security rules let no client read, so this is the only way to them. The
 * caller must own the order (`orders/{id}.userId`), the order must be paid,
 * and the file must be among the `downloads` the payment webhook recorded on
 * it. Per-file counts live in `orderDownloads/{orderId}` (server-only), and
 * a product's `downloadLimit` caps them.
 *
 * Signing a URL needs the server's service account to be allowed to sign
 * (Cloud Functions / App Hosting: the "Service Account Token Creator" role on
 * itself). In server mode set CASPIAN_STORAGE_BUCKET if the Admin app has no
 * default bucket.
 */
export const getDownloadUrl = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to download.');
  const { orderId, fileId } = (request.data ?? {}) as Partial<GetDownloadUrlRequest>;
  if (typeof orderId !== 'string' || !orderId || typeof fileId !== 'string' || !fileId) {
    throw new HttpsError('invalid-argument', 'orderId and fileId are required.');
  }

  const db = getFirestore();
  const orderRef = db.collection(storeCol('orders')).doc(orderId);
  const countsRef = db.collection(storeCol('orderDownloads')).doc(orderId);

  try {
    const { entry, remaining } = await db.runTransaction(async (tx) => {
      const [orderSnap, countsSnap] = await Promise.all([tx.get(orderRef), tx.get(countsRef)]);
      // Same answer for "no such order" and "not yours", so ids can't be probed.
      if (!orderSnap.exists || orderSnap.get('userId') !== request.auth!.uid) {
        throw new HttpsError('not-found', 'Download not found.');
      }
      if (!DELIVERABLE.has(String(orderSnap.get('status')))) {
        throw new HttpsError('failed-precondition', 'This order has not been paid yet.');
      }
      const downloads = (orderSnap.get('downloads') ?? []) as OrderDownloadEntry[];
      const entry = downloads.find((d) => d.fileId === fileId);
      if (!entry) throw new HttpsError('not-found', 'Download not found.');

      const used = Number(countsSnap.get(`counts.${fileId}`) ?? 0);
      const limit = Number(entry.downloadLimit ?? 0);
      if (limit > 0 && used >= limit) {
        throw new HttpsError('resource-exhausted', 'You have used all downloads for this file.');
      }
      tx.set(
        countsRef,
        {
          userId: request.auth!.uid,
          counts: { [fileId]: FieldValue.increment(1) },
          lastDownloadAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return { entry, remaining: limit > 0 ? limit - used - 1 : null };
    });

    // The file path comes from the product now, not the order, so an admin
    // replacing a file (same id) delivers the new version to past buyers.
    const productSnap = await db.collection(storeCol('products')).doc(entry.productId).get();
    const files = (productSnap.get('files') ?? []) as Array<{ id?: string; storagePath?: string; name?: string }>;
    const file = files.find((f) => f.id === fileId);
    if (!file?.storagePath) {
      throw new HttpsError('not-found', 'This file is no longer available. Contact the store.');
    }
    const bucket = getStorage().bucket(process.env.CASPIAN_STORAGE_BUCKET || undefined);
    const filename = (file.name || entry.name || 'download').replace(/["\\\r\n]/g, '');
    const [url] = await bucket.file(storeCol(file.storagePath)).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + LINK_TTL_MS,
      responseDisposition: `attachment; filename="${filename}"`,
    });
    const response: GetDownloadUrlResponse = { url, remaining };
    return response;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    void reportFunctionError('get-download-url', err, { orderId, fileId });
    throw new HttpsError('internal', 'Could not prepare the download. Try again shortly.');
  }
});
