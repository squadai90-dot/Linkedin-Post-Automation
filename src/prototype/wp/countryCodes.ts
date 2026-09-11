/* Country name → the two-letter code the 5471 instructions ask for.
 *
 * These are the FIPS 10-4 codes the IRS prints in its own country list, NOT
 * ISO 3166: the IRS wants CJ for the Cayman Islands where ISO says KY, SZ for
 * Switzerland where ISO says CH, and UK for the United Kingdom where ISO says
 * GB. Using the ISO code would put a real-looking wrong answer on the form,
 * which is worse than a blank, so the table is the IRS list and nothing is
 * derived from the name.
 *
 * An unknown name returns null and the cell is left for the preparer. Guessing
 * from a prefix is how "Niger" becomes "Nigeria".
 */

/** IRS country codes, keyed by the lowercase country name. */
export const IRS_COUNTRY_CODES: Record<string, string> = {
  "afghanistan": "AF", "albania": "AL", "algeria": "AG", "andorra": "AN",
  "angola": "AO", "anguilla": "AV", "antigua and barbuda": "AC",
  "argentina": "AR", "armenia": "AM", "aruba": "AA", "australia": "AS",
  "austria": "AU", "azerbaijan": "AJ", "bahamas": "BF", "bahrain": "BA",
  "bangladesh": "BG", "barbados": "BB", "belarus": "BO", "belgium": "BE",
  "belize": "BH", "benin": "BN", "bermuda": "BD", "bhutan": "BT",
  "bolivia": "BL", "bosnia and herzegovina": "BK", "botswana": "BC",
  "brazil": "BR", "british virgin islands": "VI", "brunei": "BX",
  "bulgaria": "BU", "burkina faso": "UV", "burundi": "BY", "cambodia": "CB",
  "cameroon": "CM", "canada": "CA", "cape verde": "CV",
  "cayman islands": "CJ", "central african republic": "CT", "chad": "CD",
  "chile": "CI", "china": "CH", "colombia": "CO", "comoros": "CN",
  "congo": "CF", "democratic republic of the congo": "CG",
  "cook islands": "CW", "costa rica": "CS", "croatia": "HR", "cuba": "CU",
  "curacao": "UC", "cyprus": "CY", "czech republic": "EZ", "czechia": "EZ",
  "denmark": "DA", "djibouti": "DJ", "dominica": "DO",
  "dominican republic": "DR", "ecuador": "EC", "egypt": "EG",
  "el salvador": "ES", "equatorial guinea": "EK", "eritrea": "ER",
  "estonia": "EN", "eswatini": "WZ", "ethiopia": "ET", "fiji": "FJ",
  "finland": "FI", "france": "FR", "french polynesia": "FP", "gabon": "GB",
  "gambia": "GA", "georgia": "GG", "germany": "GM", "ghana": "GH",
  "gibraltar": "GI", "greece": "GR", "greenland": "GL", "grenada": "GJ",
  "guatemala": "GT", "guernsey": "GK", "guinea": "GV", "guinea-bissau": "PU",
  "guyana": "GY", "haiti": "HA", "honduras": "HO", "hong kong": "HK",
  "hungary": "HU", "iceland": "IC", "india": "IN", "indonesia": "ID",
  "iran": "IR", "iraq": "IZ", "ireland": "EI", "isle of man": "IM",
  "israel": "IS", "italy": "IT", "ivory coast": "IV", "cote d'ivoire": "IV",
  "jamaica": "JM", "japan": "JA", "jersey": "JE", "jordan": "JO",
  "kazakhstan": "KZ", "kenya": "KE", "kiribati": "KR", "kosovo": "KV",
  "kuwait": "KU", "kyrgyzstan": "KG", "laos": "LA", "latvia": "LG",
  "lebanon": "LE", "lesotho": "LT", "liberia": "LI", "libya": "LY",
  "liechtenstein": "LS", "lithuania": "LH", "luxembourg": "LU",
  "macau": "MC", "madagascar": "MA", "malawi": "MI", "malaysia": "MY",
  "maldives": "MV", "mali": "ML", "malta": "MT", "marshall islands": "RM",
  "mauritania": "MR", "mauritius": "MP", "mexico": "MX", "micronesia": "FM",
  "moldova": "MD", "monaco": "MN", "mongolia": "MG", "montenegro": "MJ",
  "montserrat": "MH", "morocco": "MO", "mozambique": "MZ", "myanmar": "BM",
  "burma": "BM", "namibia": "WA", "nauru": "NR", "nepal": "NP",
  "netherlands": "NL", "new caledonia": "NC", "new zealand": "NZ",
  "nicaragua": "NU", "niger": "NG", "nigeria": "NI", "north macedonia": "MK",
  "norway": "NO", "oman": "MU", "pakistan": "PK", "palau": "PS",
  "panama": "PM", "papua new guinea": "PP", "paraguay": "PA", "peru": "PE",
  "philippines": "RP", "poland": "PL", "portugal": "PO", "qatar": "QA",
  "romania": "RO", "russia": "RS", "rwanda": "RW",
  "saint kitts and nevis": "SC", "saint lucia": "ST",
  "saint vincent and the grenadines": "VC", "samoa": "WS", "san marino": "SM",
  "sao tome and principe": "TP", "netherlands antilles": "NT",
  "saudi arabia": "SA", "senegal": "SG", "serbia": "RI", "seychelles": "SE",
  "sierra leone": "SL", "singapore": "SN", "sint maarten": "NN",
  "slovakia": "LO", "slovenia": "SI", "solomon islands": "BP",
  "somalia": "SO", "south africa": "SF", "south korea": "KS",
  "korea": "KS", "south sudan": "OD", "spain": "SP", "sri lanka": "CE",
  "sudan": "SU", "suriname": "NS", "sweden": "SW", "switzerland": "SZ",
  "syria": "SY", "taiwan": "TW", "tajikistan": "TI", "tanzania": "TZ",
  "thailand": "TH", "timor-leste": "TT", "togo": "TO", "tonga": "TN",
  "trinidad and tobago": "TD", "tunisia": "TS", "turkey": "TU",
  "turkiye": "TU", "turkmenistan": "TX", "turks and caicos islands": "TK",
  "tuvalu": "TV", "uganda": "UG", "ukraine": "UP",
  "united arab emirates": "AE", "united kingdom": "UK",
  "united states": "US", "uruguay": "UY", "uzbekistan": "UZ",
  "vanuatu": "NH", "vatican city": "VT", "venezuela": "VE", "vietnam": "VM",
  "yemen": "YM", "zambia": "ZA", "zimbabwe": "ZI",
};

/** The spellings clients actually type, mapped to the table's key. */
const ALIASES: Record<string, string> = {
  "uk": "united kingdom", "u.k.": "united kingdom",
  "great britain": "united kingdom", "britain": "united kingdom",
  "england": "united kingdom", "scotland": "united kingdom",
  "wales": "united kingdom", "northern ireland": "united kingdom",
  "usa": "united states", "u.s.a.": "united states", "us": "united states",
  "u.s.": "united states", "united states of america": "united states",
  "uae": "united arab emirates", "u.a.e.": "united arab emirates",
  "holland": "netherlands", "the netherlands": "netherlands",
  "republic of ireland": "ireland", "eire": "ireland",
  "swiss confederation": "switzerland", "deutschland": "germany",
  "cayman": "cayman islands", "the cayman islands": "cayman islands",
  "bvi": "british virgin islands", "b.v.i.": "british virgin islands",
  "virgin islands (british)": "british virgin islands",
  "drc": "democratic republic of the congo",
  "republic of korea": "south korea", "prc": "china",
  "people's republic of china": "china", "russian federation": "russia",
  "czech": "czech republic", "swaziland": "eswatini",
  "macedonia": "north macedonia", "east timor": "timor-leste",
  "vatican": "vatican city", "cabo verde": "cape verde",
  "st kitts and nevis": "saint kitts and nevis", "st lucia": "saint lucia",
  "st vincent and the grenadines": "saint vincent and the grenadines",
  /* The spellings the tool's own currency table uses. They reach this lookup
     whenever a country is read from the functional currency rather than from
     a document, so they are not optional. */
  "south korean": "south korea", "korea, republic of": "south korea",
  "antigua & barbuda": "antigua and barbuda",
  "bosnia": "bosnia and herzegovina", "bosnia & herzegovina": "bosnia and herzegovina",
  "sao tome & principe": "sao tome and principe",
  "s\u00e3o tom\u00e9 and pr\u00edncipe": "sao tome and principe",
  "somali": "somalia",
  "trinidad & tobago": "trinidad and tobago",
  "western samoa": "samoa",
  "rep. of n macedonia": "north macedonia", "republic of north macedonia": "north macedonia",
  "swaziland / eswatini-lilangeni": "eswatini",
  "macao": "macau",
  "cura\u00e7ao": "curacao",
};

/** Normalised for lookup: case, punctuation, a leading article and the
    "republic of" wrappers that clients add and the IRS list does not use. */
const normalize = (name: string) =>
  String(name || "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[.,]+$/g, "")
    .trim()
    .replace(/^the\s+/, "");

/** The IRS two-letter code for a country name, or null when it is not on the
    list — never a guess, because a wrong code looks right on the form. */
export function irsCountryCode(name: string | null | undefined): string | null {
  const n = normalize(name || "");
  if (!n) return null;
  if (IRS_COUNTRY_CODES[n]) return IRS_COUNTRY_CODES[n];
  const aliased = ALIASES[n] || ALIASES[n.replace(/[.]/g, "")];
  if (aliased && IRS_COUNTRY_CODES[aliased]) return IRS_COUNTRY_CODES[aliased];
  const stripped = n.replace(/^(republic|state|kingdom|commonwealth) of\s+/, "");
  return IRS_COUNTRY_CODES[stripped] || null;
}
