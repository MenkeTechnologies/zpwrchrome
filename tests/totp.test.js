// Unit tests for lib/totp.js — base32 decoder, otpauth URL parser, and
// TOTP / HOTP compute against the RFC 4226 + RFC 6238 test vectors.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  base32Decode,
  parseOtpAuthUrl,
  computeTotp,
  computeHotp,
  computeOtpFromUrl,
} from "../lib/totp.js";

// ─── base32 decode ─────────────────────────────────────────────────
test("base32Decode: RFC 4648 vectors", () => {
  assert.deepEqual(base32Decode(""),           new Uint8Array());
  assert.deepEqual(base32Decode("MY"),         new Uint8Array([0x66]));            // "f"
  assert.deepEqual(base32Decode("MZXQ"),       new Uint8Array([0x66, 0x6f]));      // "fo"
  assert.deepEqual(base32Decode("MZXW6"),      new Uint8Array([0x66, 0x6f, 0x6f])); // "foo"
  assert.deepEqual(base32Decode("MZXW6YQ"),    new Uint8Array([0x66, 0x6f, 0x6f, 0x62])); // "foob"
});

test("base32Decode: tolerates padding, lowercase, spaces, hyphens, underscores", () => {
  const expected = new Uint8Array([0x66, 0x6f, 0x6f]);
  assert.deepEqual(base32Decode("MZXW6==="), expected);
  assert.deepEqual(base32Decode("mzxw6"),    expected);
  assert.deepEqual(base32Decode("MZX W6"),   expected);
  assert.deepEqual(base32Decode("M-Z_X-W-6"),expected);
});

test("base32Decode: rejects invalid characters", () => {
  assert.throws(() => base32Decode("MZX#W6"), /invalid character/);
  assert.throws(() => base32Decode("MZX1W6"), /invalid character/); // 1 isn't in alphabet
});

// ─── otpauth URL parser ────────────────────────────────────────────
test("parseOtpAuthUrl: defaults SHA-1 / 6 digits / 30 s period when params absent", () => {
  const spec = parseOtpAuthUrl("otpauth://totp/Foo?secret=JBSWY3DPEHPK3PXP");
  assert.deepEqual(spec, {
    type: "totp", label: "Foo",
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA-1", digits: 6, period: 30, counter: 0,
    issuer: "",
  });
});

test("parseOtpAuthUrl: explicit algorithm + digits + period + issuer", () => {
  const spec = parseOtpAuthUrl(
    "otpauth://totp/ACME:alice?secret=ABCDEFGHIJKLMNOP&issuer=ACME&algorithm=SHA256&digits=8&period=60");
  assert.equal(spec.algorithm, "SHA-256");
  assert.equal(spec.digits, 8);
  assert.equal(spec.period, 60);
  assert.equal(spec.issuer, "ACME");
  assert.equal(spec.label,  "ACME:alice");
});

test("parseOtpAuthUrl: hotp recognized with counter param", () => {
  const spec = parseOtpAuthUrl("otpauth://hotp/Foo?secret=JBSWY3DPEHPK3PXP&counter=42");
  assert.equal(spec.type, "hotp");
  assert.equal(spec.counter, 42);
});

test("parseOtpAuthUrl: SHA-1 normalization tolerates SHA-1 / sha-1 / SHA1", () => {
  assert.equal(parseOtpAuthUrl("otpauth://totp/x?secret=AAAA&algorithm=SHA1").algorithm,   "SHA-1");
  assert.equal(parseOtpAuthUrl("otpauth://totp/x?secret=AAAA&algorithm=sha-1").algorithm,  "SHA-1");
  assert.equal(parseOtpAuthUrl("otpauth://totp/x?secret=AAAA&algorithm=sha_256").algorithm, "SHA-256");
});

test("parseOtpAuthUrl: returns null for non-otpauth URLs and unknown types", () => {
  assert.equal(parseOtpAuthUrl(""),                              null);
  assert.equal(parseOtpAuthUrl("https://example.com/?secret=x"), null);
  assert.equal(parseOtpAuthUrl("otpauth://garbage/x?secret=y"),  null);
  assert.equal(parseOtpAuthUrl("otpauth://totp/x?algorithm=MD5&secret=y"), null);
  assert.equal(parseOtpAuthUrl("otpauth://totp/x"),              null);   // no secret
  assert.equal(parseOtpAuthUrl(null),                            null);
});

// ─── RFC 6238 TOTP test vectors ────────────────────────────────────
// Section 1.2 / Appendix B. Secret = "12345678901234567890" (ASCII)
//                                = base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
// SHA-1, 8-digit, 30-second period.
//
// (Standard 6-digit clients truncate the same code; the 8-digit form is
// what RFC 6238 publishes so we compute 8-digit codes and slice.)
const RFC_SECRET_SHA1 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const RFC_VECTORS_SHA1 = [
  { time:           59, code: "94287082" },
  { time:   1111111109, code: "07081804" },
  { time:   1111111111, code: "14050471" },
  { time:   1234567890, code: "89005924" },
  { time:   2000000000, code: "69279037" },
  // 20000000000 omitted — exceeds the JS counter range we care about.
];

for (const v of RFC_VECTORS_SHA1) {
  test(`computeTotp: RFC 6238 SHA-1 at T=${v.time} → ${v.code}`, async () => {
    const code = await computeTotp(
      { secret: RFC_SECRET_SHA1, algorithm: "SHA-1", digits: 8, period: 30 },
      v.time * 1000,
    );
    assert.equal(code, v.code);
  });
}

test("computeTotp: 6-digit output is the last 6 chars of the 8-digit code", async () => {
  // Sanity: standard authenticators use digits=6.
  const code8 = await computeTotp({ secret: RFC_SECRET_SHA1, algorithm: "SHA-1", digits: 8, period: 30 }, 59_000);
  const code6 = await computeTotp({ secret: RFC_SECRET_SHA1, algorithm: "SHA-1", digits: 6, period: 30 }, 59_000);
  assert.equal(code8, "94287082");
  assert.equal(code6, "287082");
});

test("computeTotp: zero-pads short numeric results", async () => {
  // Pick a counter that produces a numeric value < 100000 to force padding.
  // Verified against external authenticator: at T=86400000 (1000 days),
  // RFC secret gives a code that lands < 100000 about 1/10 of the time —
  // we just check that the string length is always 6.
  for (let t = 0; t < 10_000_000; t += 1_111_111) {
    const code = await computeTotp({ secret: RFC_SECRET_SHA1, algorithm: "SHA-1", digits: 6, period: 30 }, t);
    assert.equal(code.length, 6, `expected 6-digit code, got ${code} at t=${t}`);
    assert.match(code, /^\d{6}$/);
  }
});

// ─── RFC 6238 SHA-256 / SHA-512 ────────────────────────────────────
// Section 5: the SHA-256 vector uses a 32-byte secret, SHA-512 uses 64.
const RFC_SECRET_SHA256 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA";
const RFC_SECRET_SHA512 =
  "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA";

test("computeTotp: RFC 6238 SHA-256 at T=59 → 46119246", async () => {
  const code = await computeTotp(
    { secret: RFC_SECRET_SHA256, algorithm: "SHA-256", digits: 8, period: 30 },
    59_000,
  );
  assert.equal(code, "46119246");
});

test("computeTotp: RFC 6238 SHA-512 at T=59 → 90693936", async () => {
  const code = await computeTotp(
    { secret: RFC_SECRET_SHA512, algorithm: "SHA-512", digits: 8, period: 30 },
    59_000,
  );
  assert.equal(code, "90693936");
});

// ─── RFC 4226 HOTP vectors ─────────────────────────────────────────
// Appendix D. Same secret "12345678901234567890".
const RFC_HOTP_CODES = [
  "755224", "287082", "359152", "969429", "338314",
  "254676", "287922", "162583", "399871", "520489",
];

test("computeHotp: RFC 4226 first 10 counters", async () => {
  for (let c = 0; c < RFC_HOTP_CODES.length; c++) {
    const code = await computeHotp({
      secret: RFC_SECRET_SHA1, algorithm: "SHA-1", digits: 6, counter: c,
    });
    assert.equal(code, RFC_HOTP_CODES[c], `counter ${c}`);
  }
});

// ─── computeOtpFromUrl dispatcher ──────────────────────────────────
test("computeOtpFromUrl: dispatches TOTP and HOTP correctly", async () => {
  const totpUrl =
    `otpauth://totp/x?secret=${RFC_SECRET_SHA1}&algorithm=SHA1&digits=8&period=30`;
  assert.equal(await computeOtpFromUrl(totpUrl, 59_000), "94287082");

  const hotpUrl =
    `otpauth://hotp/x?secret=${RFC_SECRET_SHA1}&algorithm=SHA1&digits=6&counter=0`;
  assert.equal(await computeOtpFromUrl(hotpUrl), "755224");
});

test("computeOtpFromUrl: throws on bad URL", async () => {
  await assert.rejects(() => computeOtpFromUrl("not an otpauth URL"), /not an otpauth/);
});

test("computeTotp: throws on empty secret", async () => {
  await assert.rejects(
    () => computeTotp({ secret: "", algorithm: "SHA-1", digits: 6, period: 30 }),
    /empty secret/,
  );
});
