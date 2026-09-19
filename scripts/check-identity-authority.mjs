#!/usr/bin/env node
/**
 * Identity / Record-Index authority freeze check — I2d.
 *
 * Freezes proven I2 boundaries before I3:
 * - recordIndex must not import Cesium, UI, lifecycle, analyst accessors
 * - recordIndex canonical validation comes from entityKey authority
 * - entityKey authority remains free of Cesium/DOM/network
 * - current entity accessors must not route through getAnalystRecords
 * - no obvious trajectory/history state in recordIndex
 *
 * Usage: node scripts/check-identity-authority.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

const problems = [];

function check(rel, predicate, message) {
  const content = read(rel);
  if (!predicate(content)) {
    problems.push(`${rel}: ${message}`);
  }
}

// recordIndex checks
check('src/data/recordIndex.js', (c) => !c.includes("from 'cesium'") && !c.includes('from "cesium"') && !c.includes('import * as Cesium'), 'must not import Cesium');
check('src/data/recordIndex.js', (c) => !c.match(/from\s+['\"]\.\.\/ui\//) && !c.match(/from\s+['\"]\.\.\/app\//), 'must not import UI/app');
check('src/data/recordIndex.js', (c) => !c.includes('getAnalystRecords') && !c.includes('getAllPositions'), 'must not import or call analyst-specific accessors');
check('src/data/recordIndex.js', (c) => !c.includes("from './lifecycle'") && !c.includes('from "./lifecycle"') && !c.includes("from '../data/lifecycle'"), 'must not import lifecycle');
check('src/data/recordIndex.js', (c) => c.includes("from './entityKey.js'") && c.includes('isValid'), 'canonical validation must come from entityKey authority (isValid)');
check('src/data/recordIndex.js', (c) => !c.match(/const\s+ICAO24_HEX/) && !c.match(/const\s+MMSI_9/), 'must not define its own ICAO/MMSI grammar');
check('src/data/recordIndex.js', (c) => {
  return !c.includes('this.history') && !c.includes('_history') && !c.includes('previousPosition');
}, 'must not contain obvious history state fields');

// entityKey checks
check('src/data/entityKey.js', (c) => !c.includes("from 'cesium'") && !c.includes('import * as Cesium'), 'entityKey must not import Cesium');
check('src/data/entityKey.js', (c) => !c.match(/\bdocument\./) && !c.match(/\bwindow\./), 'entityKey must not use DOM');
check('src/data/entityKey.js', (c) => !c.includes('fetch(') && !c.includes('XMLHttpRequest'), 'entityKey must not use network');
check('src/data/entityKey.js', (c) => c.includes('function aircraft') || c.includes('export function aircraft'), 'must export aircraft');
check('src/data/entityKey.js', (c) => c.includes('function vessel') || c.includes('export function vessel'), 'must export vessel after I2d');
check('src/data/entityKey.js', (c) => c.includes('function isValid') || c.includes('export function isValid'), 'must export isValid validator');
check('src/data/entityKey.js', (c) => !c.includes('DOMAIN') || !c.match(/export.*DOMAIN/), 'must not export oversized DOMAIN constant');
check('src/data/entityKey.js', (c) => !c.includes('parse') || !c.match(/export.*function.*parse/i), 'must not export parser');

// current entity accessors must not route through getAnalystRecords
for (const rel of ['src/layers/flights/queries.js', 'src/layers/military/queries.js', 'src/layers/vessels/queries.js']) {
  try {
    const content = read(rel);
    // getCurrentEntities should not call getAnalystRecords
    const hasAccessor = content.includes('getCurrentEntities');
    if (hasAccessor) {
      // Find getCurrentEntities function body and check it doesn't contain getAnalystRecords
      const idx = content.indexOf('getCurrentEntities');
      const snippet = content.slice(idx, idx + 2000);
      if (snippet.includes('getAnalystRecords')) {
        problems.push(`${rel}: getCurrentEntities must not route through getAnalystRecords`);
      }
    }
  } catch (e) {
    // file may not exist for military? but flights and vessels exist
    if (rel.includes('flights') || rel.includes('vessels')) {
      problems.push(`${rel}: could not read — ${e.message}`);
    }
  }
}

// Bounded store IDs check
check('src/data/recordIndex.js', (c) => c.includes("'flights'") && c.includes("'military'") && c.includes("'vessels'"), 'VALID_STORE_IDS must include flights, military, vessels');

if (problems.length) {
  console.error('IDENTITY AUTHORITY: FAILED\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}

console.log('IDENTITY AUTHORITY: OK — I2d boundaries frozen (recordIndex no Cesium/UI/lifecycle/analyst, validation delegated to entityKey, entityKey zero-dep, accessors not via analyst, no history).');
