// ─────────────────────────────────────────────────────────────────────────────
// Haversine distance — geographic distance between two WGS84 coordinates.
//
// Uses the standard Haversine formula (RFC 6238 / aviation standard):
//   a = sin²(Δlat/2) + cos(lat1)·cos(lat2)·sin²(Δlng/2)
//   c = 2·asin(√a)
//   d = R · c
//
// Returns metres.  Accurate to within ±0.5% for distances < 10 km, which is
// well within the tolerance needed for a 100 m geofence check.
//
// Assumes a spherical Earth with mean radius 6 371 000 m (WGS84 approximation).
// ─────────────────────────────────────────────────────────────────────────────

/** Mean radius of the Earth in metres (WGS84 spherical approximation). */
export const EARTH_RADIUS_METRES = 6_371_000;

/**
 * Straight-line geographic distance between two WGS84 points in metres.
 *
 * @param lat1 - Latitude of point A (decimal degrees, −90 to +90)
 * @param lng1 - Longitude of point A (decimal degrees, −180 to +180)
 * @param lat2 - Latitude of point B (decimal degrees, −90 to +90)
 * @param lng2 - Longitude of point B (decimal degrees, −180 to +180)
 * @returns Distance in metres (non-negative)
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

/** Soft geofence radius in metres. */
export const GEOFENCE_RADIUS_METRES = 100;
