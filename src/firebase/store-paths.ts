import {
  collection as fsCollection,
  doc as fsDoc,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';

/**
 * Namespacing for embedded stores (v15.4.0). A store mounted inside a host app
 * shares the host's Firestore and Storage, so every top-level collection and
 * every Storage path the store owns gets a prefix (`store_` by default) and
 * can never collide with — or be governed by — the host's own `users`,
 * `settings`, `products`, … Standalone stores register no prefix and keep
 * their existing names.
 *
 * Keyed by instance so two stores on one page (preview + live) stay separate.
 * Library code imports `collection` / `doc` from this module instead of
 * `firebase/firestore`; only a path rooted at the Firestore instance is
 * prefixed (its first segment), so subcollections and references built from
 * other references are untouched.
 */
const firestorePrefixes = new WeakMap<Firestore, string>();
const storagePrefixes = new WeakMap<FirebaseStorage, string>();

export function registerStorePrefix(
  db: Firestore,
  storage: FirebaseStorage | null,
  prefix: string,
): void {
  firestorePrefixes.set(db, prefix);
  if (storage) storagePrefixes.set(storage, prefix);
}

/** The prefix registered for this Firestore instance ('' when none). */
export function storeCollectionPrefix(db: Firestore): string {
  return firestorePrefixes.get(db) ?? '';
}

/** Top-level collection name as stored: `orders` → `store_orders` when embedded. */
export function storeCollectionName(db: Firestore, name: string): string {
  return storeCollectionPrefix(db) + name;
}

/** Storage object path as stored: `products/a.jpg` → `store_products/a.jpg` when embedded. */
export function storeStoragePath(storage: FirebaseStorage, path: string): string {
  const prefix = storagePrefixes.get(storage) ?? '';
  if (!prefix) return path;
  const clean = path.replace(/^\/+/, '');
  return clean.startsWith(prefix) ? clean : prefix + clean;
}

function isFirestore(parent: unknown): parent is Firestore {
  return (
    typeof parent === 'object' &&
    parent !== null &&
    (parent as { type?: unknown }).type === 'firestore'
  );
}

function prefixed(db: Firestore, path: string, segments: string[]): [string, ...string[]] {
  const prefix = firestorePrefixes.get(db);
  if (!prefix) return [path, ...segments];
  // `path` may itself hold several segments (`users/abc`); prefix the first.
  return [prefix + path.replace(/^\/+/, ''), ...segments];
}

export function collection(
  firestore: Firestore,
  path: string,
  ...pathSegments: string[]
): CollectionReference<DocumentData>;
export function collection(
  reference: CollectionReference<unknown> | DocumentReference<unknown>,
  path: string,
  ...pathSegments: string[]
): CollectionReference<DocumentData>;
export function collection(
  parent: Firestore | CollectionReference<unknown> | DocumentReference<unknown>,
  path: string,
  ...pathSegments: string[]
): CollectionReference<DocumentData> {
  if (isFirestore(parent)) return fsCollection(parent, ...prefixed(parent, path, pathSegments));
  return fsCollection(parent as CollectionReference<unknown>, path, ...pathSegments);
}

export function doc(
  firestore: Firestore,
  path: string,
  ...pathSegments: string[]
): DocumentReference<DocumentData>;
export function doc<T>(
  reference: CollectionReference<T>,
  path?: string,
  ...pathSegments: string[]
): DocumentReference<T>;
export function doc(
  reference: DocumentReference<unknown>,
  path: string,
  ...pathSegments: string[]
): DocumentReference<DocumentData>;
export function doc(
  parent: Firestore | CollectionReference<unknown> | DocumentReference<unknown>,
  path?: string,
  ...pathSegments: string[]
): DocumentReference<unknown> {
  if (isFirestore(parent)) return fsDoc(parent, ...prefixed(parent, path ?? '', pathSegments));
  if (path === undefined) return fsDoc(parent as CollectionReference<unknown>);
  return fsDoc(parent as CollectionReference<unknown>, path, ...pathSegments);
}
