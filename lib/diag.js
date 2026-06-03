// zpwrchrome — extension-side diagnostic ring buffer.
//
// Every bp* / NM call funnels through this; lines also go to console.warn
// with a "[ZPC-DIAG]" tag so they're visible in the SW DevTools without
// opening the Diagnostics page. The ring buffer is capped at 500 entries
// and lives in chrome.storage.local["zpc.diag"], so it survives SW restarts.

const KEY = "zpc.diag";
const CAP = 500;
const TAG = "[ZPC-DIAG]";

function nowISO() {
  return new Date().toISOString();
}

export async function diagPush(label, fields = {}) {
  const ts   = nowISO();
  const line = { ts, label, ...fields };
  try {
    const bag = await chrome.storage.local.get(KEY);
    const buf = Array.isArray(bag?.[KEY]) ? bag[KEY] : [];
    buf.push(line);
    if (buf.length > CAP) buf.splice(0, buf.length - CAP);
    await chrome.storage.local.set({ [KEY]: buf });
  } catch {}
  try { console.warn(TAG, label, fields); } catch {}
}

export async function diagRead() {
  try {
    const bag = await chrome.storage.local.get(KEY);
    return Array.isArray(bag?.[KEY]) ? bag[KEY] : [];
  } catch { return []; }
}

export async function diagClear() {
  try { await chrome.storage.local.remove(KEY); } catch {}
}
