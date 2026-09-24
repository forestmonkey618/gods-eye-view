#!/usr/bin/env node
/**
 * Provenance authority freeze check — I3a.
 *
 * `src/data/provenance.js` is the single normalization/validation authority
 * for provenance descriptors (I3). This check freezes the proven boundaries
 * that keep the trust layer honest:
 *
 * - The authority is a zero-dependency, wall-clock-free leaf: it may not
 *   import anything, use Cesium/DOM/network, or read the clock. Absence must
 *   remain representable; a clock inside the authority is how unknown facts
 *   get manufactured.
 * - The epistemic vocabulary and descriptor construction live ONLY in the
 *   authority: no second EPISTEMIC definition, and every `createProvenance`
 *   call site imports it from the authority (consumers may not hand-roll
 *   descriptors or a competing helper).
 * - The I2 identity surface stays provenance-unaware: entityKey, recordIndex
 *   and currentRecordIndex carry no epistemic logic, and the freshness
 *   authority (feedState) does not import provenance either — the two stay
 *   distinct concerns.
 * - Provenance lives on the data path, not the render path: the record
 *   stores that own the provenance sidecars must not import Cesium or touch
 *   DOM globals, so rendering visibility cannot influence provenance.
 *
 * Usage: node scripts/check-provenance-authority.mjs
 * (also run by `npm run check:boundaries`)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const AUTHORITY = 'src/data/provenance.js';

const problems = [];

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function check(rel, predicate, message) {
  let content;
  try {
    content = read(rel);
  } catch {
    problems.push(`${rel}: could not read — expected to exist`);
    return;
  }
  if (!predicate(content)) problems.push(`${rel}: ${message}`);
}

/** Every src module file (js/mjs/cjs), stable order. */
function allSourceFiles(dir = SRC, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'local_data' || entry.name === 'node_modules')
        continue;
      allSourceFiles(abs, out);
    } else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
      out.push(path.relative(ROOT, abs).split(path.sep).join('/'));
    }
  }
  return out.sort();
}

// --- 1. Authority purity ---------------------------------------------------

check(
  AUTHORITY,
  (c) => !c.match(/^import /m) && !c.includes('import('),
  'must have zero imports (leaf authority)',
);
check(
  AUTHORITY,
  (c) => !c.includes('Date.now') && !c.includes('new Date('),
  'must not read the wall clock (absence must stay representable)',
);
check(
  AUTHORITY,
  (c) => !c.includes("from 'cesium'") && !c.includes('import * as Cesium'),
  'must not import Cesium',
);
check(
  AUTHORITY,
  (c) => !c.match(/\bdocument\./) && !c.match(/\bwindow\./),
  'must not use DOM globals',
);
check(
  AUTHORITY,
  (c) => !c.includes('fetch(') && !c.includes('XMLHttpRequest'),
  'must not use the network',
);
check(
  AUTHORITY,
  (c) => c.includes('export const EPISTEMIC'),
  'must export the EPISTEMIC vocabulary',
);
check(
  AUTHORITY,
  (c) => c.includes('export function createProvenance'),
  'must export createProvenance',
);
check(
  AUTHORITY,
  (c) => c.includes('export function isValidProvenance'),
  'must export isValidProvenance',
);

// The locked vocabulary: exactly REPORTED / DERIVED / MODELED / INTERPRETED.
for (const value of ['reported', 'derived', 'modeled', 'interpreted']) {
  check(
    AUTHORITY,
    (c) => c.includes(`'${value}'`),
    `vocabulary must include '${value}'`,
  );
}

// No forbidden descriptor keys may appear as object-literal keys: confidence,
// freshness, age, history, observation ids, store identity, licence/URL are
// other concerns (I4/I5/I9/identity) and must not leak into the descriptor.
check(
  AUTHORITY,
  (c) =>
    !c.match(
      /\b(confidence|quality|ageMs|age|freshness|stale|fresh|history|observationId|providerLabel|storeId|license|url)\s*:/,
    ),
  'descriptor must not carry forbidden fields (confidence/age/freshness/history/observationId/storeId/…) as keys',
);

// --- 2. Single construction authority, whole src/ --------------------------

const files = allSourceFiles();
const authorityAbs = path.resolve(ROOT, AUTHORITY);
const vocabularyDef =
  /(?:export\s+)?const\s+EPISTEMIC\s*=|EPISTEMIC\s*=\s*Object\.freeze/;

for (const rel of files) {
  if (rel === AUTHORITY) continue;
  let content;
  try {
    content = readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    continue;
  }
  if (vocabularyDef.test(content)) {
    problems.push(`${rel}: must not define a second EPISTEMIC vocabulary`);
  }
  if (content.includes('createProvenance(')) {
    // Every construction site must import the constructor from the authority.
    const importMatches = [...content.matchAll(/from\s+['"]([^'"]+)['"]/g)];
    const importsAuthority = importMatches.some((m) => {
      const target = m[1];
      if (!target.startsWith('.')) return false;
      const resolved = path.resolve(path.dirname(path.join(ROOT, rel)), target);
      return resolved === authorityAbs;
    });
    if (!importsAuthority) {
      problems.push(
        `${rel}: createProvenance must be imported from ${AUTHORITY}`,
      );
    }
  }
}

// --- 3. I2 identity + freshness stay provenance-unaware ---------------------

for (const rel of [
  'src/data/entityKey.js',
  'src/data/recordIndex.js',
  'src/data/currentRecordIndex.js',
  'src/data/feedState.js',
]) {
  check(
    rel,
    (c) =>
      !c.match(/from\s+['"][^'"]*provenance\.js['"]/) &&
      !c.includes('createProvenance') &&
      !c.match(/\bepistemic\s*:/) &&
      !c.match(/\bEPISTEMIC\b/),
    'must stay provenance-unaware (identity/freshness are separate authorities)',
  );
}

// --- 4. Provenance lives on the data path, not the render path --------------

// The record stores own the sidecars; none may consult Cesium or DOM state,
// so rendering visibility cannot affect which descriptors exist.
for (const rel of [
  'src/layers/flights/records.js',
  'src/layers/military/records.js',
  'src/layers/vessels/records.js',
]) {
  check(
    rel,
    (c) => !c.includes("from 'cesium'") && !c.includes('import * as Cesium'),
    'record store must not import Cesium (provenance is not rendering)',
  );
  check(
    rel,
    (c) => !c.match(/\bdocument\./) && !c.match(/\bwindow\./),
    'record store must not use DOM globals (provenance is not rendering)',
  );
  check(
    rel,
    (c) => c.includes('provenance = new Map()'),
    'record store must own its provenance sidecar Map',
  );
}

if (problems.length) {
  console.error('PROVENANCE AUTHORITY: FAILED\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}

console.log(
  'PROVENANCE AUTHORITY: OK — I3a boundaries frozen (authority zero-dep, no wall clock, locked 4-value vocabulary, single construction site graph, identity/freshness provenance-unaware, record stores Cesium/DOM-free).',
);
