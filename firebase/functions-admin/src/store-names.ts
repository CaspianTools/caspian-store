/**
 * Top-level collection names, namespaced for embedded stores (v15.4.0). An
 * embedded store shares its host's Firestore, so the library prefixes every
 * collection it owns; set CASPIAN_COLLECTION_PREFIX (e.g. `store_`) to the
 * same value as the provider's `embedded.collectionPrefix`. Unset → the
 * unprefixed names standalone stores have always used. Read on each call so
 * a host server that sets it at startup is honoured.
 */
export function storeCol(name: string): string {
  return (process.env.CASPIAN_COLLECTION_PREFIX ?? '') + name;
}
