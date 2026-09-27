# Layer observation receipt — I5a status + I5b currency (current contract)

The analyst distinguishes **zero matching records in an observed layer** from
**zero records because the layer was not fully observed**. This is a layer/feed
status receipt, not a geographic coverage claim. It does not turn even a healthy
zero into an all-clear for a place. Since I5b the same receipt also carries
**observation currency ("as-of")**: when each queried layer's applied snapshot
was observed and received — never how old it is (no age or stale duration is
computed anywhere).

## Naming and ownership

`MASTER-PLAN.md` calls the **eventual spatial coverage map** `src/data/coverage.js`
and already names the analyst's existing `coverage` block for query scope and
loaded-data caveats. It does **not** establish `coverage.js` as the name of this
smaller non-spatial eligibility decision. I5a therefore uses
`src/data/observationStatus.js` and the additive result field
`observation.unobserved`. The existing `coverage` block, including
`coverage.layersQueried`, `scope`, `followUp` and `note`, remains in place; only
its layer entries gain status fields. This reserves *coverage* for scope and
future real footprint/completeness work rather than implying that a nominal
feed sees every location.

`layerFeedState(stats)` in `src/data/feedState.js` remains the sole normalizer of
feed status. The new pure authority consumes its already-established status
string and lifecycle eligibility; it never calculates feed state, age or
freshness itself. It exports only:

- `assessLayerObservation({layerKey, enabled, feedState})` → frozen
  `{layerKey, enabled, feedState, reason}`. `reason` is `null` **only** when
  `enabled === true` and `feedState === 'nominal'`.
- `unobservedLayers(assessments)` → frozen, ordered array of frozen
  `{layerKey, reason}` entries for non-null reasons; `[]` for none.

| Input | Reason |
|---|---|
| `enabled === false` (overrides *any* feed state) | `layer-disabled` |
| enabled + `nominal` | `null` |
| enabled + `loading`, `unavailable`, `stale`, `degraded`, `partial`, `fallback` | `feed-loading`, `feed-unavailable`, `feed-stale`, `feed-degraded`, `feed-partial`, `feed-fallback` respectively |
| missing/unrecognized feed state or non-boolean enabled | `feed-state-unknown` |

Unknown input never defaults to nominal. When the optional analyst provider is
missing, `enabled` and `feedState` in `layersQueried` are `null` and the reason
is `feed-state-unknown`.

## Analyst/voice result

For each layer in a successful analyst query, `coverage.layersQueried[]` now
contains `{layerKey, records, enabled, feedState}`. The result also contains
`observation: {unobserved: [{layerKey, reason}, ...]}`. For example:

```json
{
  "count": 0,
  "coverage": {
    "layersQueried": [{"layerKey": "military", "records": 0, "enabled": false, "feedState": "nominal"}],
    "scope": "anywhere",
    "followUp": false,
    "note": "client-side data only — answers cover what the enabled layers currently hold"
  },
  "observation": {
    "unobserved": [{"layerKey": "military", "reason": "layer-disabled"}],
    "asOf": [
      {"layerKey": "military", "observedAtMs": null, "receivedAtMs": null}
    ]
  }
}
```

An enabled, nominal layer with zero matches still returns `count: 0`, but
`observation.unobserved` is empty. An enabled layer in a non-nominal state
**retains any available records and the existing count** while carrying its
limitation. `count`, `items`, `summary`, spatial scope and existing failure
handling otherwise retain their established semantics.

The optional `getLayerObservation(layerKey)` provider gives the analyst
already-known status. Voice uses `dataManager.isEnabled(layerKey)` for settled
eligibility and the manager's `getAll().stats` passed through
`layerFeedState()`. `getAll()` includes lifecycle loading and
`managerRefreshError` alongside the layer's `getStats()`; consulting only raw
module stats could hide a manager-owned refresh failure. When stats are absent,
the provider returns no feed state, not an invented nominal state. A rendered
collection's `show`/visibility is **not** an input: enabled but invisible
layers remain eligible for observation.

Records, their status, and the I5b clocks are read synchronously together
**before** any async scope resolution. Follow-ups reuse the original frozen
layer entries, observation limitations and `asOf` clocks; they never re-read
the feed or lifecycle. The voice payload forwards `observation` both for
ordinary analyst results and the Contacts-window read-back. A Contacts follow-up
does not substitute a newer panel window for the earlier query snapshot. The
pre-existing voice warm-up and viewport wording are unchanged; they are not
feed-state authorities.

## I5b — observation currency ("as-of")

`observation.asOf` is an array with **exactly one entry per queried layer, in
query order**: `{layerKey, observedAtMs, receivedAtMs}`. Both clocks are
nullable and both may be null; a layer is never omitted because its clocks are
unknown, and the entry is present even when the layer is unobserved (currency
and eligibility answer different questions). There is no query-level `asOf` and
no single timestamp for multi-layer results. Entries, the array and the
`observation` object are frozen.

- `observedAtMs` — the source/adapter-established snapshot observation or
  currency time of the applied data (e.g. OpenSky `payload.time`). It is **not**
  `Date.now()`, not the receipt, not the polling time, and not a newest-record
  timestamp unless the ingestion contract explicitly establishes that (AIS
  `newestPositionAt` is the sanctioned case: `vesselSnapshot.observedAtMs`).
- `receivedAtMs` — when GEV received/ingested that batch, when the ingestion
  path explicitly knows it. It never substitutes for `observedAtMs` and is
  never reconstructed later.

**Grain (vs I3).** I3 owns per-value `reportedAtMs`/`receivedAtMs` provenance.
I5b owns only layer/snapshot-level clocks. Per-record facts (FIRMS `acqTime`,
USGS event `time`, per-fix position/contact times) stay at record grain and are
never scanned, averaged, or extremized to manufacture a snapshot clock.

**`lastUpdate` is not an I5b input.** Its meaning is inconsistent across layers
(source snapshot on flights/military; mixed legacy fallback on AIS; GEV fetch on
earthquakes; upstream fetch stamp on FIRMS; evaluation time elsewhere). It is
left exactly as each layer defined it, and `observedAtMs`/`receivedAtMs` are
retained **beside** it at ingest — never derived from it. Tests pin that
`lastUpdate` values do not propagate into `asOf`.

**Per-layer clock audit (exposed only when truthful):**

| Layer | `observedAtMs` | `receivedAtMs` |
|---|---|---|
| flights | OpenSky snapshot time (`payload.time`) as the adapter established it; null when the source gives no time | client batch receipt (`receiptMs`, explicitly known) |
| military | adsb.lol/cache snapshot observation time (`readsbSnapshot`, cache-age-adjusted on HIT; equals the receipt on MISS by the established ingestion convention) | client batch receipt |
| ais-live-vessels | source `vesselSnapshot.observedAtMs` (`newestPositionAt` — the established ingestion contract); null otherwise | client batch receipt (`receiptMs`); null on the legacy rows path |
| local-firms | **always null** — no layer-level source observation clock exists (per-record acquisition times stay per-record) | the FIRMS proxy's `fetchedAt` fetch stamp for the applied batch (GEV ingest, explicitly carried in the transport); null when absent |
| earthquakes | **always null** — USGS event times stay per-event (I3) | **always null** — the fetch-completion stamp in `lastUpdate` is not a preserved receipt clock |

A missing clock stays `null` forever: the other clock is never substituted, and
nothing is back-filled later. Deterministic normalization lives in the pure
`assessLayerAsOf({layerKey, observedAtMs, receivedAtMs})` authority in
`src/data/observationStatus.js` (finite values preserved exactly; missing/
non-finite/non-numeric → null; no clock, no age, no comparison).

## Limits and boundary decision

I5a/I5b do **not** model geographic footprint, sensor range, AOI intersections,
age or stale duration, history, or source attribution. Enabled and
nominal qualifies only the *layer-level zero over its currently loaded data*;
it does not establish spatial completeness. As-of times are currency facts
alone: nothing here computes how old a snapshot is or whether it is stale by
time — those remain the existing feed-state/`lastUpdate`/panel concerns.

No seventh boundary script is added. `observationStatus.js` is a zero-import,
clock-free leaf; focused unit tests check purity, immutability, the exact reason
mapping, the conservative unknown case, and (I5b) `assessLayerAsOf`'s exact
normalization — including behavior under a poisoned clock. Analyst tests pin
the engine's snapshot-boundary capture, frozen shape, per-layer query order,
and follow-up zero-re-read; voice tests pin that the provider reads only the
layers' own `observedAtMs`/`receivedAtMs` fields (poisoned `lastUpdate` values
must not appear) and that the Contacts read-back forwards the complete receipt.
Existing import-direction/package checks remain in force (the
`application-components` ownership list already includes the leaf; I5b adds no
new module and no new dependency edge). A dedicated guard would duplicate these
checks for the same two consumers I5a already protects. Revisit that decision
if broader spatial coverage or multiple production consumers create new
architectural invariants to enforce.

The historical [I4b design reduction](planning/I4b-DESIGN-REDUCTION.md) was
read from `dc01361` and copied here without merging its branch. Its proposed
`coverage.js` / `coverage.unobserved` names were narrowed as explained above;
its core observation-honesty finding and I4 deferral remain intact.
