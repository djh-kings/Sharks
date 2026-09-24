// format.js
// Helpers for showing dates, times, and text in the King's house style.
// Dates look like "Monday 20th July 2026" and times like "9.00am".

const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Returns "1st", "2nd", "3rd", "4th" ... "11th", "12th", "13th", "21st" and so on.
export function ordinal(n) {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return n + "th";
  }
  const suffixes = { 1: "st", 2: "nd", 3: "rd" };
  return n + (suffixes[n % 10] || "th");
}

// "Monday 20th July 2026"
export function formatDate(date) {
  return `${weekdayNames[date.getDay()]} ${ordinal(date.getDate())} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
}

// "9.00am", "12.30pm"
export function formatTime(date) {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const suffix = hours < 12 ? "am" : "pm";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}.${minutes}${suffix}`;
}

// "Monday 20th July 2026 at 9.00am"
export function formatDateTime(date) {
  return `${formatDate(date)} at ${formatTime(date)}`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

// The value a <input type="datetime-local"> expects, eg "2026-07-20T09:00".
export function toLocalInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ISO 8601 with the local UTC offset, eg "2026-07-20T09:00:00+01:00".
// Darwin Core asks for this form, so scientists know the local time AND the offset.
export function toIsoWithOffset(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`
  );
}

// Coordinates to five decimal places (about 1m), which is more than enough.
export function formatCoords(latitude, longitude) {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

// Degrees and minutes, as a chart plotter shows them: "50° 21.62′ N".
export function formatCoordinate(value, axis) {
  const hemisphere = axis === "lat" ? (value < 0 ? "S" : "N") : value < 0 ? "W" : "E";
  const abs = Math.abs(value);
  let degrees = Math.floor(abs);
  let minutes = (abs - degrees) * 60;
  if (Number(minutes.toFixed(2)) >= 60) {
    degrees += 1;
    minutes = 0;
  }
  return `${degrees}° ${minutes.toFixed(2).padStart(5, "0")}′ ${hemisphere}`;
}

// "50° 21.62′ N, 4° 08.40′ W"
export function formatPosition(latitude, longitude) {
  return `${formatCoordinate(latitude, "lat")}, ${formatCoordinate(longitude, "lon")}`;
}

// Always escape user-entered text before putting it into innerHTML.
export function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// House style: numbers one to nine are written as words in prose, 10 and above as digits.
const smallNumberWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

export function numberInWords(n) {
  return Number.isInteger(n) && n >= 0 && n < 10 ? smallNumberWords[n] : String(n);
}
