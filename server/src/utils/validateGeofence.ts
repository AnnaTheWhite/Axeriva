type GeofenceInput = {
  latitude?: unknown;
  longitude?: unknown;
  geofenceRadius?: unknown;
};

// Validates the optional geofence fields on a project payload. Returns an
// error message if something is out of range, or null if everything (or
// nothing — all fields are optional) checks out.
export function validateGeofenceFields({
  latitude,
  longitude,
  geofenceRadius,
}: GeofenceInput): string | null {
  if (latitude !== undefined && latitude !== null) {
    const lat = Number(latitude);
    if (Number.isNaN(lat) || lat < -90 || lat > 90) {
      return "latitude must be between -90 and 90";
    }
  }

  if (longitude !== undefined && longitude !== null) {
    const lon = Number(longitude);
    if (Number.isNaN(lon) || lon < -180 || lon > 180) {
      return "longitude must be between -180 and 180";
    }
  }

  if (geofenceRadius !== undefined && geofenceRadius !== null) {
    const radius = Number(geofenceRadius);
    if (Number.isNaN(radius) || radius <= 0) {
      return "geofenceRadius must be a positive number";
    }
  }

  return null;
}
