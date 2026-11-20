#!/usr/bin/env node
/**
 * Embedded-store security rules (v15.4.0).
 *
 * A store mounted inside a host app (`embedded` on the provider) shares the
 * host's Firebase project, so it cannot deploy its own rules files: the host
 * owns them. This script turns the library's firebase/firestore.rules and
 * firebase/storage.rules into blocks the host keeps inside its own files:
 *
 *   - every top-level collection / Storage folder is prefixed (`store_`),
 *     matching the provider's `embedded.collectionPrefix`;
 *   - helper functions are renamed (`isAdmin` → `storeIsAdmin`) so they never
 *     clash with the host's helpers;
 *   - store admin (and POS staff) is the `storeAdmin: true` ID-token claim
 *     only — never the profile `role`, which a host may let users edit;
 *   - the `pendingSuperAdmin` first-run path is removed.
 *
 * Usage (from the host repo):
 *   node <pkg>/firebase/embedded/build-embedded-rules.mjs [--prefix store_]
 *        [--auth "<rules expression>"]
 *        [--firestore firestore.rules] [--storage storage.rules]
 *
 * --auth: an extra condition every signed-in store request must meet, for a
 * host that restricts its own sign-ins (e.g. no custom tokens, verified
 * e-mail). The store's block cannot call the host's rule functions — they
 * live in a different match block — so pass the condition itself.
 *
 * Without --firestore/--storage it prints both blocks. With them it replaces
 * the text between `// BEGIN caspian-store` and `// END caspian-store` in the
 * named host files (add the two marker lines once, inside
 * `service cloud.firestore { … }` / `service firebase.storage { … }`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BEGIN = '// BEGIN caspian-store';
const END = '// END caspian-store';
const DROPPED_COLLECTIONS = new Set(['pendingSuperAdmin']);
const adminExpr = (auth) =>
  `request.auth != null${auth ? ` && (${auth})` : ''} && request.auth.token.storeAdmin == true`;
const authExpr = (auth) => `request.auth != null${auth ? ` && (${auth})` : ''}`;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Body between `{` after `marker` and its matching `}`. */
function innerBlock(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`"${marker}" not found`);
  const open = src.indexOf('{', start + marker.length);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`unbalanced braces after "${marker}"`);
}

/**
 * Split a rules body into top-level items: functions, match blocks and the
 * comment lines in front of them. Returns [{ text, kind, name }].
 */
function topLevelItems(body) {
  const items = [];
  let i = 0;
  let pending = '';
  while (i < body.length) {
    const lineEnd = body.indexOf('\n', i) === -1 ? body.length : body.indexOf('\n', i) + 1;
    const line = body.slice(i, lineEnd);
    const m = line.match(/^\s*(function\s+(\w+)|match\s+\/(\w+))/);
    if (!m) {
      pending += line;
      i = lineEnd;
      continue;
    }
    // The block's own brace ends the line; earlier ones are path wildcards ({id}).
    let depth = 0;
    let j = body.lastIndexOf('{', lineEnd - 1);
    for (; j < body.length; j++) {
      if (body[j] === '{') depth++;
      else if (body[j] === '}' && --depth === 0) break;
    }
    const end = body.indexOf('\n', j) === -1 ? body.length : body.indexOf('\n', j) + 1;
    items.push({
      text: pending + body.slice(i, end),
      kind: m[2] ? 'function' : 'match',
      name: m[2] ?? m[3],
    });
    pending = '';
    i = end;
  }
  if (pending.trim()) items.push({ text: pending, kind: 'trailing', name: '' });
  return items;
}

function renameHelpers(text, names) {
  for (const n of names) {
    const renamed = 'store' + n[0].toUpperCase() + n.slice(1);
    text = text.replace(new RegExp(`\\b${n}\\(`, 'g'), `${renamed}(`);
  }
  return text;
}

function transform(body, prefix, { storage, auth }) {
  const items = topLevelItems(body);
  const helperNames = items.filter((it) => it.kind === 'function').map((it) => it.name);
  const out = [];
  for (const it of items) {
    if (it.kind === 'match' && DROPPED_COLLECTIONS.has(it.name)) continue;
    let text = it.text;
    if (it.kind === 'function' && (it.name === 'isAdmin' || it.name === 'isStaff')) {
      // Keep the leading comment out: it describes the standalone signal.
      text = `    // Embedded store: admin (and POS staff) is the storeAdmin claim the host grants.\n` +
        `    function ${it.name}() {\n      return ${adminExpr(auth)};\n    }\n`;
    }
    if (it.kind === 'function' && it.name === 'isAuth' && auth) {
      text = `    // Embedded store: signed in, under the host's own sign-in conditions.\n` +
        `    function isAuth() {\n      return ${authExpr(auth)};\n    }\n`;
    }
    if (it.kind === 'match') {
      text = text.replace(new RegExp(`match\\s+/${it.name}/`), `match /${prefix}${it.name}/`);
    }
    if (!storage) {
      // Cross-document lookups: documents/<collection>/… → prefixed.
      text = text.replace(/documents\/(\w+)\//g, (_, c) => `documents/${prefix}${c}/`);
    }
    out.push(text);
  }
  return renameHelpers(out.join(''), helperNames);
}

export function buildEmbeddedRules(prefix = 'store_', { auth = '' } = {}) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(prefix)) throw new Error(`invalid prefix "${prefix}"`);
  const firestoreSrc = readFileSync(join(here, '..', 'firestore.rules'), 'utf8');
  const storageSrc = readFileSync(join(here, '..', 'storage.rules'), 'utf8');
  const header = (what) =>
    `  ${BEGIN}\n` +
    `  // Generated by @caspian-explorer/script-caspian-store (embedded ${what} rules,\n` +
    `  // prefix "${prefix}"${auth ? ', host --auth condition' : ''}). Do not edit by hand: re-run build-embedded-rules.mjs.\n`;
  const firestore =
    header('Firestore') +
    `  match /databases/{database}/documents {\n` +
    transform(innerBlock(firestoreSrc, 'match /databases/{database}/documents'), prefix, { storage: false, auth }) +
    `  }\n  ${END}`;
  const storage =
    header('Storage') +
    `  match /b/{bucket}/o {\n` +
    transform(innerBlock(storageSrc, 'match /b/{bucket}/o'), prefix, { storage: true, auth }) +
    `  }\n  ${END}`;
  return { firestore, storage };
}

function inject(file, block) {
  const src = readFileSync(file, 'utf8');
  const a = src.indexOf(BEGIN);
  const b = src.indexOf(END);
  if (a < 0 || b < a) throw new Error(`${file}: add "${BEGIN}" and "${END}" lines first`);
  const lineStart = src.lastIndexOf('\n', a) + 1;
  const next = src.slice(0, lineStart) + block + src.slice(b + END.length);
  if (next !== src) writeFileSync(file, next);
  console.log(`${file}: caspian-store block ${next === src ? 'already current' : 'updated'}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { firestore, storage } = buildEmbeddedRules(arg('prefix', 'store_'), { auth: arg('auth', '') });
  const fsFile = arg('firestore');
  const stFile = arg('storage');
  if (!fsFile && !stFile) {
    console.log(firestore + '\n\n' + storage);
  } else {
    if (fsFile) inject(fsFile, firestore);
    if (stFile) inject(stFile, storage);
  }
}
