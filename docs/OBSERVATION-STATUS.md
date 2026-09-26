# I5a — Layer observation status (current contract)

The analyst distinguishes **zero matching records in an observed layer** from
**zero records because the layer was not fully observed**. This is a layer/feed
status receipt, not a geographic coverage claim. It does not turn even a healthy
zero into an all-clear for a place.

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
  "observation": {"unobserved": [{"layerKey": "military", "reason": "layer-disabled"}]}
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

Records and their status are read synchronously together **before** any async
scope resolution. Follow-ups reuse the original frozen layer entries and
observation limitations; they never re-read the feed or lifecycle. The voice
payload forwards `observation` both for ordinary analyst results and the
Contacts-window read-back. A Contacts follow-up does not substitute a newer
panel window for the earlier query snapshot. The pre-existing voice warm-up and
viewport wording are unchanged; they are not feed-state authorities.

## Limits and boundary decision

I5a does **not** model geographic footprint, sensor range, AOI intersections,
as-of time, feed age/latency/cadence, history or source attribution. Enabled and
nominal qualifies only the *layer-level zero over its currently loaded data*;
it does not establish spatial completeness.

No seventh boundary script is added. `observationStatus.js` is a zero-import,
clock-free leaf; focused unit tests check purity, immutability, the exact reason
mapping and the conservative unknown case. Analyst and voice tests protect
snapshot hand-off, visibility separation, normalized feed wiring and the
alternative Contacts path; existing import-direction/package checks remain in
force (the `application-components` ownership list now includes the new leaf).
A dedicated guard would duplicate these checks for a single consumer.
Revisit that decision if broader spatial coverage or multiple production
consumers create new architectural invariants to enforce.

The historical [I4b design reduction](planning/I4b-DESIGN-REDUCTION.md) was
read from `dc01361` and copied here without merging its branch. Its proposed
`coverage.js` / `coverage.unobserved` names were narrowed as explained above;
its core observation-honesty finding and I4 deferral remain intact.
