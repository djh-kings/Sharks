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
  exact: { label: "Exact spot", hint: "The pin is where I saw the shark", metres: null },
  withinOneKm: { label: "Within about 1km", hint: null, metres: 1000 },
  generalSite: { label: "General dive site or fishing area", hint: "Within about 5km", metres: 5000 },
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

// ---------------------------------------------------------------------------
// Typed positions
//
// Chart plotters and dive computers show positions in degrees and decimal
// minutes, eg 50° 21.6' N. The direction (N/S, W/E) is chosen with buttons,
// because the iPhone decimal keypad has no minus sign. So every typed number
// is positive, and the hemisphere gives the sign.
// ---------------------------------------------------------------------------

// Reads a typed number. Accepts a comma as the decimal point, as some
// European keyboards give one. Returns null if it is not a number.
function readNumber(text) {
  const cleaned = String(text ?? "").trim().replace(",", ".");
  if (cleaned === "" || !/^\d+(\.\d*)?$|^\.\d+$/.test(cleaned)) {
    return null;
  }
  return Number(cleaned);
}

// Turns typed boxes into signed decimal degrees.
// axis is "lat" or "lon"; format is "ddm" (degrees and minutes) or "decimal".
// Returns { value, error }. value is null when nothing usable was typed.
export function parseTypedCoordinate({ axis, format, degrees, minutes, decimal, hemisphere }) {
  const name = axis === "lat" ? "Latitude" : "Longitude";
  const maxDegrees = axis === "lat" ? 90 : 180;
  let value;

  if (format === "decimal") {
    if (String(decimal ?? "").trim() === "") return { value: null, error: null };
    value = readNumber(decimal);
    if (value === null) return { value: null, error: `${name} must be a number, eg ${axis === "lat" ? "50.36" : "4.14"}.` };
  } else {
    if (String(degrees ?? "").trim() === "" && String(minutes ?? "").trim() === "") return { value: null, error: null };
    const wholeDegrees = readNumber(degrees);
    const minuteValue = String(minutes ?? "").trim() === "" ? 0 : readNumber(minutes);
    if (wholeDegrees === null || !Number.isInteger(wholeDegrees)) {
      return { value: null, error: `${name} degrees must be a whole number.` };
    }
    if (minuteValue === null) {
      return { value: null, error: `${name} minutes must be a number.` };
    }
    if (minuteValue >= 60) {
      return { value: null, error: `${name} minutes must be less than 60. You typed ${String(minutes).trim()}.` };
    }
    value = wholeDegrees + minuteValue / 60;
  }

  if (value > maxDegrees) {
    return { value: null, error: `${name} must be ${maxDegrees} degrees or less.` };
  }
  if (!hemisphere) {
    return { value: null, error: `Choose ${axis === "lat" ? "North or South" : "West or East"} for the ${name.toLowerCase()}.` };
  }
  const negative = hemisphere === "S" || hemisphere === "W";
  return { value: negative ? -value : value, error: null };
}

// Splits signed decimal degrees into the typed boxes' values.
export function splitCoordinate(value, axis) {
  const hemisphere = axis === "lat" ? (value < 0 ? "S" : "N") : value < 0 ? "W" : "E";
  const abs = Math.abs(value);
  let degrees = Math.floor(abs);
  let minutes = Number(((abs - degrees) * 60).toFixed(3));
  if (minutes >= 60) {
    degrees += 1;
    minutes = 0;
  }
  return { degrees: String(degrees), minutes: String(minutes), decimal: abs.toFixed(5), hemisphere };
}
