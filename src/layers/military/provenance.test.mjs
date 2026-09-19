// I3c — military per-field provenance sidecar (MilitaryFlightRecords.provenance).
// Exercises the PRODUCTION store (and, where it matters, the production readsb
// normalizer) — nothing here re-implements the rules it asserts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MilitaryFlightRecords } from './records.js';
import { FlightRecords } from '../flights/records.js';
import { readsbSnapshot } from '../../sources/live/aircraft.js';
import { EPISTEMIC, isValidProvenance } from '../../data/provenance.js';

const RECEIPT_MS = 1_800_000_000_000;
const POSITION_MS = RECEIPT_MS - 2_000; // readsb seen_pos = 2 s
const CONTACT_MS = RECEIPT_MS - 1_000; // readsb seen = 1 s

/** A normalized adsb.lol/readsb observation as produced by normalizeReadsbAircraft. */
const observation = (fields = {}) => ({
  id: 'ae01ce',
  reference: 'ae01ce',
  longitude: -97,
  latitude: 31,
  callsign: 'RCH451',
  originCountry: null,
  positionTimeMs: POSITION_MS,
  contactTimeMs: CONTACT_MS,
  baroAltitudeM: 28000 * 0.3048,
  ellipsoidAltitudeM: 28500 * 0.3048,
  onGround: false,
  speedMps: 400 * 0.514444,
  courseDeg: 95,
  verticalRateMps: 0,
  category: 'A5',
  typeCode: 'C17',
  registration: '05-8152',
  operator: 'United States Air Force',
  ...fields,
});

const batch = (fields = {}) => ({
  observedAtMs: RECEIPT_MS,
  floorWarmPoints: [],
  modelOwnsVisual: false,
  sourceId: 'adsb.lol',
  receivedAtMs: RECEIPT_MS,
  ...fields,
});

const store = () =>
  new MilitaryFlightRecords({
    geoidHeight: () => 40,
    cachedGroundFloor: () => 200,
    floorAltitudeM: (height, floor) => Math.max(height, floor + 1.5),
  });

const reported = (reportedAtMs) => ({
  epistemic: EPISTEMIC.REPORTED,
  sourceId: 'adsb.lol',
  reportedAtMs,
  receivedAtMs: RECEIPT_MS,
  via: null,
});

test('military position is REPORTED by adsb.lol with the seen_pos-derived report time and the batch receipt', () => {
  const records = store();
  records.receive(observation(), batch());
  const prov = records.provenance.get('ae01ce');
  assert.deepEqual(prov.position, reported(POSITION_MS));
  assert.equal(Object.isFrozen(prov.position), true);
  for (const [field, descriptor] of Object.entries(prov))
    assert.equal(isValidProvenance(descriptor), true, field);
});

test('position-message fields carry seen_pos time, general-message fields carry seen time', () => {
  const records = store();
  records.receive(observation(), batch());
  const prov = records.provenance.get('ae01ce');
  for (const field of ['position', 'altitudeFt', 'geoAltitudeM', 'onGround'])
    assert.deepEqual(prov[field], reported(POSITION_MS), field);
  for (const field of [
    'speedMps',
    'track',
    'verticalRateMps',
    'callsign',
    'lastContactEpochMs',
  ])
    assert.deepEqual(prov[field], reported(CONTACT_MS), field);
});

test('database-backed type, registration and operator are REPORTED by adsb.lol with NO report time', () => {
  const records = store();
  records.receive(observation(), batch());
  const prov = records.provenance.get('ae01ce');
  for (const field of ['type', 'registration', 'operator']) {
    assert.deepEqual(prov[field], reported(null), field);
    assert.notEqual(prov[field].reportedAtMs, CONTACT_MS, field);
  }
});

test('a row without seen yields null report times for general-message fields, never a borrowed one', () => {
  const records = store();
  records.receive(observation({ contactTimeMs: null }), batch());
  const prov = records.provenance.get('ae01ce');
  const meta = records.data.get('ae01ce');
  for (const field of ['speedMps', 'track', 'callsign', 'verticalRateMps'])
    assert.equal(prov[field].reportedAtMs, null, field);
  assert.deepEqual(prov.position, reported(POSITION_MS));
  assert.equal(meta.lastContactEpochMs, null);
  assert.equal('lastContactEpochMs' in prov, false);
});

test('one batch receipt is shared by every aircraft of the batch; report times differ per row', () => {
  const records = store();
  records.receive(observation(), batch());
  records.receive(
    observation({
      id: 'ae1234',
      reference: 'ae1234',
      positionTimeMs: RECEIPT_MS - 30_000,
      contactTimeMs: RECEIPT_MS - 500,
    }),
    batch(),
  );
  const a = records.provenance.get('ae01ce');
  const b = records.provenance.get('ae1234');
  assert.equal(a.position.receivedAtMs, RECEIPT_MS);
  assert.equal(b.position.receivedAtMs, RECEIPT_MS);
  assert.equal(a.position.reportedAtMs, POSITION_MS);
  assert.equal(b.position.reportedAtMs, RECEIPT_MS - 30_000);
  assert.equal(b.speedMps.reportedAtMs, RECEIPT_MS - 500);
});

test('sticky retention keeps the retained value AND its original descriptor', () => {
  const records = store();
  records.receive(observation(), batch());
  const first = records.provenance.get('ae01ce');
  const later = RECEIPT_MS + 60_000;
  records.receive(
    observation({
      callsign: '',
      typeCode: '',
      registration: '',
      operator: '',
      verticalRateMps: null,
      positionTimeMs: later - 2_000,
      contactTimeMs: later - 1_000,
    }),
    batch({ observedAtMs: later, receivedAtMs: later }),
  );
  const meta = records.data.get('ae01ce');
  const prov = records.provenance.get('ae01ce');
  assert.equal(meta.callsign, 'RCH451');
  assert.equal(meta.type, 'C17');
  assert.equal(meta.verticalRateMps, 0);
  for (const field of [
    'callsign',
    'type',
    'registration',
    'operator',
    'verticalRateMps',
  ])
    assert.equal(prov[field], first[field], `${field} descriptor retained`);
  // Replaced fields moved to the new receipt.
  assert.equal(prov.position.receivedAtMs, later);
  assert.equal(prov.position.reportedAtMs, later - 2_000);
  assert.equal(prov.speedMps.receivedAtMs, later);
});

test('replacement overwrites the descriptor with the new report and receipt', () => {
  const records = store();
  records.receive(observation(), batch());
  const later = RECEIPT_MS + 10_000;
  records.receive(
    observation({
      callsign: 'RCH452',
      positionTimeMs: later - 4_000,
      contactTimeMs: later - 3_000,
    }),
    batch({ observedAtMs: later, receivedAtMs: later }),
  );
  const prov = records.provenance.get('ae01ce');
  assert.equal(records.data.get('ae01ce').callsign, 'RCH452');
  assert.deepEqual(prov.callsign, {
    ...reported(later - 3_000),
    receivedAtMs: later,
  });
  assert.deepEqual(prov.altitudeFt, {
    ...reported(later - 4_000),
    receivedAtMs: later,
  });
});

test('a ground row (alt_baro "ground") retains the last baro altitude and its descriptor; onGround is re-reported', () => {
  const records = store();
  records.receive(observation(), batch());
  const first = records.provenance.get('ae01ce');
  const later = RECEIPT_MS + 20_000;
  records.receive(
    observation({
      onGround: true,
      baroAltitudeM: null,
      ellipsoidAltitudeM: null,
      positionTimeMs: later - 1_000,
    }),
    batch({ observedAtMs: later, receivedAtMs: later }),
  );
  const meta = records.data.get('ae01ce');
  const prov = records.provenance.get('ae01ce');
  assert.equal(Math.round(meta.altitudeFt), 28000);
  assert.equal(
    prov.altitudeFt,
    first.altitudeFt,
    'retained baro keeps its descriptor',
  );
  assert.equal(meta.geoAltitudeM, null);
  assert.equal('geoAltitudeM' in prov, false, 'non-sticky null carries none');
  assert.equal(meta.onGround, true);
  assert.equal(prov.onGround.reportedAtMs, later - 1_000);
});

test('a missing gs/track is stored as a synthetic 0 and carries NO descriptor (no relabel, no retention)', () => {
  const records = store();
  records.receive(observation(), batch());
  assert.equal('speedMps' in records.provenance.get('ae01ce'), true);
  records.receive(
    observation({ speedMps: null, courseDeg: null }),
    batch({ receivedAtMs: RECEIPT_MS + 5_000 }),
  );
  const meta = records.data.get('ae01ce');
  const prov = records.provenance.get('ae01ce');
  assert.equal(meta.speedMps, 0);
  assert.equal(meta.track, 0);
  assert.equal('speedMps' in prov, false);
  assert.equal('track' in prov, false);
  // A genuinely reported 0 IS a report: distinguishable by its descriptor.
  records.receive(
    observation({ speedMps: 0, courseDeg: 0 }),
    batch({ receivedAtMs: RECEIPT_MS + 6_000 }),
  );
  const again = records.provenance.get('ae01ce');
  assert.equal(records.data.get('ae01ce').speedMps, 0);
  assert.equal(again.speedMps.receivedAtMs, RECEIPT_MS + 6_000);
  assert.equal(again.track.receivedAtMs, RECEIPT_MS + 6_000);
});

test('locally computed fields are DERIVED with a stable via and never inherit the feed id', () => {
  const records = store();
  records.receive(observation(), batch());
  const prov = records.provenance.get('ae01ce');
  const expectVia = {
    klass: 'classification',
    wasAirborne: 'airborne-history',
    renderAltitudeM: 'render-altitude-selection',
  };
  for (const [field, via] of Object.entries(expectVia)) {
    assert.deepEqual(
      prov[field],
      {
        epistemic: EPISTEMIC.DERIVED,
        sourceId: null,
        reportedAtMs: null,
        receivedAtMs: null,
        via,
      },
      field,
    );
  }
});

test('internal bookkeeping is never provenance-tagged', () => {
  const records = store();
  records.receive(observation(), batch());
  const prov = records.provenance.get('ae01ce');
  for (const field of [
    'sourceReference',
    'observedReceiptMs',
    'turnRateDps',
    'rawLat',
    'rawLon',
  ])
    assert.equal(field in prov, false, field);
  assert.deepEqual(Object.keys(prov).sort(), [
    'altitudeFt',
    'callsign',
    'geoAltitudeM',
    'klass',
    'lastContactEpochMs',
    'onGround',
    'operator',
    'position',
    'registration',
    'renderAltitudeM',
    'speedMps',
    'track',
    'type',
    'verticalRateMps',
    'wasAirborne',
  ]);
});

test('a batch without source identity creates no REPORTED descriptor and drops stale ones', () => {
  const records = store();
  records.receive(observation(), batch());
  records.receive(
    observation(),
    batch({ sourceId: undefined, receivedAtMs: undefined }),
  );
  const prov = records.provenance.get('ae01ce');
  for (const descriptor of Object.values(prov))
    assert.equal(descriptor.epistemic, EPISTEMIC.DERIVED);
  assert.equal('position' in prov, false);
  // A legacy caller that never passes a source: derived-only, still valid.
  const legacy = store();
  legacy.receive(observation(), {
    observedAtMs: RECEIPT_MS,
    floorWarmPoints: [],
    modelOwnsVisual: false,
  });
  assert.deepEqual(Object.keys(legacy.provenance.get('ae01ce')).sort(), [
    'klass',
    'renderAltitudeM',
    'wasAirborne',
  ]);
});

test('TIS-B / non-ICAO rows are keyed by their native id; no canonical identity is invented', () => {
  const snapshot = readsbSnapshot(
    {
      ac: [
        {
          hex: '~A1B2C3',
          lat: 31,
          lon: -97,
          alt_baro: 5000,
          gs: 120,
          track: 10,
          seen: 0.5,
          seen_pos: 0.5,
        },
      ],
    },
    { observedAtMs: RECEIPT_MS, receivedAtMs: RECEIPT_MS, now: RECEIPT_MS },
  );
  assert.equal(snapshot.sourceId, 'adsb.lol');
  const records = store();
  for (const row of snapshot.records)
    records.receive(row, {
      observedAtMs: snapshot.observedAtMs,
      floorWarmPoints: [],
      modelOwnsVisual: false,
      sourceId: snapshot.sourceId,
      receivedAtMs: snapshot.receivedAtMs,
    });
  assert.deepEqual([...records.provenance.keys()], ['~a1b2c3']);
  const prov = records.provenance.get('~a1b2c3');
  assert.deepEqual(prov.position, reported(RECEIPT_MS - 500));
  assert.equal(prov.position.sourceId, 'adsb.lol');
  for (const field of ['type', 'registration', 'operator', 'callsign'])
    assert.equal(field in prov, false, `${field} was not reported`);
});

test('the same ICAO held by the civil and military stores keeps two independent, store-local descriptors', () => {
  const military = store();
  const civil = new FlightRecords({
    geoidHeight: () => 40,
    cachedGroundFloor: () => 200,
    floorAltitudeM: (height, floor) => Math.max(height, floor + 1.5),
  });
  military.receive(observation(), batch());
  civil.receive(
    {
      id: 'ae01ce',
      reference: 'ae01ce',
      latitude: 31.01,
      longitude: -97.01,
      positionTimeMs: RECEIPT_MS - 9_000,
      contactTimeMs: RECEIPT_MS - 8_000,
      baroAltitudeM: 8_500,
      ellipsoidAltitudeM: null,
      onGround: false,
      speedMps: 200,
      courseDeg: 90,
      verticalRateMps: 0,
      callsign: 'RCH451',
      originCountry: 'United States',
      category: 5,
    },
    {
      observedAtMs: RECEIPT_MS - 7_000,
      floorWarmPoints: [],
      modelOwnsVisual: false,
      sourceId: 'opensky',
      receivedAtMs: RECEIPT_MS - 7_000,
    },
  );
  const mil = military.provenance.get('ae01ce');
  const civ = civil.provenance.get('ae01ce');
  assert.equal(mil.position.sourceId, 'adsb.lol');
  assert.equal(civ.position.sourceId, 'opensky');
  assert.equal(mil.position.reportedAtMs, POSITION_MS);
  assert.equal(civ.position.reportedAtMs, RECEIPT_MS - 9_000);
  assert.notEqual(military.provenance, civil.provenance);
  // Neither store learns about the other on churn.
  military.forget('ae01ce');
  assert.equal(civil.provenance.has('ae01ce'), true);
});

test('forget() removes the descriptor set with the record; the sidecar stays sparse', () => {
  const records = store();
  records.receive(observation(), batch());
  records.receive(observation({ id: 'ae1234', reference: 'ae1234' }), batch());
  records.forget('ae01ce');
  assert.equal(records.data.has('ae01ce'), false);
  assert.equal(records.provenance.has('ae01ce'), false);
  assert.equal(records.provenance.size, 1);
  assert.equal(records.data.size, records.provenance.size);
});

test('the sidecar holds CURRENT descriptors only — no arrays, no previous values', () => {
  const records = store();
  for (let poll = 0; poll < 5; poll++) {
    const at = RECEIPT_MS + poll * 15_000;
    records.receive(
      observation({ positionTimeMs: at - 2_000, contactTimeMs: at - 1_000 }),
      batch({ observedAtMs: at, receivedAtMs: at }),
    );
  }
  const prov = records.provenance.get('ae01ce');
  assert.equal(records.provenance.size, 1);
  for (const [field, descriptor] of Object.entries(prov)) {
    assert.equal(Array.isArray(descriptor), false, field);
    assert.deepEqual(
      Object.keys(descriptor).sort(),
      ['epistemic', 'receivedAtMs', 'reportedAtMs', 'sourceId', 'via'],
      field,
    );
  }
  assert.equal(prov.position.receivedAtMs, RECEIPT_MS + 4 * 15_000);
});
