import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenSkySource, createAdsbLolSource } from './standalone.js';
import { openSkySnapshot } from './aircraft.js';

function mockResponse({ ok = true, status = 200, headers = {}, payload = {} } = {}) {
  const lowerHeaders = {};
  for (const [k, v] of Object.entries(headers)) lowerHeaders[k.toLowerCase()] = v;
  return {
    response: {
      ok,
      status,
      headers: {
        get(name) {
          return lowerHeaders[name.toLowerCase()] ?? null;
        },
      },
    },
    payload,
  };
}

function mockFetchFactory(mockFn) {
  return async (url, opts) => {
    const { response, payload } = await mockFn(url, opts);
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
}

// Header tests: OpenSky vs adsb.lol fallback vs missing/invalid deterministic

test('standalone provenance: openSkySnapshot sourceId mapping — explicit', () => {
  const snap = openSkySnapshot({ states: [], time: 1700000000 }, { sourceId: 'opensky', now: 1700000005000, receivedAtMs: 1700000005000 });
  assert.equal(snap.sourceId, 'opensky');
  assert.equal(snap.receivedAtMs, 1700000005000);
});

test('standalone provenance: openSkySnapshot sourceId derived from label when not explicit', () => {
  const snap1 = openSkySnapshot({ states: [], time: 1700000000 }, { source: 'OpenSky Network', now: 1000 });
  assert.equal(snap1.sourceId, 'opensky');
  const snap2 = openSkySnapshot({ states: [], time: 1700000000 }, { source: 'adsb.lol', now: 1000 });
  assert.equal(snap2.sourceId, 'adsb.lol');
});

test('standalone provenance: OpenSky primary — no X-Flight-Source header → opensky', async () => {
  const fetchImpl = mockFetchFactory(async () => mockResponse({
    headers: { 'x-flight-coverage': 'worldwide' },
    payload: { states: [], time: 1700000000 },
  }));
  const src = createOpenSkySource({ fetchImpl, now: () => 1700000005000 });
  const snap = await src.getSnapshot({}, {});
  assert.equal(snap.source, 'OpenSky Network');
  assert.equal(snap.sourceId, 'opensky');
  assert.equal(snap.receivedAtMs, 1700000005000);
  assert.equal(snap.coverage, 'worldwide');
});

test('standalone provenance: OpenSky fallback — X-Flight-Source: adsb.lol → adsb.lol', async () => {
  const fetchImpl = mockFetchFactory(async () => mockResponse({
    headers: { 'x-flight-source': 'adsb.lol', 'x-flight-coverage': 'regional 250nm fallback' },
    payload: { states: [], time: 1700000000 },
  }));
  const src = createOpenSkySource({ fetchImpl, now: () => 1700000005000 });
  const snap = await src.getSnapshot({}, {});
  assert.equal(snap.source, 'adsb.lol');
  assert.equal(snap.sourceId, 'adsb.lol');
  assert.equal(snap.receivedAtMs, 1700000005000);
  assert.equal(snap.coverage, 'regional 250nm fallback');
});

test('standalone provenance: missing/invalid header deterministic — defaults to opensky', async () => {
  const fetchImplEmpty = mockFetchFactory(async () => mockResponse({
    headers: {},
    payload: { states: [], time: 1700000000 },
  }));
  const srcEmpty = createOpenSkySource({ fetchImpl: fetchImplEmpty, now: () => 1000 });
  const snapEmpty = await srcEmpty.getSnapshot({}, {});
  assert.equal(snapEmpty.sourceId, 'opensky');
  assert.equal(snapEmpty.source, 'OpenSky Network');

  const fetchImplInvalid = mockFetchFactory(async () => mockResponse({
    headers: { 'x-flight-source': '' },
    payload: { states: [], time: 1700000000 },
  }));
  const srcInvalid = createOpenSkySource({ fetchImpl: fetchImplInvalid, now: () => 1000 });
  const snapInvalid = await srcInvalid.getSnapshot({}, {});
  // Empty string header -> falsy -> defaults to OpenSky label -> opensky id
  assert.equal(snapInvalid.sourceId, 'opensky');
});

test('standalone provenance: adsb.lol source always adsb.lol with receivedAtMs', async () => {
  const fetchImpl = mockFetchFactory(async () => mockResponse({
    headers: { 'x-ads-b-cache-age-ms': '1234' },
    payload: { ac: [] },
  }));
  const src = createAdsbLolSource({ fetchImpl, now: () => 1700000005000 });
  const snap = await src.getSnapshot({}, {});
  assert.equal(snap.sourceId, 'adsb.lol');
  assert.equal(snap.receivedAtMs, 1700000005000);
  assert.ok(snap.observedAtMs <= 1700000005000);
});

test('standalone provenance: one receipt time per batch — now() called once per getSnapshot', async () => {
  let nowCalls = 0;
  const now = () => { nowCalls++; return 1700000005000 + nowCalls; };
  const fetchImpl = mockFetchFactory(async () => mockResponse({
    headers: {},
    payload: { states: [['abc123','TEST', 'USA', 1700000000, 1700000001, -77, 39, 1000, false, 120, 90, 0, null, 1040, null, null, null, 0]], time: 1700000000 },
  }));
  const src = createOpenSkySource({ fetchImpl, now });
  const snap = await src.getSnapshot({}, {});
  // now() should be called once for receiptMs, not per record
  assert.equal(nowCalls, 1);
  assert.equal(snap.receivedAtMs, 1700000005001);
  assert.equal(snap.records.length, 1);
});
