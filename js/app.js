// app.js
// Code shared by every page: the offline banner, the pending-report counter,
// and registering the service worker (which is what makes the site work offline).

import { countPending } from "./store.js";
import { numberInWords } from "./format.js";

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  }
}

function updateOnlineBanner() {
  const banner = document.getElementById("offlineBanner");
  if (banner) {
    banner.hidden = navigator.onLine;
  }
}

export async function updatePendingCount() {
  const pending = await countPending();
  for (const element of document.querySelectorAll("[data-pending-count]")) {
    element.textContent = numberInWords(pending);
  }
  for (const element of document.querySelectorAll("[data-pending-noun]")) {
    element.textContent = pending === 1 ? "report" : "reports";
  }
  for (const element of document.querySelectorAll("[data-pending-verb]")) {
    element.textContent = pending === 1 ? "is" : "are";
  }
  for (const element of document.querySelectorAll("[data-pending-visible]")) {
    element.hidden = pending === 0;
  }
  return pending;
}

registerServiceWorker();
updateOnlineBanner();
window.addEventListener("online", updateOnlineBanner);
window.addEventListener("offline", updateOnlineBanner);
updatePendingCount();
