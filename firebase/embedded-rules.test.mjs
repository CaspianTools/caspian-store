/**
 * Rules-behaviour tests for the EMBEDDED rules blocks (v15.4.0) that
 * firebase/embedded/build-embedded-rules.mjs generates for a host project.
 * Run with the same emulators as rules.test.mjs (`npm test` runs both).
 *
 * The point of embedded rules is that the store is safe inside a host whose
 * own rules are looser — in particular a host that lets every user write
 * their own `users/{uid}` doc. So the host rules here deliberately do that,
 * and the tests check nobody becomes store admin through it.
 */
import { test, before, after } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { buildEmbeddedRules } from './embedded/build-embedded-rules.mjs';

const { firestore, storage } = buildEmbeddedRules('store_');

// A permissive host: users own their whole users/{uid} doc, role included.
const HOST_FIRESTORE = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() { return request.auth != null; }
    match /users/{uid} {
      allow read, write: if isSignedIn() && request.auth.uid == uid;
    }
  }
${firestore}
}
`;
const HOST_STORAGE = `rules_version = '2';
service firebase.storage {
${storage}
}
`;

let env;
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'caspian-rules-test',
    firestore: { rules: HOST_FIRESTORE, host: '127.0.0.1', port: 8080 },
    storage: { rules: HOST_STORAGE, host: '127.0.0.1', port: 9199 },
  });
});

after(async () => {
  if (env) await env.cleanup();
});

const user = (uid, claims) => env.authenticatedContext(uid, claims);

test('embedded: a host users doc with role=admin does not make a store admin', async () => {
  await env.clearFirestore();
  const db = user('mallory').firestore();
  // The host lets this through — the store must not care.
  await assertSucceeds(setDoc(doc(db, 'users', 'mallory'), { role: 'admin' }));
  await assertFails(setDoc(doc(db, 'store_products', 'p1'), { name: 'x', price: 1 }));
  await assertFails(getDoc(doc(db, 'store_settings', 'site')).then(() => setDoc(doc(db, 'store_settings', 'site'), { a: 1 })));
});

test('embedded: a store_users profile with role=admin cannot be created or used', async () => {
  await env.clearFirestore();
  const db = user('mallory').firestore();
  await assertFails(setDoc(doc(db, 'store_users', 'mallory'), { role: 'admin' }));
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'store_users', 'mallory'), { role: 'admin' });
  });
  await assertFails(setDoc(doc(db, 'store_products', 'p1'), { name: 'x', price: 1 }));
});

test('embedded: the legacy role=admin custom claim is not store admin', async () => {
  await env.clearFirestore();
  const db = user('old', { role: 'admin' }).firestore();
  await assertFails(setDoc(doc(db, 'store_products', 'p1'), { name: 'x', price: 1 }));
});

test('embedded: the storeAdmin claim is store admin', async () => {
  await env.clearFirestore();
  const db = user('owner', { storeAdmin: true }).firestore();
  await assertSucceeds(setDoc(doc(db, 'store_products', 'p1'), { name: 'x', price: 1 }));
});

test('embedded: catalogue reads stay public, unprefixed names have no store rules', async () => {
  await env.clearFirestore();
  const anon = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anon, 'store_products', 'p1')));
  await assertFails(getDoc(doc(anon, 'products', 'p1')));
});

test('embedded: pendingSuperAdmin is gone', async () => {
  await env.clearFirestore();
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(anon, 'store_pendingSuperAdmin', 'a@b.c'), { email: 'a@b.c', designatedAt: 1 }));
});

test('embedded: another user cannot read a buyer order; buyer can', async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'store_orders', 'o1'), { userId: 'alice', status: 'paid' });
  });
  await assertFails(getDoc(doc(user('mallory').firestore(), 'store_orders', 'o1')));
  await assertSucceeds(getDoc(doc(user('alice').firestore(), 'store_orders', 'o1')));
});

test('embedded storage: download files are private; storeAdmin can upload', async () => {
  await env.clearStorage();
  await assertFails(
    uploadBytes(storageRef(user('mallory', { role: 'admin' }).storage(), 'store_downloads/p1/f1'), ZIP, {
      contentType: 'application/zip',
    }),
  );
  await assertSucceeds(
    uploadBytes(storageRef(user('owner', { storeAdmin: true }).storage(), 'store_downloads/p1/f1'), ZIP, {
      contentType: 'application/zip',
    }),
  );
  await assertFails(getDownloadURL(storageRef(user('alice').storage(), 'store_downloads/p1/f1')));
});
