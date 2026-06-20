import { calculateDistance } from "../../utils/geofence";

export type GeofenceProject = {
  latitude: number | null;
  longitude: number | null;
  geofenceRadius: number | null;
  geofenceEnabled: boolean;
};

export type GeofenceCheckResult = {
  withinRadius: boolean;
  distanceMeters: number | null;
  reason?: "geofence_disabled" | "missing_coordinates";
};

// Foundation for automatic clock in/out (not wired up to anything yet — see
// README note in this folder / the Geofence V1 plan). Given a project's
// configured geofence and a candidate position, reports whether that
// position falls inside the project's radius.
//
// Nothing currently calls this outside of tests. Once browser/mobile
// location capture exists, the shifts routes can call `checkGeofence` before
// honoring a clock-in/clock-out request from an employee.
export function checkGeofence(
  project: GeofenceProject,
  currentLatitude: number,
  currentLongitude: number
): GeofenceCheckResult {
  if (!project.geofenceEnabled) {
    return { withinRadius: false, distanceMeters: null, reason: "geofence_disabled" };
  }

  if (
    project.latitude === null ||
    project.longitude === null ||
    project.geofenceRadius === null
  ) {
    return { withinRadius: false, distanceMeters: null, reason: "missing_coordinates" };
  }

  const distanceMeters = calculateDistance(
    project.latitude,
    project.longitude,
    currentLatitude,
    currentLongitude
  );

  return {
    withinRadius: distanceMeters <= project.geofenceRadius,
    distanceMeters,
  };
}
