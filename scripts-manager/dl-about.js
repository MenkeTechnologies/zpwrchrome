// zpwrchrome — About page; reads version from chrome.runtime.getManifest().
const $ver = document.getElementById("ver");
if ($ver && chrome?.runtime?.getManifest) {
  try { $ver.textContent = chrome.runtime.getManifest().version || "(unknown)"; }
  catch { $ver.textContent = "(unknown)"; }
}
