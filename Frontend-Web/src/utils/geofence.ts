// ─────────────────────────────────────────────────────────────────────────────
// Geofence utilities — client-side location and proximity calculation
//
// Used by the Clock In / Clock Out flow to:
//   1. Request the device's current position from the browser.
//   2. Compute the Haversine distance to the target clinic.
//   3. Build a GeofenceLocation object to display the warning and send to
//      the backend for recording.
//
// This is a SOFT geofence — the result is informational only.  No code in
// this file prevents a clock-in or clock-out from proceeding.  The warning
// UI in ClockWidget handles user confirmation before the API call.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClockLocationInput, GeofenceLocation } from "../types/payroll.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Soft geofence radius in metres (100 m). Matches backend GEOFENCE_RADIUS_METRES. */
export const GEOFENCE_RADIUS_METRES = 100;

/** Mean Earth radius in metres (WGS84 spherical approximation). */
const EARTH_RADIUS_METRES = 6_371_000;

// ── Haversine distance ─────────────────────────────────────────────────────────

/**
 * Straight-line geographic distance between two WGS84 points in metres.
 *
 * Uses the standard Haversine formula — accurate to within ±0.5% for
 * distances < 10 km, which is well within the tolerance for a 100 m fence.
 *
 * Does NOT use simple lat/long subtraction — matches backend implementation.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLng = Math.sin(dLng / 2);

  const a =
    sinHalfLat * sinHalfLat +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinHalfLng * sinHalfLng;

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(a));
}

// ── Geolocation result ─────────────────────────────────────────────────────────

export type GeolocationSuccess = {
  state: "success";
  lat: number;
  lng: number;
  /** Browser-reported accuracy in metres, or null if unavailable. */
  accuracy: number | null;
};

export type GeolocationResult =
  | GeolocationSuccess
  | { state: "denied" }
  | { state: "unavailable" };

/**
 * Requests the device's current position using the browser Geolocation API.
 *
 * Returns a typed discriminated union rather than throwing so callers can
 * easily distinguish "no permission" from "service down" without try/catch.
 *
 * Timeout: 8 seconds — long enough for a cold GPS fix, short enough that
 * users on slow hardware do not wait indefinitely before the warning appears.
 *
 * Does NOT use maximumAge — always requests a fresh position for attendance
 * events.  Do NOT add background tracking or continuous position monitoring.
 */
export function requestGeolocation(): Promise<GeolocationResult> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve({ state: "unavailable" });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          state: "success",
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy:
            typeof position.coords.accuracy === "number"
              ? position.coords.accuracy
              : null,
        });
      },
      (error) => {
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        if (error.code === 1) {
          resolve({ state: "denied" });
        } else {
          resolve({ state: "unavailable" });
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 8_000,
        maximumAge: 0,
      },
    );
  });
}

// ── GeofenceLocation builder ───────────────────────────────────────────────────

/**
 * Converts a raw geolocation result into a GeofenceLocation object suitable
 * for sending to the backend and displaying in the UI.
 *
 * When clinicLat / clinicLng are null (coordinates not yet set for this clinic),
 * the distance and withinRange fields are set to null and the locationState
 * falls back to 'unavailable' rather than erroneously marking as "outside".
 *
 * @param result       - The geolocation result from requestGeolocation()
 * @param targetClinicId - UUID of the clinic being used as the geofence centre
 * @param clinicLat    - Clinic's WGS84 latitude, or null if not set
 * @param clinicLng    - Clinic's WGS84 longitude, or null if not set
 */
export function buildGeofenceLocation(
  result: GeolocationResult,
  targetClinicId: string,
  clinicLat: number | null,
  clinicLng: number | null,
): GeofenceLocation {
  if (result.state !== "success") {
    // SECURITY: store null coordinates, never 0,0 as a fallback for no-GPS events.
    return {
      lat: null,
      lng: null,
      accuracyMetres: null,
      targetClinicId,
      distanceMetres: null,
      withinRange: null,
      locationState: result.state, // "denied" | "unavailable"
    };
  }

  if (clinicLat === null || clinicLng === null) {
    // Clinic has no coordinates yet — cannot compute distance.
    // Treat as unavailable so the warning shows but doesn't falsely alarm.
    return {
      lat: result.lat,
      lng: result.lng,
      accuracyMetres: result.accuracy,
      targetClinicId,
      distanceMetres: null,
      withinRange: null,
      locationState: "unavailable",
    };
  }

  const distanceMetres = haversineDistance(
    result.lat,
    result.lng,
    clinicLat,
    clinicLng,
  );

  const withinRange = distanceMetres <= GEOFENCE_RADIUS_METRES;

  return {
    lat: result.lat,
    lng: result.lng,
    accuracyMetres: result.accuracy,
    targetClinicId,
    distanceMetres: Math.round(distanceMetres),
    withinRange,
    locationState: withinRange ? "within" : "outside",
  };
}

// ── Warning message helpers ────────────────────────────────────────────────────

/**
 * Returns a human-readable distance string for the warning panel.
 * e.g. 450 → "~450 m", 1500 → "~1.5 km"
 */
export function formatDistance(metres: number): string {
  if (metres < 1000) {
    return `~${String(Math.round(metres))} m`;
  }
  return `~${(metres / 1000).toFixed(1)} km`;
}

/**
 * Returns true when the geofence result requires a user-visible warning
 * before the clock-in/out API call.
 *
 * "within" → no warning needed (proceed silently)
 * "outside" | "denied" | "unavailable" → show warning and await confirmation
 */
export function requiresGeofenceWarning(location: GeofenceLocation): boolean {
  return location.locationState !== "within";
}

/**
 * Converts a GeofenceLocation (used for UI display) into a ClockLocationInput
 * (what the API accepts) by stripping the backend-computed fields.
 *
 * The backend authoritatively recomputes distanceMetres, withinRange, and
 * locationState ("within"/"outside") from the submitted coordinates — the
 * client must NOT send these fields.  toClockLocationInput() ensures they
 * are always stripped before the API call.
 */
export function toClockLocationInput(loc: GeofenceLocation): ClockLocationInput {
  if (loc.lat === null || loc.lng === null) {
    // Denied or unavailable — preserve the error state, send null coordinates.
    return {
      lat: null,
      lng: null,
      accuracyMetres: null,
      targetClinicId: loc.targetClinicId,
      locationState: loc.locationState as "denied" | "unavailable",
    };
  }
  // Has coordinates — backend will recompute distance/withinRange/locationState.
  return {
    lat: loc.lat,
    lng: loc.lng,
    accuracyMetres: loc.accuracyMetres,
    targetClinicId: loc.targetClinicId,
    // No locationState field — backend determines "within"/"outside" from coords
  };
}
