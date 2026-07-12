// Profile + credit-card autofill token model.
//
// Keys in the pass entry's `key: value` block are the WHATWG HTML
// autocomplete tokens — same vocabulary browsers already speak. The pass
// manager already round-trips them; the fill logic here maps from a target
// page's <input>/<select> to a token, then looks the token up in the
// entry. Token-first design means new fields are added by writing one
// `key: value` line in the pass store, no code change required.
//
// Token reference: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill

export const PROFILE_TOKENS = Object.freeze([
  // Names
  "name", "honorific-prefix", "given-name", "additional-name",
  "family-name", "honorific-suffix", "nickname",
  // Organization
  "organization", "organization-title",
  // Address
  "street-address", "address-line1", "address-line2", "address-line3",
  "address-level1", "address-level2", "address-level3", "address-level4",
  "country", "country-name", "postal-code",
  // Contact
  "email", "tel", "tel-country-code", "tel-national",
  "tel-area-code", "tel-local", "tel-extension",
  // Personal
  "bday", "bday-day", "bday-month", "bday-year",
  "sex", "url", "photo",
]);

export const CC_TOKENS = Object.freeze([
  "cc-name", "cc-given-name", "cc-additional-name", "cc-family-name",
  "cc-number", "cc-exp", "cc-exp-month", "cc-exp-year",
  "cc-csc", "cc-type",
]);

// Hyphen-separated fragments to look for in name/id/label/placeholder when
// the field has no autocomplete attribute. Longest match wins so that
// `cc-exp-month` beats `cc-exp` on a select element labeled "Exp Month".
export const TOKEN_SYNONYMS = Object.freeze({
  // ── Credit card ─────────────────────────────────────────────────
  "cc-number":     ["cc-number", "cc-num", "card-number", "cardnumber", "ccnumber",
                    "ccnum", "card-num", "cardnum", "creditcardnumber",
                    "creditcardnum", "credit-card-number"],
  "cc-csc":        ["cc-csc", "cvv", "cvc", "csc", "security-code", "securitycode",
                    "card-cvv", "card-cvc", "card-verification", "cv-number"],
  "cc-exp-month":  ["cc-exp-month", "exp-month", "expmonth", "expirymonth",
                    "expiry-month", "expirationmonth", "expiration-month",
                    "card-exp-month", "card-month", "cardmonth",
                    "cc-month", "ccexpmonth", "ccexp-month"],
  "cc-exp-year":   ["cc-exp-year", "exp-year", "expyear", "expiryyear",
                    "expiry-year", "expirationyear", "expiration-year",
                    "card-exp-year", "card-year", "cardyear",
                    "cc-year", "ccexpyear", "ccexp-year"],
  "cc-exp":        ["cc-exp", "exp-date", "expdate", "expiration", "expiry",
                    "cardexp", "card-expiry", "card-expiration"],
  "cc-name":       ["cc-name", "cardholder", "card-holder", "name-on-card",
                    "nameoncard", "cardname", "ccname", "holder-name"],
  "cc-given-name": ["cc-given-name", "cardholder-first", "card-first-name"],
  "cc-family-name":["cc-family-name", "cardholder-last",  "card-last-name"],
  "cc-type":       ["cc-type", "card-type", "cardtype", "card-brand", "cardbrand",
                    "cc-brand"],
  // ── Names ───────────────────────────────────────────────────────
  "given-name":    ["given-name", "first-name", "firstname", "fname", "givenname",
                    "first_name"],
  "additional-name": ["additional-name", "middle-name", "middlename", "mname",
                      "middle_name"],
  "family-name":   ["family-name", "last-name", "lastname", "lname", "surname",
                    "familyname", "last_name"],
  "honorific-prefix": ["honorific-prefix", "title-prefix", "name-prefix", "prefix",
                       "salutation"],
  "honorific-suffix": ["honorific-suffix", "name-suffix", "suffix"],
  "nickname":      ["nickname", "display-name", "displayname"],
  // (intentionally not synonymizing bare "name" — it's too ambiguous, the
  // field-level autocomplete=name attribute is the right signal there.)
  // ── Organization ────────────────────────────────────────────────
  "organization":  ["organization", "company", "employer", "company-name"],
  "organization-title": ["organization-title", "job-title", "jobtitle", "title-role"],
  // ── Address ─────────────────────────────────────────────────────
  "address-line1": ["address-line1", "addressline1", "address1", "addr1",
                    "street1", "street-address-1", "address_1"],
  "address-line2": ["address-line2", "addressline2", "address2", "addr2",
                    "street2", "street-address-2", "address_2"],
  "address-line3": ["address-line3", "addressline3", "address3", "addr3",
                    "street3", "address_3"],
  "street-address":["street-address", "streetaddress", "street", "address"],
  "address-level1":["state", "province", "region", "administrative-area",
                    "address-level1"],
  "address-level2":["city", "locality", "town", "address-level2"],
  "postal-code":   ["postal-code", "postalcode", "postcode", "zip", "zipcode",
                    "zip-code"],
  "country":       ["country", "country-code", "countrycode"],
  "country-name":  ["country-name", "countryname"],
  // ── Contact ─────────────────────────────────────────────────────
  "email":         ["email", "e-mail", "emailaddress", "email-address"],
  "tel":           ["tel", "phone", "telephone", "mobile", "phonenumber",
                    "phone-number", "mobile-number"],
  "tel-area-code": ["areacode", "area-code"],
  "tel-country-code": ["country-code-tel", "phone-country"],
  // ── Personal ────────────────────────────────────────────────────
  "bday":          ["birthday", "birthdate", "dob", "dateofbirth", "date-of-birth"],
  "bday-day":      ["birthday-day", "birthdate-day", "dob-day", "bday-day"],
  "bday-month":    ["birthday-month", "birthdate-month", "dob-month", "bday-month"],
  "bday-year":     ["birthday-year", "birthdate-year", "dob-year", "bday-year"],
});

// Normalize for haystack matching: lowercase + collapse [_\s] → '-'.
// Keep '-' as significant so 'cc-exp-month' doesn't collide with 'ccexpmonth'.
export function normalizeForMatch(s) {
  return String(s || "").toLowerCase().replace(/[_\s]+/g, "-");
}

// recognizeField({ autocomplete, name, id, label, placeholder, type })
// → token | null
//
// Order of precedence:
//   1. The HTML `autocomplete` attribute, if it carries a known token.
//      Supports composite values like "shipping street-address" and
//      "section-foo cc-number" — pick the first known token.
//   2. Longest-synonym substring match across name + id + label + placeholder.
//   3. Input type heuristic (email, tel).
export function recognizeField(spec) {
  const ac = String(spec?.autocomplete || "").trim().toLowerCase();
  const known = new Set([...PROFILE_TOKENS, ...CC_TOKENS]);
  if (ac) {
    if (known.has(ac)) return ac;
    for (const t of ac.split(/\s+/).filter(Boolean)) {
      if (known.has(t)) return t;
    }
    // Password opt-outs stay hard skips. `autocomplete="off"` does NOT:
    // custom-widget libraries (react-select, intl-tel-input, MUI, …) set
    // off on their internal inputs to suppress the browser's own dropdown,
    // and countless sites set it on ordinary fields. The user explicitly
    // pressed the fill hotkey, so off must fall through to name/label/type
    // recognition rather than veto it.
    if (ac === "current-password" || ac === "new-password") {
      return null;
    }
  }
  const hay = [spec?.name, spec?.id, spec?.label, spec?.placeholder]
    .map(normalizeForMatch).join(" ");
  let best = null;
  let bestLen = 0;
  for (const [token, syns] of Object.entries(TOKEN_SYNONYMS)) {
    for (const syn of syns) {
      const sn = normalizeForMatch(syn);
      if (hay.includes(sn) && sn.length > bestLen) {
        best  = token;
        bestLen = sn.length;
      }
    }
  }
  if (best) return best;
  const type = String(spec?.type || "").toLowerCase();
  if (type === "email") return "email";
  if (type === "tel")   return "tel";
  return null;
}

// expandFieldValue(token, fields) → string | null
// Derive a value for `token` from the entry's `fields` bag, including:
//   1. Direct lookup       — fields[token]
//   2. Synonym lookup      — any key in TOKEN_SYNONYMS[token] (so the user can
//                            write `city: …` instead of `address-level2: …`
//                            in their pass entry and the recognizer still
//                            finds it)
//   3. Alias chains        — cc-exp ← cc-exp-month + cc-exp-year, name ← given
//                            + family, given/family ← split of name,
//                            street-address ← line1+line2+line3
//   4. null
export function expandFieldValue(token, fields) {
  if (!token || !fields) return null;
  const direct = fields[token];
  if (direct != null && direct !== "") return String(direct);
  // Synonym lookup — friendly names in the pass entry resolve to the
  // canonical token the page's <input autocomplete=…> expects.
  const syns = TOKEN_SYNONYMS[token];
  if (syns) {
    for (const syn of syns) {
      if (syn === token) continue;
      const v = fields[syn];
      if (v != null && v !== "") return String(v);
    }
  }
  switch (token) {
    case "cc-exp": {
      const m = fields["cc-exp-month"];
      const y = fields["cc-exp-year"];
      if (m && y) return `${pad2(m)}/${String(y).slice(-2)}`;
      return null;
    }
    case "cc-exp-month": {
      const exp = String(fields["cc-exp"] || "");
      const m = exp.match(/^(\d{1,2})[\/-]/);
      return m ? pad2(m[1]) : null;
    }
    case "cc-exp-year": {
      const exp = String(fields["cc-exp"] || "");
      const m = exp.match(/[\/-](\d{2,4})$/);
      return m ? m[1] : null;
    }
    case "name": {
      const parts = [fields["given-name"], fields["additional-name"], fields["family-name"]]
        .filter(Boolean);
      return parts.length ? parts.join(" ") : null;
    }
    case "cc-name": {
      const direct2 = fields["name"];
      if (direct2) return String(direct2);
      const parts = [fields["cc-given-name"], fields["cc-family-name"]].filter(Boolean);
      if (parts.length) return parts.join(" ");
      const np = [fields["given-name"], fields["family-name"]].filter(Boolean);
      return np.length ? np.join(" ") : null;
    }
    case "given-name": {
      const n = String(fields["name"] || "").trim();
      return n ? n.split(/\s+/)[0] : null;
    }
    case "family-name": {
      const n = String(fields["name"] || "").trim();
      if (!n) return null;
      const parts = n.split(/\s+/);
      return parts.length > 1 ? parts[parts.length - 1] : null;
    }
    case "street-address": {
      const lines = [fields["address-line1"], fields["address-line2"], fields["address-line3"]]
        .filter(Boolean);
      return lines.length ? lines.join("\n") : null;
    }
    case "address-line1": {
      const street = String(fields["street-address"] || "");
      return street ? street.split("\n")[0] : null;
    }
    case "country-name":
      return fields["country"] != null ? String(fields["country"]) : null;
    default:
      return null;
  }
}

function pad2(v) {
  const s = String(v ?? "");
  return s.length === 1 ? `0${s}` : s;
}
