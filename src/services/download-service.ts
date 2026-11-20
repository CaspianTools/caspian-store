import type { Functions } from 'firebase/functions';
import { caspianCallable } from './caspian-callable';

export interface DownloadLink {
  url: string;
  /** Downloads left for this file on this order; null = unlimited. */
  remaining: number | null;
}

/**
 * Ask the server for a short-lived signed link to a purchased file
 * (`getDownloadUrl` callable, v15.4.0). Each call counts as one download.
 */
export async function getDownloadLink(
  functions: Functions,
  orderId: string,
  fileId: string,
): Promise<DownloadLink> {
  const result = await caspianCallable<{ orderId: string; fileId: string }, DownloadLink>(
    functions,
    'getDownloadUrl',
  )({ orderId, fileId });
  return result.data;
}
