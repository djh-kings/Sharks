// photos.js
// Reading and preparing photos.
//
// Two jobs:
// 1. Read the photo's metadata (EXIF): when it was taken and, if the camera
//    recorded it, where. This lets us fill in the form for the user.
// 2. Make a smaller copy WITHOUT that metadata. Drawing the image onto a canvas
//    and saving the canvas throws the EXIF away, so the stored photo does not
//    carry the user's exact position or camera details.
//
// Uses the exifr library (vendor/exifr), loaded as a global called "exifr".

const maxDimension = 1600; // pixels on the longest side
const jpegQuality = 0.85;

// Returns { takenAt: Date|null, latitude: number|null, longitude: number|null }
export async function readPhotoMetadata(file) {
  const result = { takenAt: null, latitude: null, longitude: null };
  if (!window.exifr) {
    return result;
  }
  let tags;
  try {
    // One call reads the date tags and the GPS block. exifr converts GPS to
    // decimal "latitude" and "longitude" for us. (Note: the "lite" build of
    // exifr does NOT accept a list of tag names here; it throws.)
    tags = await window.exifr.parse(file);
  } catch {
    // Unreadable EXIF: common for screenshots and photos sent through messaging apps.
    return result;
  }
  const taken = tags?.DateTimeOriginal || tags?.CreateDate;
  if (taken instanceof Date && !Number.isNaN(taken.getTime())) {
    result.takenAt = taken;
  }
  // Most underwater cameras do not record GPS, so this is often missing.
  if (Number.isFinite(tags?.latitude) && Number.isFinite(tags?.longitude)) {
    result.latitude = tags.latitude;
    result.longitude = tags.longitude;
  }
  return result;
}

// Returns { blob, width, height } for a resized JPEG with no metadata.
export async function preparePhoto(file) {
  let bitmap;
  try {
    // imageOrientation: "from-image" rotates phone photos the right way up
    // before we lose the EXIF orientation tag.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(
      `"${file.name}" could not be opened. If it is a HEIC photo from an iPhone, please share it as a JPEG instead.`
    );
  }

  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", jpegQuality));
  return { blob, width, height };
}
