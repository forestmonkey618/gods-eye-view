#!/usr/bin/env node
/**
 * Source-registry authority freeze check — I4a.
 *
 * `src/data/sourceRegistry.js` is the single canonical authority that resolves
 * a stable provenance `sourceId` to a static description of the known external
 * source it names. This check freezes the boundaries that keep that answer
 * honest:
 *
 * - Authority purity: zero imports, no wall clock (a clock in the registry is
 *   how "when did we last see this source" leaks into a static descriptor), no
 *   Cesium/DOM/network/storage, no environment or credential reads.
 * - Descriptor hygiene: only static identity/description keys may be written
 *   as object-literal keys in the authority — no freshness/runtime state, no
 *   lifecycle state, no store/layer identity, no credential material.
 * - Single construction path: `createSourceRegistry` exists and is called only
 *   inside the authority (tests may build fixture registries). No other module
 *   may define the lookup surface or a competing registry singleton, so a
 *   second source registry cannot quietly appear.
 * - Provenance independence (both semantics): `provenance.js` never mentions
 *   the registry — `createProvenance` must keep accepting well-grammatical
 *   unknown sourceIds, and a registry lookup must never gate ingestion.
 * - Grammar mirror: the registry's key grammar literal matches the sourceId
 *   grammar `provenance.js` owns, so the two namespaces cannot drift apart.
 *
 * Usage: node scripts/check-source-registry-authority.mjs
 * (also run by `npm run check:boundaries`)
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTHORITY = 'src/data/sourceRegistry.js';
const PROVENANCE = 'src/data/provenance.js';

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

/** Every src/server module file (js/mjs/cjs), excluding tests, stable order. */
function allRuntimeFiles(out = []) {
  for (const root of ['src', 'server']) {
    const walk = (dir) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        const rel = path.relative(ROOT, abs).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (
            entry.name === 'local_data' ||
            entry.name === 'node_modules' ||
            rel === 'src/testSupport' ||
            rel === 'src/tooling'
          )
            continue;
          walk(abs);
        } else if (
          /\.(js|mjs|cjs)$/.test(entry.name) &&
          !/\.test\.[mc]?js$/.test(entry.name) &&
          rel !== 'src/overlays/worldOverlayAllocation.worker.mjs'
        ) {
          out.push(rel);
        }
      }
    };
    walk(path.join(ROOT, root));
  }
  return out.sort();
}

// --- 1. Authority purity ---------------------------------------------------

check(
  AUTHORITY,
  (c) => !c.match(/^import /m) && !c.includes('import('),
  'must have zero imports (leaf authority — feed state, lifecycle, provenance, Cesium and DOM must all stay unreachable)',
);
check(
  AUTHORITY,
  (c) =>
    !c.includes('Date.now') && !c.includes('new Date(') && !c.match(/\bDate\(/),
  'must not read the wall clock (descriptors are static identity, never runtime freshness)',
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
  (c) =>
    !c.includes('fetch(') &&
    !c.includes('XMLHttpRequest') &&
    !c.includes('WebSocket'),
  'must not use the network',
);
check(
  AUTHORITY,
  (c) => !c.includes('process.env') && !c.includes('import.meta.env'),
  'must not read the environment (source existence is credential-free)',
);
check(
  AUTHORITY,
  (c) => !c.includes('localStorage') && !c.includes('sessionStorage'),
  'must not touch browser storage',
);

// The lookup/registry surface, exported and only here.
for (const name of [
  'createSourceRegistry',
  'getSourceDescriptor',
  'isRegisteredSource',
  'listSourceDescriptors',
]) {
  check(
    AUTHORITY,
    (c) => c.includes(`export function ${name}`),
    `must export ${name}`,
  );
}

// Descriptor hygiene: freshness/runtime state, lifecycle state, store/layer
// identity and credential material may never be written as descriptor keys.
check(
  AUTHORITY,
  (c) =>
    !c.match(
      /\b(ageMs|age|stale|fresh|freshness|status|enabled|disabled|eligible|visible|active|loaded|lastFetch|lastAttempt|lastUpdate|lastSuccess|latency|retry|retries|unavailable|degraded|coverage|apiKey|token|secret|credential|credentials|storeId|layerId|epistemic|via|reportedAtMs|receivedAtMs|observationId|confidence|quality|history|providerLabel)\s*:/,
    ),
  'must not write freshness/lifecycle/credential/store state as descriptor keys',
);

// --- 2. SourceId grammar mirrors the provenance grammar ---------------------

const SOURCE_ID_GRAMMAR = '/^[a-z0-9._:-]+$/';
check(
  AUTHORITY,
  (c) => c.includes(SOURCE_ID_GRAMMAR),
  `registry key grammar must be the provenance sourceId grammar (${SOURCE_ID_GRAMMAR})`,
);
check(
  PROVENANCE,
  (c) => c.includes(SOURCE_ID_GRAMMAR),
  `provenance sourceId grammar must be ${SOURCE_ID_GRAMMAR} (registry mirrors it)`,
);

// --- 3. Single construction path, whole src/ + server/ ----------------------

for (const rel of allRuntimeFiles()) {
  if (rel === AUTHORITY) continue;
  let content;
  try {
    content = read(rel);
  } catch {
    continue;
  }
  if (content.includes('createSourceRegistry')) {
    problems.push(
      `${rel}: createSourceRegistry lives only in ${AUTHORITY} (no competing source registries)`,
    );
  }
  if (
    content.match(
      /(?:export\s+)?(?:function|const|let|var|class)\s+(?:getSourceDescriptor|isRegisteredSource|listSourceDescriptors|SOURCE_REGISTRY|SourceRegistry)\b/,
    )
  ) {
    problems.push(
      `${rel}: must not define its own source-registry surface (single authority: ${AUTHORITY})`,
    );
  }
}

// --- 4. Provenance never depends on registry membership --------------------

check(
  PROVENANCE,
  (c) =>
    !c.includes('sourceRegistry') &&
    !c.includes('createSourceRegistry') &&
    !c.includes('getSourceDescriptor') &&
    !c.includes('isRegisteredSource') &&
    !c.includes('listSourceDescriptors'),
  'provenance must stay independent of registry membership (unknown sourceIds remain representable)',
);

if (problems.length) {
  console.error('SOURCE REGISTRY AUTHORITY: FAILED\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}

console.log(
  'SOURCE REGISTRY AUTHORITY: OK — I4a boundaries frozen (authority zero-dep: no clock/Cesium/DOM/network/env, static descriptor keys only, single construction path, provenance membership-free, sourceId grammar mirrored).',
);
