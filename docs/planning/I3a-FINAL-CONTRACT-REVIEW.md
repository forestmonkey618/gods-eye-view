# I3a FINAL CONTRACT REVIEW — Provenance Primitive + Aircraft Position Provenance

**Date:** 2026-09-18
**Branch:** arena/01a0b2f3-gods-eye-view at 6c991ac
**Status:** I3a IMPLEMENTED, final review per owner request, no additional architecture changes, ready for owner approval unless bug found.

---

## 1. PROVENANCE SIDECAR KEYING

### Current implementation

`getProvenanceMap()` in `src/layers/flights/queries.js`:

```js
getProvenanceMap() {
  const provMap = flightState.records.positionProvenance;
  if (!provMap || provMap.size === 0) return new Map();
  const out = new Map();
  for (const [icao24, prov] of provMap) {
    if (!prov) continue;
    out.set(icao24, { ...prov });
  }
  return out;
}
```

Returns `Map<icao24/native tracking id, provenance>` including TIS-B `~...` native IDs.

### A. Is getProvenanceMap() intended as STORE-LOCAL or CANONICAL ENTITY accessor?

**STORE-LOCAL.** It mirrors `FlightRecords.data` which is keyed by native icao24 (lowercased hex, preserves ~ for TIS-B, same as `_billboards` key, `trackById` resolution, Context cohorts). Provenance is parallel to `data` Map, same keys. It is owned by flights store, not global. `getCurrentEntities()` is also store-owned (returns records owned by THIS store, not globally authoritative), with JSDoc explicitly stating store-owned. Sidecar follows same pattern.

### B. Why is native tracking ID correct public key instead of canonical entityKey for canonical aircraft?

- **Storage authority:** `FlightRecords.data: Map<icao24, meta>` keyed by native id. Provenance follows `rawLat/rawLon` stored under native id. Sidecar must use same key to allow direct join with store's own data without reconstruction.
- **Completeness:** Canonical `aircraft(icao24)` returns null for TIS-B `~abc123` and malformed per I2a strict 6-hex rule. If sidecar keyed by canonical entityKey, TIS-B and malformed would be excluded, but they still have positions that need provenance (store renders them). Excluding would be lossy.
- **No second identity system:** Using native id avoids inventing second identity system or filtering. Canonical consumers can derive entityKey via `aircraftEntityKey(icao24)` if needed, but primary key remains native.
- **Consistency with I2:** `getCurrentEntities()` returns both `entityKey` and `icao24` for same reason — native id preserved for compatibility, entityKey derived. RecordIndex then filters to canonical-only and indexes by entityKey. Provenance sidecar follows same two-level pattern.

### C. How would future canonical consumer holding entityKey join to this provenance map without parsing/reconstructing native identity?

Two truthful paths:

1. **Via getCurrentEntities():** Canonical consumer calls `getCurrentEntities()` which returns `Array<{entityKey, icao24, ...}>`. It has both keys. Use `icao24` to lookup provenance Map directly. This is robust, avoids manual parsing, and respects store-owned eligibility (adapter knows which store produced array).

2. **Via suffix derivation (for canonical aircraft):** Canonical format is known `aircraft:icao24:<6-hex lowercased>`. Native id = `entityKey.slice('aircraft:icao24:'.length)`. Since canonical keys are normalized lowercased, this matches Map key for canonical aircraft. Example: `aircraft:icao24:abc123` → `abc123` → `Map.get('abc123')`.

Both avoid inventing synthetic keys. For TIS-B, entityKey null, so canonical consumer would not find it in canonical projection — correct.

### D. Does native-keyed public provenance cause future I6/analyst code to depend on layer-native identity?

Analyst records already contain both `icao24` and `entityKey` (I2b). I6 can join via `icao24` without depending solely on native identity. If analyst only has entityKey, it can derive native id as above. So dependency exists but is unavoidable because FlightRecords storage is native-keyed. Future canonical provenance projection will hide native dependency by re-keying to entityKey and filtering to canonical only. Current store-local sidecar is complete; canonical projection will be adapter-level.

### E. Could accessor instead return canonical entityKey keys for canonical aircraft while omitting TIS-B from canonical sidecar?

Yes, but that would be a **canonical accessor**, not store-local. It would be lossy for store-local use: TIS-B positions would have no provenance in sidecar, even though store renders them and they have truthful sourceId. For I3a we want provenance for all current positions the store holds, including TIS-B, because position provenance is needed for every aircraft position rendered. Omitting TIS-B would be incomplete.

### F. Is correct architecture explicitly TWO levels: store-local provenance keyed by store-native record key and later canonical provenance projection/adapter?

**Yes.** Recommended:

- **Level 1 — Store-local:** `getProvenanceMap()` keyed by native icao24 including ~, complete, reflects actual storage, includes TIS-B, no synthetic keys. This is current implementation.
- **Level 2 — Canonical projection (future I3c+):** Adapter-level that:
  1. Takes store-local Map native→provenance
  2. Filters to canonical only via `aircraftEntityKey(icao24)` != null (or `isValidEntityKey`)
  3. Re-keys by canonical entityKey `aircraft:icao24:abc123` for canonical consumers, omitting TIS-B from canonical sidecar
  4. Optionally merges across eligible stores (flights+military) with explicit policy, known by adapter (eligibility owned by layer/adapter per I2c)

This mirrors I2: `getCurrentEntities()` store-owned with both keys, `buildRecordIndex` canonical projection that indexes only canonical entityKeys and knows which store produced array. Same boundary for provenance.

### Decision

**Keep current native-keyed implementation as STORE-LOCAL accessor, document boundary explicitly.** No code change for keying, only JSDoc expansion (done in 6c991ac). No synthetic entityKeys for TIS-B, no TIS-B canonical identity, no recordIndex modification. Future canonical projection will be adapter-level.

---

## 2. SOURCE FALLBACK TRUTHFULNESS

### Server route trace — every successful response path reaching createOpenSkySource

File `server/providers/aircraft/opensky.js`:

- `serveAdsbLolPointFallback(req,res,requestedMode,reason)`:
  ```js
  res.writeHead(200, {
    ...buildOpenSkyHeaders({...}),
    'X-Flight-Source': 'adsb.lol',
    'X-Flight-Coverage': `${ADSBLOL_POINT_RADIUS_NM}nm regional fallback`,
    'X-Flight-Count': String(fallback.count),
  });
  ```
  Always sets header on success.

- `openSkyProxy()` middleware `/api/opensky`:

  1. **Fresh cache hit:** if `_openskyCacheBody && (now - cacheTime < ttl || inCooldown)`:
     - if `openSkySourceIsStale(cacheSourceEpochMs)` and fallback succeeds → returns fallback with X-Flight-Source
     - else serves cached OpenSky body with `buildOpenSkyHeaders` only (no X-Flight-Source)

  2. **Cooldown no cache:** if `inCooldown` and no cache, tries fallback → with X-Flight-Source, else 429

  3. **Normal upstream fetch:** fetch OpenSky. If ok and stale, tries fallback → with X-Flight-Source (caches OpenSky as fail-soft, not returned)

  4. **429 handling:** sets cooldown, serves stale cache if available (no X-Flight-Source)

  5. **!ok && !cache:** tries fallback → with X-Flight-Source

  6. **ok:** caches body, `res.writeHead(upstream.status, buildOpenSkyHeaders(...))` — no X-Flight-Source

  7. **catch:** if cache serves stale (no X-Flight-Source), else fallback with X-Flight-Source, else 502

**Successful responses:**
- Primary OpenSky success: 200, no X-Flight-Source, only X-OpenSky-* headers
- Fallback adsb.lol success: 200, X-Flight-Source: adsb.lol, plus X-Flight-Coverage, X-Flight-Count, X-OpenSky-* with usedMode=adsblol-regional

### A. Can successful adsb.lol fallback response ever omit X-Flight-Source?

**No.** Every successful fallback goes through `serveAdsbLolPointFallback` which explicitly sets header in writeHead. No other fallback path.

### B. Can another provider currently flow through this route without X-Flight-Source?

**No.** Only OpenSky and adsb.lol fallback coded. No other provider.

### C. Does absence of X-Flight-Source logically prove OpenSky because primary route is OpenSky and every fallback path explicitly sets header?

**Yes.** Proven by route structure, not guess. Primary cached and fresh paths use `buildOpenSkyHeaders` only, no X-Flight-Source. Every fallback path via `serveAdsbLolPointFallback` sets header. Therefore absence proves primary OpenSky. This is permitted: "missing header defaults to OpenSky because route structure proves it" not guessed.

Invariant documented in `standalone.js` 6c991ac:

```js
// I3a: stable machine sourceId — truthful mapping per server route invariant:
// server/providers/aircraft/opensky.js: openSkyProxy primary path does NOT set X-Flight-Source (only X-OpenSky-*),
// every successful fallback path via serveAdsbLolPointFallback explicitly sets X-Flight-Source: adsb.lol.
// Therefore absence of header logically proves OpenSky (route structure, not guess). No other provider flows through this route.
```

### D. What happens if header contains unexpected future value?

Previous implementation mapped any header containing 'adsb' → adsb.lol else opensky, so unexpected `future.provider` would incorrectly fabricate opensky.

**Smallest correction made in 6c991ac:** Now:

```js
const rawHeader = flightSourceHeader ? String(flightSourceHeader).trim() : '';
let sourceId;
if (!rawHeader) sourceId = 'opensky'; // proven invariant
else if (rawHeader.toLowerCase().includes('adsb')) sourceId = 'adsb.lol';
else sourceId = rawHeader.toLowerCase(); // future provider — truthful, not fabricated
```

Uses header value truthfully as sourceId lowercased if valid, does not fabricate opensky. Test added for future provider.

---

## 3. ENTITY IDENTITY CHANGE CONTRADICTION

### Git history

```
0aed7d0 I2d + I3a: restore I2d vessel identity + fix recordIndex isValid import after rebase
e923b46 I3a: minimal provenance primitive + truthful aircraft POSITION provenance + sidecar accessor + focused tests + surgical doc corrections
eee94ab I2c FINAL REVIEW: minimize API, clarify eligibility, flights+military disabled lifecycle, storeId semantics, malformed trust
```

Remote at time of push had eee94ab (I2c only, aircraft only, no vessel, no isValid). Local bb3531f had I2d (vessel+isValid). After rebase confusion, e923b46 was created from main base but included recordIndex with vessel (isValid import) but entityKey without isValid → broken. 0aed7d0 restored I2d.

### A. Was src/data/entityKey.js modified in this I3a work?

- **e923b46 (I3a only):** No. Diff eee94ab..e923b46 --stat shows 12 files, does NOT include entityKey.js. EntityKey remained I2c (aircraft only).
- **0aed7d0 (I2d restore):** Yes, but this is rebased previously approved I2d work (vessel+isValid) that was present in bb3531f but missing in remote eee94ab. Not counted as I3a modification.

### B. Was src/data/recordIndex.js modified beyond documentation/comments?

- **e923b46:** Yes, but includes both I2d vessel expansion (VALID_STORE_IDS flights/military/vessels, import isValid, generic copy) and I3a surgical comment correction distinguishing storeId vs sourceId and fallback vs merge. The production semantics (bounded storeIds, copy safety, validation delegated, no provenance logic) remain I2, not changed by I3a beyond comment. The vessel expansion is I2d, not I3a.
- **0aed7d0:** No additional change beyond restoring consistency.

### C. Were any I2 production semantics changed by I3a?

No. I3a commit e923b46 did NOT change entityKey semantics, recordIndex indexing logic (still canonical-only, rebuild removes missing, no winner, deterministic, copy-safe primitive-only, eligibility owned by adapter), getCurrentEntities shape, or bounded storeIds beyond I2d vessel which was already approved. I3a only added provenance sidecar and sourceId/receivedAtMs propagation, kept getCurrentEntities byte/shape compatible.

### D. Were any I2 tests modified?

- **e923b46:** No I2 tests modified. Only added new provenance tests.
- **0aed7d0:** Restored I2d tests (entityKey.test.mjs 22, recordIndex.vessels 14, vessels/getCurrentEntities 13) that were previously approved but missing after rebase. Not counted as I3a modification.

### E. Why did progress log mention "Fixing the identity authority to support the full I2 substrate"?

That log was from commit 0aed7d0 message: "I2d + I3a: restore I2d vessel identity + fix recordIndex isValid import after rebase". It refers to restoring I2d vessel identity after rebase where remote had I2c only and local I3a commit had broken import (recordIndex expected isValid but entityKey lacked it). So we fixed identity authority to support full I2 substrate (aircraft+vessels) that was already approved in previous session but lost during rebase. Not an I3a entity identity change.

**Conclusion:** Final report "no entity identity change" refers to I3a slice (e923b46) which did not modify entityKey.js. The later commit 0aed7d0 restored previously approved I2d changes from bb3531f. After separating, I3a introduced zero entity identity changes.

---

## 4. RECEIPT-TIME DETAIL

### Production path

`src/sources/live/standalone.js`:

```js
const receiptMs = now(); // single now() per getSnapshot batch
return {
  ...openSkySnapshot(payload, {
    source: sourceLabel,
    sourceId,
    coverage: header(...),
    now: receiptMs,
    receivedAtMs: receiptMs,
  }),
  status: response.status,
};
```

`createAdsbLolSource.getSnapshot` similar: `receiptMs = now()`, `observedAtMs = receiptMs - age`, `now: receiptMs, receivedAtMs: receiptMs`.

`src/sources/live/aircraft.js`:

```js
export function openSkySnapshot(payload, { source, sourceId, coverage, now=Date.now(), receivedAtMs=null, stale=false } = {}) {
  const resolvedReceivedAtMs = Number.isFinite(receivedAtMs) && receivedAtMs > 0 ? receivedAtMs : now;
  return { ...admitted, source, sourceId, coverage, observedAtMs, receivedAtMs: resolvedReceivedAtMs, ageMs, ... };
}
```

### Are there any production callers that omit receivedAtMs and cause helper to call now?

Search:

```
src/sources/live/standalone.js — both callers pass receivedAtMs explicitly (receiptMs)
src/sources/live/contract.test.mjs — tests omit receivedAtMs (not production)
```

**No production caller omits.** Normal production network snapshots use ONE receipt timestamp for whole batch: `receiptMs = now()` captured once per `getSnapshot`, shared across all records in that snapshot, passed to `openSkySnapshot` as both `now` and `receivedAtMs`. This is more truthful than per-aircraft `Date.now()` inside `FlightRecords.receive()` loop (previously observedReceiptMs per aircraft).

### Compatibility fallback

Helper has fallback `resolvedReceivedAtMs = receivedAtMs ?? now` intentionally for compatibility: if legacy caller omits `receivedAtMs`, it uses `now` (Date.now() at snapshot creation) rather than failing. This allows old tests and potential future callers that don't supply receipt time to still get a receipt time, without inventing per-aircraft times. Production path does NOT rely on fallback; it supplies explicit receiptMs.

---

## 5. FINAL TEST COUNT — Reconciled

### Provenance primitive + position + header — I3a new

- `src/data/provenance.test.mjs`: **11 tests** (valid REPORTED, requires sourceId/receivedAtMs, reportedAtMs optional null, unsupported epistemic, sourceId regex, no implicit age/fresh/confidence/history, mutation safe, no registry, EPISTEMIC frozen 4, isValidProvenance)
- `src/layers/flights/provenance.test.mjs`: **16 tests** (valid position REPORTED, sourceId reflects actual source, reportedAtMs=positionTimeMs, receivedAtMs=snapshot receipt, rawLat/rawLon+provenance together, newer without position does NOT overwrite, newer valid replaces, source switch with replacement updates sourceId, without replacement does NOT relabel, current-state only no history, copy-safe frozen, canonical key Map native id, TIS-B entityKey null but provenance keyed by native id, getCurrentEntities compatible, recordIndex unchanged, forget deletes)
- `src/sources/live/standalone.provenance.test.mjs`: **8 tests** (openSkySnapshot explicit sourceId, derived from label, primary no header → opensky, fallback adsb.lol → adsb.lol, missing/invalid defaults opensky, unexpected future header uses header truthfully, adsb.lol source always adsb.lol, one receipt per batch)

**Total I3a new = 11+16+8 = 35**

### I2 identity + record-index — previously approved, still passing

- `src/data/entityKey.test.mjs`: **22 tests** (vessel canonical 9-digit, whitespace normalization, exactly 9 digits, letters rejected, short/long, missing/empty, leading-zero preserved, no padding, aircraft unchanged, isValid aircraft, isValid vessel, rejects uppercase, rejects malformed vessel, rejects unsupported domains, plus 8 aircraft original)
- `src/data/recordIndex.test.mjs`: **24 tests** (one entity, same key two stores, different payloads, order not winner, null excluded, TIS-B outside, malformed safe including banana, different keys, rebuild removes, etc., no history, copy safety, no Cesium, no DOM, etc., eligibility, storeId semantics)
- `src/data/recordIndex.vessels.test.mjs`: **14 tests** (aircraft+vessel coexist, no domain-specific grammar, validation delegated, vessel single-store, malformed excluded, deterministic ordering, etc.)
- `src/data/currentEntities.test.mjs`: **12 tests** (uncapped, every stored, canonical key, same ICAO24 same entityKey store-owned not global dedup, TIS-B null key, malformed no invented, coordinates from rawLat/rawLon, copy-safe, repeat no side effects, no history, caps intact, lookup intact)

**Total I2 core = 22+24+14+12 = 72** (as previously reported "72 I2 tests")

- `src/layers/vessels/getCurrentEntities.test.mjs`: **13 tests** (uncapped, every vessel, valid MMSI, malformed no invented, coordinates from record model not Cesium, plain, mutation safe, repeat no side effects, no history, queries contains getCurrentEntities, analyst caps unchanged, etc.)
- `src/layers/vessels/records.test.mjs`: **4 tests** (reconciliation preserves identity, selected pinned, partial retention, unkeyed rebuild)
- `src/layers/flights/records.test.mjs`: **3 tests** (aviation units separate, owners isolate, ground transitions)

**Total I2 total with vessels = 22+13+14+24+12+4 = 89** (as previously reported "89 I2 total with vessels") — excludes flights/records 3

**Full suite including provenance + I2 + records:**

Command:
```
node --test src/data/provenance.test.mjs src/layers/flights/provenance.test.mjs src/sources/live/standalone.provenance.test.mjs src/data/entityKey.test.mjs src/data/recordIndex.test.mjs src/data/recordIndex.vessels.test.mjs src/data/currentEntities.test.mjs src/layers/flights/records.test.mjs src/layers/vessels/records.test.mjs src/layers/vessels/getCurrentEntities.test.mjs
```

Result: **127 tests pass, 0 fail** (35 provenance + 92 I2+records). Breakdown: 35 I3a + 22 entityKey + 24 recordIndex + 14 recordIndex.vessels + 12 currentEntities + 13 vessels/getCurrentEntities + 3 flights/records + 4 vessels/records = 127.

---

## 6. DELIVERABLE — Final Review Summary

1. **Sidecar keying decision:** Keep STORE-LOCAL `Map<icao24, provenance>` including TIS-B `~`, no synthetic keys. Documented explicitly as store-local, not canonical.

2. **Code changed for keying:** No. Only JSDoc expansion in 6c991ac to explain store-local vs canonical two-level architecture.

3. **TIS-B treatment:** Included in store-local sidecar keyed by native id `~abc123`, entityKey null, no invented identity, no canonical `aircraft:icao24:~...`, no `aircraft:tisb:` namespace. Future canonical projection will omit TIS-B from canonical sidecar.

4. **Future canonical-consumer join path:** Via `getCurrentEntities()` which returns both entityKey and icao24 → use icao24 to lookup Map, or derive native id via `entityKey.slice('aircraft:icao24:'.length)` for canonical aircraft. Future adapter will filter canonical only and re-key by entityKey.

5. **Proof missing-header => OpenSky invariant:** Server `openSkyProxy` primary path (fresh MISS and cached HIT/STALE) uses `buildOpenSkyHeaders` only, no X-Flight-Source. Every successful fallback via `serveAdsbLolPointFallback` explicitly sets `X-Flight-Source: adsb.lol`. No other provider flows through route. Therefore absence proves OpenSky — route structure, not guess. Documented in standalone.js.

6. **Unexpected-header behavior:** Previously fabricated opensky. Corrected in 6c991ac to use header value lowercased truthfully as sourceId, preserving truthfulness for future providers. Test added.

7. **Exact entityKey.js diff status:** I3a commit e923b46 did NOT modify entityKey.js (remained I2c aircraft only). Final HEAD 0aed7d0 includes I2d vessel+isValid which was previously approved in bb3531f but missing in remote eee94ab, restored as rebase fix. Not counted as I3a modification. Evidence: `git diff eee94ab..e923b46 --stat` does NOT list entityKey.js; `git diff e923b46..0aed7d0 --stat` lists entityKey.js as I2d restore.

8. **Exact recordIndex.js production-semantic diff status:** e923b46 modified recordIndex.js to include vessel VALID_STORE_IDS and isValid import (I2d) plus surgical comment correction for storeId vs sourceId and fallback vs merge (I3a). Production indexing semantics (canonical-only, rebuild removes, no winner, deterministic, copy-safe primitive-only, eligibility owned by adapter) unchanged beyond I2d vessel expansion which was already approved. No provenance logic added. Final HEAD 0aed7d0 has same.

9. **Explanation of "fixing identity authority" progress message:** From commit 0aed7d0 "I2d + I3a: restore I2d vessel identity + fix recordIndex isValid import after rebase". After rebase, remote had I2c (no isValid) but e923b46 recordIndex imported isValid → broken. Restored entityKey with isValid and vessel to support full I2 substrate. Not I3a identity change.

10. **Production receipt-time path:** `createOpenSkySource.getSnapshot` captures `receiptMs = now()` once per batch, passes to `openSkySnapshot` as both `now` and `receivedAtMs`. One receipt per snapshot feeding many records, truthful.

11. **Compatibility receipt-time fallback behavior:** `openSkySnapshot` has `resolvedReceivedAtMs = finite(receivedAtMs) ? receivedAtMs : now`. If caller omits, uses now at snapshot creation. Intentional compatibility for tests/legacy, not used in production which supplies explicit receiptMs.

12. **Reconciled test totals:** See Section 5. I3a new 35, I2 core 72, I2 total with vessels 89, full including records 127, all passing.

13. **Exact files changed by I3a after separating rebased I2 changes (eee94ab..e923b46):**
    - docs/planning/I2-PRE-IMPLEMENTATION-REPORT.md (surgical correction)
    - docs/planning/I3-DESIGN-REDUCTION-ADDENDUM.md NEW
    - src/data/provenance.js NEW
    - src/data/provenance.test.mjs NEW
    - src/data/recordIndex.js (comment correction + I2d vessel expansion that was already approved but included in this diff due to base being main)
    - src/layers/flights/provenance.test.mjs NEW
    - src/layers/flights/queries.js (getProvenanceMap)
    - src/layers/flights/records.js (positionProvenance)
    - src/layers/flights/snapshotRenderer.js
    - src/sources/live/aircraft.js
    - src/sources/live/standalone.js
    - src/sources/live/standalone.provenance.test.mjs NEW
    12 files, 2264 insertions, 61 deletions.

    I2d restore (e923b46..0aed7d0) 6 files: entityKey.js, entityKey.test.mjs, recordIndex.vessels.test.mjs, vessels/getCurrentEntities.test.mjs, vessels/queries.js, check-identity-authority.mjs — previously approved, not I3a.

14. **Confirmation I2 remains closed:** Yes. Identity authority still strict 6-hex aircraft + 9-digit vessel, no TIS-B canonical, isValid narrow, recordIndex still canonical-only, no history, no provenance logic beyond isValid import, getCurrentEntities unchanged, architecture checks OK.

15. **Confirmation D9/I4/I5/I6/I9 untouched:** Yes. `grep Cartesian3.distance` still in flights/military/vessels getNearby (slant), no slantDistanceM, geo.js untouched, no I4 source registry, no I5 freshness, no I6 analyst engine change, no I9 transitions.

16. **Whether I3a ready for owner approval:** **Yes.** Minimal primitive + truthful CURRENT aircraft POSITION provenance + sidecar accessor + focused tests + surgical doc corrections, store-local keying deliberate with documented two-level future canonical projection, fallback truthfulness proven by server route structure, unexpected header handled truthfully, no entity identity change in I3a commit, receipt-time single per batch, 35 new tests + 89 I2 tests passing, architecture checks OK. Ready.

---

**End of FINAL I3a CONTRACT REVIEW — store-local Map<icao24, provenance> including TIS-B, future canonical projection via adapter, missing X-Flight-Source proves OpenSky per route invariant, unexpected header truthful, no I2 identity change in I3a, receipt single per batch, 127 tests pass, I2 closed, D9/I4/I5/I6/I9 untouched.**
