/**
 * Grant or remove store admin on an embedded store. Embedded stores decide
 * admin by the `storeAdmin: true` custom claim (see `CaspianEmbedOptions`),
 * which only the Admin SDK can set — so the host calls this from its own
 * admin tooling. Other custom claims on the user are kept.
 *
 * The user's current ID token keeps its old claims until it refreshes (at
 * most an hour, or at once if the client calls `refreshProfile()` /
 * `getIdToken(true)`). Revoke their refresh tokens too if a removal must take
 * effect immediately.
 */
export async function setStoreAdminClaim(uid: string, admin: boolean): Promise<void> {
  const { getAuth } = await import('firebase-admin/auth');
  const user = await getAuth().getUser(uid);
  const claims: Record<string, unknown> = { ...(user.customClaims ?? {}) };
  if (admin) claims.storeAdmin = true;
  else delete claims.storeAdmin;
  await getAuth().setCustomUserClaims(uid, claims);
}
