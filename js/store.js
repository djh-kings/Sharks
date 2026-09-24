// store.js
// Everything the app saves lives in IndexedDB, a database built into the browser.
// Nothing here needs a network connection, which is the point: a fisher at sea
// can save a report now and it waits on the phone until a server exists to take it.
//
// Three "object stores" (think: tables):
//   reports   finished reports, one per sighting or absence record
//   drafts    the report currently being filled in, so nothing is lost if the app closes
//   settings  small remembered values, eg the observer's role

const dbName = "sharkSightings";
const dbVersion = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);

    // Runs only when the database is first created, or dbVersion goes up.
    // If you add a new store later, increase dbVersion and create it here.
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("reports")) {
        const reports = db.createObjectStore("reports", { keyPath: "id" });
        reports.createIndex("syncStatus", "syncStatus");
      }
      if (!db.objectStoreNames.contains("drafts")) {
        db.createObjectStore("drafts", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

// IndexedDB uses callbacks; this wraps one request in a Promise so we can use await.
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(storeName, mode, action) {
  const db = await openDb();
  const transaction = db.transaction(storeName, mode);
  const result = await promisify(action(transaction.objectStore(storeName)));
  return result;
}

// ---- Reports ----

export function saveReport(report) {
  return withStore("reports", "readwrite", (store) => store.put(report));
}

export async function listReports() {
  const reports = await withStore("reports", "readonly", (store) => store.getAll());
  // Newest first.
  return reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getReport(id) {
  return withStore("reports", "readonly", (store) => store.get(id));
}

export function deleteReport(id) {
  return withStore("reports", "readwrite", (store) => store.delete(id));
}

export async function markSynced(id) {
  const report = await getReport(id);
  if (report) {
    report.syncStatus = "synced";
    await saveReport(report);
  }
}

export function countPending() {
  return withStore("reports", "readonly", (store) => store.index("syncStatus").count("pending"));
}

// ---- Draft (only one at a time) ----

const draftId = "current";

export function saveDraft(draft) {
  return withStore("drafts", "readwrite", (store) => store.put({ ...draft, id: draftId }));
}

export function loadDraft() {
  return withStore("drafts", "readonly", (store) => store.get(draftId));
}

export function clearDraft() {
  return withStore("drafts", "readwrite", (store) => store.delete(draftId));
}

// ---- Settings ----

export async function getSetting(key) {
  const row = await withStore("settings", "readonly", (store) => store.get(key));
  return row ? row.value : undefined;
}

export function setSetting(key, value) {
  return withStore("settings", "readwrite", (store) => store.put({ key, value }));
}

// A random ID for each report. Darwin Core calls this occurrenceID and it must
// be globally unique, so we use the browser's UUID generator.
export function newId() {
  return crypto.randomUUID();
}
