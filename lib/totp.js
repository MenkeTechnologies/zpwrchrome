// TOTP / HOTP code computation per RFC 6238 + RFC 4226.
//
// Generates the current code from an `otpauth://` URL using Web Crypto
// (HMAC-SHA1/256/512). Runs entirely in the extension — no shell-out to
// `pass otp`, so no dependency on the pass-otp extension being installed
// and no Chrome-spawned-host PATH issues (`pass` is typically installed
// at /opt/homebrew/bin/pass or /usr/local/bin/pass, neither of which is
// in the host's PATH when Chrome launches it).
//
// Wire:
//   const otp = await computeTotpFromUrl("otpauth://totp/foo?secret=ABC…");
//   // → "123456"

// RFC 4648 base32 alphabet (uppercase, no padding required by RFC for
// otpauth secrets but tolerated either way). Allows lowercase + ignores
// spaces / hyphens / underscores commonly added by humans for legibility.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input) {
  const clean = String(input || "")
    .toUpperCase()
    .replace(/=+$/, "")
    .replace(/[\s\-_]/g, "");
  if (!clean) return new Uint8Array(0);
  if (!/^[A-Z2-7]+$/.test(clean)) {
    throw new Error(`base32: invalid character in ${JSON.stringify(input)}`);
  }
  const out = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let bits = 0;
  let value = 0;
  let idx = 0;
  for (let i = 0; i < clean.length; i++) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(clean[i]);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[idx++] = (value >>> bits) & 0xff;
    }
  }
  return out;
}

// parseOtpAuthUrl(url) → { type, label, secret, algorithm, digits, period, counter, issuer }
// or null if the URL isn't an otpauth:// URI.
export function parseOtpAuthUrl(url) {
  const s = String(url || "").trim();
  if (!/^otpauth:\/\//i.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "otpauth:") return null;
  const type = (u.host || "").toLowerCase();          // totp | hotp
  if (type !== "totp" && type !== "hotp") return null;
  const label = decodeURIComponent(u.pathname.replace(/^\//, ""));
  const p = u.searchParams;
  const secret = (p.get("secret") || "").replace(/\s+/g, "");
  if (!secret) return null;
  const algRaw = (p.get("algorithm") || "SHA1").toUpperCase().replace(/[-_]/g, "");
  const algorithm =
    algRaw === "SHA1"   ? "SHA-1"   :
    algRaw === "SHA256" ? "SHA-256" :
    algRaw === "SHA512" ? "SHA-512" :
    null;
  if (!algorithm) return null;
  const digits  = clampInt(p.get("digits"),  6, 1, 10);
  const period  = clampInt(p.get("period"),  30, 1, 600);
  const counter = clampInt(p.get("counter"), 0, 0, Number.MAX_SAFE_INTEGER);
  const issuer  = p.get("issuer") || "";
  return { type, label, secret, algorithm, digits, period, counter, issuer };
}

function clampInt(raw, def, lo, hi) {
  if (raw == null) return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}

// Convert a 64-bit unsigned counter into an 8-byte big-endian buffer.
function counterBytes(counter) {
  const buf = new Uint8Array(8);
  // JS number is 53-bit safe — well above the year-3000 TOTP counter.
  // Upper 32 bits:
  let high = Math.floor(counter / 0x1_0000_0000);
  let low  = counter >>> 0;
  for (let i = 3; i >= 0; i--) { buf[i]     = high & 0xff; high >>>= 8; }
  for (let i = 7; i >= 4; i--) { buf[i]     = low  & 0xff; low  >>>= 8; }
  return buf;
}

// hotp(secretBytes, counter, algorithm, digits) → string
// RFC 4226: HMAC-SHA1 → dynamic truncation → decimal modulo.
async function hotp(secretBytes, counter, algorithm, digits) {
  const key = await crypto.subtle.importKey(
    "raw", secretBytes,
    { name: "HMAC", hash: algorithm },
    false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes(counter)));
  const offset = sig[sig.length - 1] & 0x0f;
  const binCode =
    ((sig[offset]     & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) <<  8) |
     (sig[offset + 3] & 0xff);
  const code = binCode % (10 ** digits);
  return String(code).padStart(digits, "0");
}

// computeTotp({ secret, algorithm, digits, period }, nowMs?) → "123456"
export async function computeTotp(spec, nowMs) {
  const sec = base32Decode(spec.secret);
  if (sec.length === 0) throw new Error("totp: empty secret after base32 decode");
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const counter = Math.floor(now / 1000 / (spec.period || 30));
  return hotp(sec, counter, spec.algorithm || "SHA-1", spec.digits || 6);
}

// computeHotp({ secret, algorithm, digits, counter }) → "123456"
export async function computeHotp(spec) {
  const sec = base32Decode(spec.secret);
  if (sec.length === 0) throw new Error("hotp: empty secret after base32 decode");
  return hotp(sec, spec.counter | 0, spec.algorithm || "SHA-1", spec.digits || 6);
}

// computeTotpFromUrl(otpauthUrl, nowMs?) → "123456"
// Convenience: parse + dispatch (TOTP or HOTP). Throws on parse failure.
export async function computeOtpFromUrl(otpauthUrl, nowMs) {
  const spec = parseOtpAuthUrl(otpauthUrl);
  if (!spec) throw new Error(`otp: not an otpauth:// URL: ${otpauthUrl}`);
  if (spec.type === "totp") return computeTotp(spec, nowMs);
  return computeHotp(spec);
}
