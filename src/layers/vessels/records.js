import {
  PARTIAL_RETENTION_MS,
  SELECTED_PIN_REFRESHES,
} from './recordPolicy.js';
import { EPISTEMIC, createProvenance } from '../../data/provenance.js';

/** Normalize AIS display fields without allocating scene resources. */
export function normalizeVessel(row) {
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    name: String(row.name || row.mmsi || 'VESSEL'),
    mmsi: String(row.mmsi || '').trim(),
    reference: row.reference ?? String(row.mmsi || '').trim(),
    imo: String(row.imo || ''),
    type: String(row.type || ''),
    destination: String(row.destination || ''),
    speed: finiteNumber(row.speed),
    course: finiteNumber(row.course),
    heading: finiteNumber(row.heading),
    lastPositionUtc: String(row.last_position_UTC || ''),
    lastPositionEpoch: finiteNumber(row.last_position_epoch),
    missedRefreshes: 0,
  };
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const VESSEL_SOURCE_ID = 'aisstream';

function vesselReportedAtMs(record) {
  if (Number.isFinite(record.lastPositionEpoch) && record.lastPositionEpoch > 0) {
    const ms = record.lastPositionEpoch * 1000;
    return ms > 0 ? ms : null;
  }
  if (record.lastPositionUtc) {
    const ms = Date.parse(record.lastPositionUtc);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return null;
}

function makeReportedProvenance(reportedAtMs, receivedAtMs) {
  try {
    return createProvenance({
      epistemic: EPISTEMIC.REPORTED,
      sourceId: VESSEL_SOURCE_ID,
      reportedAtMs,
      receivedAtMs,
    });
  } catch {
    return null;
  }
}

function buildVesselProvenance(next, receivedAtMs) {
  const reportedAt = vesselReportedAtMs(next);
  const prov = {};

  // Position — always present for a valid normalized record
  const pos = makeReportedProvenance(reportedAt, receivedAtMs);
  if (pos) prov.position = pos;

  if (Number.isFinite(next.speed)) {
    const p = makeReportedProvenance(reportedAt, receivedAtMs);
    if (p) prov.speed = p;
  }
  if (Number.isFinite(next.course)) {
    const p = makeReportedProvenance(reportedAt, receivedAtMs);
    if (p) prov.course = p;
  }
  if (Number.isFinite(next.heading)) {
    const p = makeReportedProvenance(reportedAt, receivedAtMs);
    if (p) prov.heading = p;
  }

  // Identity-ish fields — static data, no event time retained server-side
  const nameTrim = String(next.name || '').trim();
  if (nameTrim && nameTrim !== next.mmsi && nameTrim !== 'VESSEL') {
    const p = makeReportedProvenance(null, receivedAtMs);
    if (p) prov.name = p;
  }
  const imoTrim = String(next.imo || '').trim();
  if (imoTrim) {
    const p = makeReportedProvenance(null, receivedAtMs);
    if (p) prov.imo = p;
  }
  const typeTrim = String(next.type || '').trim();
  if (typeTrim) {
    const p = makeReportedProvenance(null, receivedAtMs);
    if (p) prov.type = p;
  }
  const destTrim = String(next.destination || '').trim();
  if (destTrim) {
    const p = makeReportedProvenance(null, receivedAtMs);
    if (p) prov.destination = p;
  }

  return prov;
}

/** Own stable vessel records and bounded incomplete/selected retention. */
export class VesselRecords {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.byMmsi = new Map();
    this.unkeyed = [];
    this.all = [];
    // I3d — store-local, current-state-only provenance sidecar — Map<mmsi, {field: descriptor}>
    // Mirrors FlightRecords.provenance architecture. Provenance follows current value,
    // disappears when record disappears. No history. Keyed by native mmsi string,
    // not entityKey, so malformed (non-9-digit) still has provenance, unkeyed (empty) does not.
    this.provenance = new Map();
  }
  reconcile(
    rows,
    { complete = true, selectedRecord = null, cap = Infinity },
    effects,
  ) {
    const receivedAtMs = this.now();
    for (const record of this.unkeyed) effects.remove(record, false);
    this.unkeyed = [];
    const seen = new Set();
    for (const row of rows) {
      const next = normalizeVessel(row);
      if (!next) continue;
      next.receivedAtMs = receivedAtMs;
      if (!next.mmsi) {
        effects.add(next);
        this.unkeyed.push(next);
        continue;
      }
      if (seen.has(next.mmsi)) continue;
      seen.add(next.mmsi);
      const record = this.byMmsi.get(next.mmsi);
      const nextProv = buildVesselProvenance(next, receivedAtMs);
      if (record) {
        const before = effects.beforeUpdate(record);
        record.reference = next.reference;
        record.receivedAtMs = next.receivedAtMs;
        record.lat = next.lat;
        record.lon = next.lon;
        record.name = next.name;
        record.imo = next.imo;
        record.type = next.type;
        record.destination = next.destination;
        record.speed = next.speed;
        record.course = next.course;
        record.heading = next.heading;
        record.lastPositionUtc = next.lastPositionUtc;
        record.lastPositionEpoch = next.lastPositionEpoch;
        record.missedRefreshes = 0;

        // I3d: provenance follows current value — replacement replaces descriptors
        if (Object.keys(nextProv).length > 0) {
          this.provenance.set(next.mmsi, nextProv);
        } else {
          this.provenance.delete(next.mmsi);
        }

        effects.updated(record, before);
      } else {
        effects.add(next);
        this.byMmsi.set(next.mmsi, next);
        if (Object.keys(nextProv).length > 0) {
          this.provenance.set(next.mmsi, nextProv);
        }
      }
    }
    for (const [mmsi, record] of this.byMmsi) {
      if (seen.has(mmsi)) continue;
      if (
        !complete &&
        Number.isFinite(record.receivedAtMs) &&
        receivedAtMs - record.receivedAtMs < PARTIAL_RETENTION_MS
      ) {
        if (record === selectedRecord) {
          record.missedRefreshes = Math.max(1, record.missedRefreshes || 0);
          effects.staleSelected(record);
        }
        continue;
      }
      if (record === selectedRecord) {
        record.missedRefreshes = (record.missedRefreshes || 0) + 1;
        if (complete && record.missedRefreshes <= SELECTED_PIN_REFRESHES) {
          effects.staleSelected(record);
          continue;
        }
      }
      // Selection teardown still sees the record before its store entry is removed.
      effects.remove(record, record === selectedRecord);
      this.byMmsi.delete(mmsi);
      this.provenance.delete(mmsi);
      effects.removed(mmsi);
    }
    if (this.byMmsi.size + this.unkeyed.length > cap) {
      for (const [mmsi, record] of this.byMmsi) {
        if (this.byMmsi.size + this.unkeyed.length <= cap) break;
        if (seen.has(mmsi) || record === selectedRecord) continue;
        effects.remove(record, false);
        this.byMmsi.delete(mmsi);
        this.provenance.delete(mmsi);
        effects.removed(mmsi);
      }
    }
    this.all = [...this.byMmsi.values(), ...this.unkeyed];
  }
}
