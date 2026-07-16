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

// Normalize an attribute string to a canonical hyphen-delimited form so
// one rule matches every real-world spelling of a field name:
//   1. split camelCase / PascalCase  (addressLine1 → address-Line1)
//   2. lowercase
//   3. collapse every run of non-alphanumerics to a single '-'
//      (covers spaces, '_', '.', '[', ']', '/', ':' — so nested framework
//       names like `address.line1`, `billing[postcode]`,
//       `checkout[shipping_address][zip]`, `address_line_1` all canonicalize)
//   4. trim leading/trailing '-'
// '-' stays significant (word boundary) so `\bcity\b` never fires inside
// "capacity"/"electricity" and `cc-exp-month` doesn't collide with a bare
// month. The FIELD_RULES below are written against this canonical form.
export function normalizeForMatch(s) {
  return String(s ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// FIELD_RULE_SOURCES — ordered [token, regexSource] pairs, the field
// recognizer's core. Ported from the browser autofill heuristics that are
// the de-facto spec for "every real-world spelling of a form field":
// Firefox's HeuristicsRegExp (toolkit/components/formautofill) and
// Chromium's autofill regex patterns (components/autofill/.../form_parsing).
//
// Every source is matched against the space-joined normalizeForMatch()
// output of name/id/label/placeholder — i.e. the canonical hyphen form —
// so `\b` sits on real word boundaries and camelCase / dotted / bracketed
// names are already flattened. Chrome/V8 supports lookbehind & lookahead,
// so the collision guards are ported verbatim (state ≠ "united states",
// unit ≠ "unite", field ≠ "fields").
//
// ORDER IS PRECEDENCE — the first rule whose regex matches wins. So the
// specific beats the general: cc-exp-month/year before cc-exp; the leaf
// address tokens (city/state/zip/country) before the catch-all
// street-address; every name-part + cc-name before the generic full "name";
// email/tel-parts before the words they contain. Never reorder casually.
export const FIELD_RULE_SOURCES = Object.freeze([
  // ── Credit card (most specific first) ──
  ["cc-number",     "(?:card|cc|acct|credit-?card)-?(?:number|num|no|pan)\\b|\\bcc-?nr\\b|\\bpan\\b"],
  ["cc-csc",        "\\b(?:cvv|cvc|csc|cvn|cvd|ccv|cid|cccid)\\b|card-?verification|verification-?(?:code|number|value)|security-?(?:code|number|value)|card-?identification|card-?code|card-?pin|c-v-v"],
  ["cc-exp-month",  "\\bmonth\\b|(?:exp|expiry|expiration|valid|card|cc)-?mo(?:nth)?\\b|cc-?month|card-?month|exp-?mm\\b|^mm$"],
  ["cc-exp-year",   "\\byear\\b|(?:exp|expiry|expiration|valid|card|cc)-?yr\\b|cc-?year|card-?year|exp-?yy\\b|^yy$|^yyyy$"],
  ["cc-exp",        "\\bexp(?:iry|iration)?\\b|exp-?date|\\bexpfield\\b|valid(?:ity|thru|until)|\\bmm-?yy(?:yy)?\\b|payment-?(?:card|cc)-?(?:exp|date)"],
  ["cc-type",       "\\bcc-?type\\b|card-?type|card-?brand|cc-?brand|cb-?type"],
  ["cc-name",       "cardholder|card-?holder|card-?owner|name-?on-?card|(?:cc|card)-?(?:full-?)?name|holder-?name|accountholdername"],
  // ── Contact ──
  ["email",             "\\be-?mail\\b|e-?mail-?address|\\bcourriel\\b"],
  ["tel-country-code",  "phone.*country|country.*phone|tel.*country|country.*tel|phone-?code|\\bccode\\b|country-?code-?tel"],
  ["tel-extension",     "\\bext(?:ension)?\\b"],
  ["tel-area-code",     "area-?code|\\bacode\\b"],
  ["tel",               "\\bphone\\b|\\bmobile\\b|\\btel(?:ephone)?\\b|phone-?number|mobile-?(?:phone|number)|contact-?number|\\bcell(?:phone)?\\b"],
  // ── Name (parts before the generic full name) ──
  ["honorific-prefix",  "\\bsalutation\\b|honorific-?prefix|name-?prefix|name-?title|title-?prefix|^title$"],
  ["honorific-suffix",  "honorific-?suffix|name-?suffix|\\bsuffix\\b"],
  ["given-name",        "\\b(?:first|given|fore)-?name\\b|\\bf-?name\\b|\\bfname\\b|first-?n\\b|\\bgivenname\\b|\\binitials\\b|\\bvorname\\b|\\bprenom\\b"],
  ["additional-name",   "\\b(?:middle|additional)-?name\\b|\\bm-?name\\b|\\bmname\\b|middle-?initial|middle-?n\\b|\\bmi\\b"],
  ["family-name",       "\\b(?:last|family|sur)-?name\\b|\\bl-?name\\b|\\blname\\b|\\bsur(?:name|ename)\\b|second-?name\\b|\\bnachname\\b|\\bapellido\\b"],
  ["nickname",          "\\bnickname\\b|display-?name"],
  // ── Organization ──
  ["organization-title","job-?title|\\bjobtitle\\b|title-?role|organization-?title"],
  ["organization",      "\\bcompany\\b|company-?name|\\bbusiness\\b|\\borganization\\b|\\borganisation\\b|\\bemployer\\b|\\bfirma\\b"],
  // ── Address (specific lines, then leaf tokens, then catch-all street) ──
  ["address-line3",     "address-?line-?(?:3|three)|address-?3\\b|addr-?3\\b|street-?3\\b|\\baddrline3\\b|\\baddl3\\b|\\bline-?3\\b"],
  ["address-line2",     "address-?line-?(?:2|two)|address-?2\\b|addr-?2\\b|street-?2\\b|\\baddrline2\\b|\\baddl2\\b|\\bline-?2\\b|\\bsuite\\b|\\bunit(?!e)\\b|\\bapt\\b|apartment|\\bflat\\b|extended-?address|\\blandmark\\b"],
  ["address-line1",     "address-?line-?(?:1|one)?\\b|address-?1\\b|addr-?1\\b|street-?1\\b|\\baddrline1\\b|\\baddl1\\b|\\bline-?1\\b|house-?name|house-?number|street-?number"],
  ["address-level2",    "\\b(?:city|town|suburb|locality|village)\\b|address-?level-?2|address-?city|address-?town|\\bort\\b"],
  ["address-level1",    "(?<!united-?)(?<!hist-?)(?<!history-?)\\bstates?\\b|\\bprovince\\b|\\bprovence\\b|\\bregion\\b|\\bcounty\\b|\\bprincipality\\b|address-?level-?1|address-?state|address-?province|administrative-?area(?:-?level-?1)?|country-?region"],
  ["postal-code",       "\\bzip\\b|zip-?code|\\bpostal\\b|postal-?code|post-?code|\\bpostcode\\b|\\bpcode\\b|pin-?code|address-?(?:zip|postal)|\\bplz\\b"],
  ["country-name",      "country-?name|country-?full-?name"],
  ["country",           "\\bcountr(?:y|ies)\\b|country-?code|address-?country"],
  ["street-address",    "\\bstreet-?address\\b|\\bstreetaddress\\b|\\bstreet\\b|\\baddress\\b|\\baddr\\b|\\broute\\b"],
  // ── Personal ──
  ["bday",              "\\bbirth-?day\\b|\\bbirth-?date\\b|\\bdob\\b|date-?of-?birth"],
  ["sex",               "\\bgender\\b|\\bsex\\b"],
  ["url",               "\\bwebsite\\b|\\bhomepage\\b|\\bweb-?site\\b"],
  // ── Full name (generic — LAST, after all name-parts / org / cc-name) ──
  ["name",              "^name$|full-?name|your-?name|customer-?name|contact-?name|(?:bill|ship)-?name|firstandlastname|\\breceiver\\b"],
]);

// Compile once (module scope). Flags: 'u' for well-formed unicode; the
// haystack is pre-lowercased so no 'i' needed.
const COMPILED_FIELD_RULES = FIELD_RULE_SOURCES.map(([token, src]) => [token, new RegExp(src, "u")]);
const KNOWN_TOKENS = new Set([...PROFILE_TOKENS, ...CC_TOKENS]);

// matchFieldRules(parts, compiled) → token | null
// parts: already-normalized attribute strings. First rule to match wins.
// Exported (with compileFieldRules) so background.js's page-injected
// recognizers share the exact ruleset instead of a divergent copy.
export function matchFieldRules(parts, compiled) {
  const hay = parts.filter(Boolean).join(" ");
  if (!hay) return null;
  for (const [token, re] of compiled) {
    if (re.test(hay)) return token;
  }
  return null;
}

// compileFieldRules(sources) → [[token, RegExp], …]. sources default to the
// module set; the injected functions pass the serialized FIELD_RULE_SOURCES
// (RegExp objects don't survive structured-clone into the page).
export function compileFieldRules(sources = FIELD_RULE_SOURCES) {
  return sources.map(([token, src]) => [token, new RegExp(src, "u")]);
}

// recognizeField({ autocomplete, name, id, label, placeholder, type })
// → token | null
//
// Order of precedence:
//   1. The HTML `autocomplete` attribute, if it carries a known token.
//      Supports composite values like "shipping street-address" and
//      "section-foo cc-number" — pick the first known token.
//   2. FIELD_RULES regex match across name + id + label + placeholder.
//   3. Input type heuristic (email, tel).
export function recognizeField(spec) {
  const ac = String(spec?.autocomplete || "").trim().toLowerCase();
  if (ac) {
    if (KNOWN_TOKENS.has(ac)) return ac;
    for (const t of ac.split(/\s+/).filter(Boolean)) {
      if (KNOWN_TOKENS.has(t)) return t;
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
  const parts = [spec?.name, spec?.id, spec?.label, spec?.placeholder].map(normalizeForMatch);
  const token = matchFieldRules(parts, COMPILED_FIELD_RULES);
  if (token) return token;
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
