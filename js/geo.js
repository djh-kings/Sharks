// geo.js
// Getting and checking a location.
//
// Important: GPS does not work underwater. For a dive, the phone is usually on
// the boat, so the position we get is where the report is being made, not where
// the shark was. That is why the user can move the pin and must say how precise
// the location is. Scientists need that "uncertainty" as much as the position.

// How far from the true spot the shark could have been, in metres.
// These become Darwin Core's coordinateUncertaintyInMeters.
export const precisionOptions = {
  exact: { label: "Exact spot (I am there now, or the pin is where I saw it)", metres: null },
  withinOneKm: { label: "Within about 1km", metres: 1000 },
  generalSite: { label: "General dive site or fishing area (within about 5km)", metres: 5000 },
};

// A rough box around UK and Irish waters. We only WARN if a point is outside it,
// because a genuine record from further away is still worth having.
const ukIrelandBounds = { minLat: 48.0, maxLat: 62.0, minLon: -16.0, maxLon: 4.0 };

// Wraps navigator.geolocation in a Promise.
export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This device cannot share its location. Please place the pin on the map instead."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMetres: Math.round(position.coords.accuracy),
        }),
      (error) => reject(new Error(describeGeoError(error))),
      // enableHighAccuracy asks for real GPS rather than a Wi-Fi guess.
      // At sea there is no Wi-Fi, so allow plenty of time for a satellite fix.
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 }
    );
  });
}

function describeGeoError(error) {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location permission was refused. You can still place the pin on the map or type the coordinates.";
    case error.POSITION_UNAVAILABLE:
      return "Your position could not be found. Try again in the open, or place the pin on the map.";
    case error.TIMEOUT:
      return "Finding your position took too long. Try again, or place the pin on the map.";
    default:
      return "Your position could not be found. Please place the pin on the map.";
  }
}

// Works out the uncertainty to record. For "exact" we use the GPS accuracy
// if we have it, but never claim better than 10m.
export function uncertaintyMetres(precision, gpsAccuracyMetres) {
  const option = precisionOptions[precision];
  if (!option) {
    return null;
  }
  if (option.metres !== null) {
    return option.metres;
  }
  return Math.max(10, gpsAccuracyMetres || 30);
}

// Returns a list of problems (empty if the coordinates are fine).
export function validateCoords(latitude, longitude) {
  const problems = [];
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    problems.push("Latitude must be a number between -90 and 90.");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    problems.push("Longitude must be a number between -180 and 180.");
  }
  return problems;
}

export function isInUkIrelandWaters(latitude, longitude) {
  return (
    latitude >= ukIrelandBounds.minLat &&
    latitude <= ukIrelandBounds.maxLat &&
    longitude >= ukIrelandBounds.minLon &&
    longitude <= ukIrelandBounds.maxLon
  );
}
