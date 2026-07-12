// Geographic lookup tables for identity autofill.
//
// Custom-select / combobox widgets (react-select, MUI, Ant, …) commit a
// value only when the user types text that matches a rendered option and
// picks it — you cannot assign an ISO code to them. So when the pass
// entry stores `country: US` but the form's dropdown lists "United
// States", the filler must map code → display name before driving the
// widget. These tables provide that mapping (and the reverse, via the
// tolerant matcher in the fill code).
//
// Names are the COMMON web-form display forms (what dropdowns actually
// list), not the verbose ISO-official short names — e.g. "United States"
// not "United States of America", "South Korea" not "Korea, Republic
// of". The fill-side matcher also compares against the raw stored value,
// so an entry that already holds the full name still matches directly.

// ISO 3166-1 alpha-2 → common English display name.
export const COUNTRIES = Object.freeze({
  AF: "Afghanistan", AX: "Åland Islands", AL: "Albania", DZ: "Algeria",
  AS: "American Samoa", AD: "Andorra", AO: "Angola", AI: "Anguilla",
  AG: "Antigua and Barbuda", AR: "Argentina", AM: "Armenia", AW: "Aruba",
  AU: "Australia", AT: "Austria", AZ: "Azerbaijan", BS: "Bahamas",
  BH: "Bahrain", BD: "Bangladesh", BB: "Barbados", BY: "Belarus",
  BE: "Belgium", BZ: "Belize", BJ: "Benin", BM: "Bermuda", BT: "Bhutan",
  BO: "Bolivia", BA: "Bosnia and Herzegovina", BW: "Botswana", BR: "Brazil",
  BN: "Brunei", BG: "Bulgaria", BF: "Burkina Faso", BI: "Burundi",
  KH: "Cambodia", CM: "Cameroon", CA: "Canada", CV: "Cape Verde",
  KY: "Cayman Islands", CF: "Central African Republic", TD: "Chad",
  CL: "Chile", CN: "China", CO: "Colombia", KM: "Comoros",
  CG: "Congo - Brazzaville", CD: "Congo - Kinshasa", CR: "Costa Rica",
  CI: "Côte d’Ivoire", HR: "Croatia", CU: "Cuba", CW: "Curaçao",
  CY: "Cyprus", CZ: "Czechia", DK: "Denmark", DJ: "Djibouti",
  DM: "Dominica", DO: "Dominican Republic", EC: "Ecuador", EG: "Egypt",
  SV: "El Salvador", GQ: "Equatorial Guinea", ER: "Eritrea", EE: "Estonia",
  SZ: "Eswatini", ET: "Ethiopia", FJ: "Fiji", FI: "Finland", FR: "France",
  GF: "French Guiana", PF: "French Polynesia", GA: "Gabon", GM: "Gambia",
  GE: "Georgia", DE: "Germany", GH: "Ghana", GI: "Gibraltar", GR: "Greece",
  GL: "Greenland", GD: "Grenada", GP: "Guadeloupe", GU: "Guam",
  GT: "Guatemala", GG: "Guernsey", GN: "Guinea", GW: "Guinea-Bissau",
  GY: "Guyana", HT: "Haiti", HN: "Honduras", HK: "Hong Kong",
  HU: "Hungary", IS: "Iceland", IN: "India", ID: "Indonesia", IR: "Iran",
  IQ: "Iraq", IE: "Ireland", IM: "Isle of Man", IL: "Israel", IT: "Italy",
  JM: "Jamaica", JP: "Japan", JE: "Jersey", JO: "Jordan", KZ: "Kazakhstan",
  KE: "Kenya", KI: "Kiribati", XK: "Kosovo", KW: "Kuwait", KG: "Kyrgyzstan",
  LA: "Laos", LV: "Latvia", LB: "Lebanon", LS: "Lesotho", LR: "Liberia",
  LY: "Libya", LI: "Liechtenstein", LT: "Lithuania", LU: "Luxembourg",
  MO: "Macao", MG: "Madagascar", MW: "Malawi", MY: "Malaysia",
  MV: "Maldives", ML: "Mali", MT: "Malta", MH: "Marshall Islands",
  MQ: "Martinique", MR: "Mauritania", MU: "Mauritius", YT: "Mayotte",
  MX: "Mexico", FM: "Micronesia", MD: "Moldova", MC: "Monaco",
  MN: "Mongolia", ME: "Montenegro", MS: "Montserrat", MA: "Morocco",
  MZ: "Mozambique", MM: "Myanmar", NA: "Namibia", NR: "Nauru", NP: "Nepal",
  NL: "Netherlands", NC: "New Caledonia", NZ: "New Zealand", NI: "Nicaragua",
  NE: "Niger", NG: "Nigeria", NU: "Niue", NF: "Norfolk Island",
  KP: "North Korea", MK: "North Macedonia", MP: "Northern Mariana Islands",
  NO: "Norway", OM: "Oman", PK: "Pakistan", PW: "Palau",
  PS: "Palestinian Territories", PA: "Panama", PG: "Papua New Guinea",
  PY: "Paraguay", PE: "Peru", PH: "Philippines", PL: "Poland",
  PT: "Portugal", PR: "Puerto Rico", QA: "Qatar", RE: "Réunion",
  RO: "Romania", RU: "Russia", RW: "Rwanda", WS: "Samoa", SM: "San Marino",
  ST: "São Tomé and Príncipe", SA: "Saudi Arabia", SN: "Senegal",
  RS: "Serbia", SC: "Seychelles", SL: "Sierra Leone", SG: "Singapore",
  SX: "Sint Maarten", SK: "Slovakia", SI: "Slovenia", SB: "Solomon Islands",
  SO: "Somalia", ZA: "South Africa", KR: "South Korea", SS: "South Sudan",
  ES: "Spain", LK: "Sri Lanka", SD: "Sudan", SR: "Suriname", SE: "Sweden",
  CH: "Switzerland", SY: "Syria", TW: "Taiwan", TJ: "Tajikistan",
  TZ: "Tanzania", TH: "Thailand", TL: "Timor-Leste", TG: "Togo",
  TK: "Tokelau", TO: "Tonga", TT: "Trinidad and Tobago", TN: "Tunisia",
  TR: "Turkey", TM: "Turkmenistan", TC: "Turks and Caicos Islands",
  TV: "Tuvalu", UG: "Uganda", UA: "Ukraine", AE: "United Arab Emirates",
  GB: "United Kingdom", US: "United States", UY: "Uruguay",
  UZ: "Uzbekistan", VU: "Vanuatu", VA: "Vatican City", VE: "Venezuela",
  VN: "Vietnam", VG: "British Virgin Islands", VI: "U.S. Virgin Islands",
  WF: "Wallis and Futuna", EH: "Western Sahara", YE: "Yemen", ZM: "Zambia",
  ZW: "Zimbabwe",
});

// USPS two-letter code → US state / territory name (+ DC).
export const US_STATES = Object.freeze({
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia", PR: "Puerto Rico", GU: "Guam",
  VI: "U.S. Virgin Islands", AS: "American Samoa",
});

// Canadian province / territory code → name (common on job forms).
export const CA_PROVINCES = Object.freeze({
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba",
  NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut",
  ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec",
  SK: "Saskatchewan", YT: "Yukon",
});
