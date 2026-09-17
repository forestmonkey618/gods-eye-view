#!/usr/bin/env node
/**
 * Spatial-authority freeze check.
 *
 * `src/data/geo.js` is the canonical authority for geographic distance. This
 * check does not demand that every historical site migrate today — that would
 * be a repo-wide refactor, and some of the remaining sites answer genuinely
 * different questions (a ring's AREA, an angular ordering key, a
 * camera-relative separation). What it does instead is FREEZE the current set:
 * every raw geographic-distance implementation that is still out there is
 * written down below with a reason, and the count must match exactly.
 *
 * The practical consequences:
 *
 *  - A NEW raw haversine, or a NEW earth-radius literal, fails the build —
 *    `src/data/geo.js` is there to be imported.
 *  - Removing one of the old implementations ALSO fails the build, until the
 *    allowlist entry is deleted. The allowlist can only shrink, and only
 *    deliberately, so it can never quietly become a list of everything.
 *  - Renaming or moving a file with a frozen site fails, so the entry gets
 *    re-examined rather than silently re-homed.
 *
 * Two detectors, both deliberately narrow (a false positive here is a build
 * break, so the patterns match only distance-shaped code):
 *
 *  - `raw-haversine`: `Math.asin(Math.sqrt(` / `Math.atan2(Math.sqrt(`. Both are
 *    the spherical-law-of-cosines/haversine idiom. A bare
 *    `Math.asin(Math.min(1, someRatio))` — an elevation or horizon ANGLE — does
 *    not match, and neither does any other trig.
 *  - `earth-radius-literal`: a numeric literal within 7 of 6371 (kilometres) or
 *    7 km of 6371008.8 (metres), which covers 6371, 6371000, 6371008.8,
 *    6378137 and the other ellipsoid radii, while leaving unrelated numbers
 *    like a 6400 ms timeout or a port number alone.
 *
 * Usage: `node scripts/check-spatial-authority.mjs` (also run by
 * `npm run check:boundaries`).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

/** The authority itself, and the data packs, are not subjects of the freeze. */
const AUTHORITY_FILE = 'src/data/geo.js';
const IGNORED_DIRS = new Set(['local_data', 'node_modules']);

/**
 * Frozen sites: `{ file, kind, count, reason, values? }`.
 *
 * `kind` is `raw-haversine` or `earth-radius-literal`. Update this list in the
 * SAME change that removes a site — and never to make room for a new one.
 *
 * `values` applies to `earth-radius-literal` entries: every earth-radius
 * number in that file must be within 7 of one of them. That is what stops a
 * frozen duplicate from quietly drifting off the canonical radius — it may
 * stay duplicated, but it may not disagree.
 */
const ALLOWLIST = [
  {
    file: 'src/annotations/drawMode.js',
    kind: 'raw-haversine',
    count: 1,
    reason:
      'Drawing geometry: measures vertex spacing and segment length while a shape is being drawn. ' +
      'Kept by the spatial audit (audit §C) rather than migrated.',
  },
  {
    file: 'src/annotations/drawMode.js',
    kind: 'earth-radius-literal',
    count: 1,
    values: [6371000],
    reason: 'Same drawing-geometry helper as above.',
  },
  {
    file: 'src/data/naturalEarthRegions.js',
    kind: 'earth-radius-literal',
    count: 1,
    values: [6371],
    reason:
      'ringAreaKm2 measures a ring AREA, not a distance; the pack\'s published areaKm2 metadata is ' +
      'generated with this radius. Area is out of scope for this distance freeze.',
  },
  {
    file: 'src/layers/alpr/policy.js',
    kind: 'earth-radius-literal',
    count: 1,
    values: [6371008.8],
    reason:
      'Already the canonical value, duplicated as a policy constant. Owned by the ALPR increment (D5); ' +
      'the value assertion keeps it from drifting.',
  },
  {
    file: 'src/layers/installations/model.js',
    kind: 'raw-haversine',
    count: 1,
    reason:
      'Documented allocation-free conservative rejection pre-filter that runs before the exact ' +
      'ellipsoidal geodesic, using the canonical radius constant. Proximity migration is scheduled at I8.',
  },
  {
    file: 'src/layers/installations/policy.js',
    kind: 'earth-radius-literal',
    count: 1,
    values: [6371008.8],
    reason: 'Canonical value duplicated as a policy constant; installations proximity work is I8.',
  },
  {
    file: 'src/layers/radio/queries.js',
    kind: 'raw-haversine',
    count: 1,
    reason:
      'Returns an ANGULAR separation in radians, used only as a sort key for ranking radio stations. ' +
      'It is an ordering key, not a metric distance reported to anyone.',
  },
];

// ── detectors ───────────────────────────────────────────────────────────────

// `Math.asin(Math.sqrt(` and the far more common wrapped form
// `Math.asin(Math.min(1, Math.sqrt(...)))`, but NOT `Math.asin(Math.min(1, ratio))`
// (an angle).
const RAW_HAVERSINE = /Math\.(?:asin|atan2)\([^;]{0,80}?Math\.sqrt\(/g;

const isEarthRadius = (value) =>
  Math.abs(value - 6371) < 7 || Math.abs(value - 6371008.8) < 7000;

const NUMBER = /(?<![\w.])(\d{4,7}(?:\.\d+)?)(?![\w.])/g;

function scan(text) {
  const findings = { 'raw-haversine': 0, 'earth-radius-literal': 0 };
  const radiusValues = [];
  findings['raw-haversine'] = (text.match(RAW_HAVERSINE) || []).length;
  for (const match of text.matchAll(NUMBER)) {
    const value = Number(match[1]);
    if (isEarthRadius(value)) {
      findings['earth-radius-literal'] += 1;
      radiusValues.push(value);
    }
  }
  return { findings, radiusValues };
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(?:mjs|js)$/.test(entry)) yield full;
  }
}

// ── run ─────────────────────────────────────────────────────────────────────

const actual = new Map();
for (const file of walk(SRC)) {
  const relative = path.relative(ROOT, file).split(path.sep).join('/');
  if (relative === AUTHORITY_FILE) continue;
  if (relative.endsWith('.test.mjs')) continue;
  const { findings, radiusValues } = scan(readFileSync(file, 'utf8'));
  const total = findings['raw-haversine'] + findings['earth-radius-literal'];
  if (total > 0) actual.set(relative, { findings, radiusValues });
}

const problems = [];
const allowed = new Map(
  ALLOWLIST.map((entry) => [`${entry.file}\u0000${entry.kind}`, entry]),
);
const seen = new Set();

for (const [file, { findings, radiusValues }] of [...actual.entries()].sort()) {
  for (const [kind, count] of Object.entries(findings)) {
    if (count === 0) continue;
    const key = `${file}\u0000${kind}`;
    seen.add(key);
    const entry = allowed.get(key);
    if (!entry) {
      problems.push(
        `${file}: ${count} new ${kind} site(s) — import src/data/geo.js instead ` +
          '(distanceM / surfaceM / slantM), or add a reasoned allowlist entry ' +
          'in scripts/check-spatial-authority.mjs if this is not a geographic distance.',
      );
    } else if (entry.count !== count) {
      problems.push(
        `${file}: ${kind} count is ${count}, allowlist says ${entry.count} — ` +
          (count < entry.count
            ? 'the site was migrated or removed, so lower the allowlist entry.'
            : 'a NEW raw implementation was added; use src/data/geo.js instead.'),
      );
    }
    if (kind === 'earth-radius-literal' && entry?.values) {
      for (const value of radiusValues) {
        const known = entry.values.some((allowed) => Math.abs(value - allowed) < 7);
        if (!known) {
          problems.push(
            `${file}: radius literal ${value} drifts from the frozen value(s) ` +
              `${entry.values.join(', ')} — align it with EARTH_RADIUS_M in src/data/geo.js ` +
              'or update this entry deliberately.',
          );
        }
      }
    }
  }
}

for (const entry of ALLOWLIST) {
  const key = `${entry.file}\u0000${entry.kind}`;
  if (!seen.has(key)) {
    problems.push(
      `${entry.file}: allowlist lists ${entry.count} ${entry.kind} site(s) that ` +
        'are no longer found (file moved, renamed, or migrated) — update or delete the entry.',
    );
  }
}

const frozen = [...actual.entries()].reduce(
  (sum, [, { findings }]) =>
    sum + findings['raw-haversine'] + findings['earth-radius-literal'],
  0,
);

if (problems.length) {
  console.error('SPATIAL AUTHORITY: FAILED\n');
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(
    `\n${frozen} frozen site(s) across ${actual.size} file(s); ${problems.length} problem(s).`,
  );
  process.exit(1);
}

console.log(
  `SPATIAL AUTHORITY: OK — ${frozen} frozen, reasoned site(s) across ` +
    `${actual.size} file(s); no new raw geographic-distance implementations.`,
);
for (const [file, { findings }] of [...actual.entries()].sort()) {
  const parts = Object.entries(findings)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind}×${count}`);
  console.log(`  · ${file} — ${parts.join(', ')}`);
}
