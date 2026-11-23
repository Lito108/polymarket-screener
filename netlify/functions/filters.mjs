// filters.mjs — SINGLE SOURCE OF TRUTH for market classification.
//
// This file is consumed two ways, so the rules can never drift apart again:
//   • collector.mjs imports it directly (Netlify bundles the relative import).
//   • index.html gets it INJECTED at build time, replacing the __FILTERS__
//     marker in insider-screener-feed.jsx. Never hand-edit the copy in
//     index.html — edit here and recompile.
//
// SCOPE (changed Nov 2026): ECONOMICS AND FINANCE ONLY.
// Elections, governance and geopolitics were removed — they used to be the
// whole point, and that history is why so many GOV/GEO terms are conspicuously
// absent rather than never written.
//
// The thesis is unchanged: insider trading needs non-public information about
// a DETERMINISTIC outcome — a fact that already exists before it is public.
// That is what the three allowlists below are sorted by, strongest first:
//
//   CORPORATE  M&A, IPOs, insolvency, executive changes. The classic insider
//              domain: a deal is negotiated privately for weeks before it is
//              announced. Strongest signal per flagged trade.
//   REGFIN     Regulator decisions — approvals, enforcement, clearance. The
//              decision exists inside the agency before the public sees it.
//   MACRO      Economic data releases (CPI, payrolls, GDP) are pre-computed
//              inside a statistical agency before publication, so they leak
//              like corporate actions do. Rate DECISIONS are the weak member
//              of this set: nothing exists to leak until the committee votes.
//
// Two vetoes override all three, for the same reason crypto price markets were
// always excluded: a market that settles off a public feed has no private fact
// to know. GAME_RE drops game outcomes; PRICE_RE drops asset-price thresholds
// in any asset class — equities, metals, FX and crypto alike.

// ── Allowlist 1: corporate actions ──────────────────────────────────────────
// Executive-change verbs are deliberately bound to an executive TITLE. A bare
// "resign" or "step down" would re-admit every political resignation market
// this rewrite just removed.
export const CORPORATE_RE = /\b(merger|merges?|merging|acquisition|acquires?|acquired|acquiring|takeover|buyout|LBO|tender offer|spin[- ]?offs?|divests?|divestiture|sells? a stake|stake sale|sold for|goes? private|taken private|IPOs?|direct listing|SPACs?|public offering|bankrupt|bankruptcies|bankruptcy|chapter 11|insolven\w*|liquidation|delist\w*|restructur\w*|defaults? on|earnings|revenues?|profit warning|dividends?|buybacks?|share repurchase|layoffs?|job cuts|funding round|series [a-f] round|valuation)s?\b|\b(resigns?|resigned|steps? down|stepping down|ousted?|fired|named|appointed|succeeds?)\s+(as\s+)?(the\s+)?(CEO|CFO|COO|CTO|chair|chairman|chairwoman|chief executive)\b|\b(CEO|CFO|chief executive)\b/i;

// ── Allowlist 2: financial & market regulators ──────────────────────────────
// This is also where the crypto carve-out lives: a spot-ETF approval or a
// stablecoin bill is a regulatory event with a private decision behind it, so
// it is KEPT even though crypto price markets are vetoed below.
export const REGFIN_RE = /\b(SEC|FTC|DOJ|CFTC|FINRA|FDIC|OCC|CFPB|FHFA|FASB|PCAOB|IRS|FDA|EMA|FCC|CMA|European Commission|antitrust|monopol\w*|consent decree|cease and desist|securities fraud|insider trading|class action|merger review|regulatory approval|approval|clearance|ETFs?|stablecoin|market structure bill|price[- ]fixing|accounting fraud|restatement|short[- ]seller report)s?\b/i;

// ── Allowlist 3: macro & economic policy ────────────────────────────────────
export const MACRO_RE = /\b(fed|FOMC|federal reserve|interest rates?|rate (cut|hike|decision|change|rise)|powell|central bank|monetary policy|basis points|bps|quantitative (easing|tightening)|inflation|CPI|PCE|PPI|deflation|stagflation|recession|GDP|unemployment|jobless|nonfarm|payrolls?|jobs report|labor market|retail sales|consumer confidence|ISM|PMI|housing starts|debt ceiling|government shut ?downs?|shutdowns?|OPEC\+?|oil production (cut|quota)|production quota|federal budget|budget deficit|deficit|fiscal (policy|year|cliff)|tariffs?|trade deal|trade war|trade agreement|debt default|credit rating|downgrades?|sovereign debt|yield curve|treasury yields?|stimulus|bailout|minimum wage|bank of (england|japan|korea|canada|mexico|israel|india|brazil|china)|ECB|BOJ|PBOC|BOE)s?\b/i;

// ── Veto 1: game outcomes ───────────────────────────────────────────────────
// Targets the SHAPE of a betting line, not league or team names — so that
// "Will the NFL sell a stake to private equity?" survives as an M&A market
// while "Guardians vs. Reds: O/U 8.5" does not. Naming leagues here would
// have killed exactly the corporate deals this screener wants.
export const GAME_RE = /\b(vs\.?|versus)\b|\bO\/U\b|\bover\/under\b|\bspread:|\bmoneyline\b|\bby \d+\+? (points?|runs?|goals?|sets?)\b|\b(counter[- ]?strike|cs:?go|cs2|dota ?2|valorant|overwatch|rocket league|league of legends|esports|bo[1357])\b|\bwins? (the )?(match|game|series|title|cup|championship|final|grand prix|stage \d)\b|\bend in a draw\b/i;

// ── Veto 2: asset price thresholds ──────────────────────────────────────────
// A market that settles off a published price has no private fact to leak,
// whatever the asset. Note what is NOT here: the word "over". "Sold for over
// $5B" is an acquisition price, not a quote, and must stay in — which is also
// why CORPORATE_RE outranks this veto in isRelevant() below.
export const INDEX_RE = /\b(S&P ?500|S&P|Dow( Jones)?|Nasdaq|FTSE|Nikkei|DAX|CAC|Russell \d+|VIX)\b[^?]*\b(above|below|close[sd]?|end[s]? (above|below)|reach\w*|hit[s]?|top[s]?)\b/i;
export const PRICE_RE = /\bup or down\b|\ball[- ]time high\b|\bATH\b|\b(reach|reaches|hit|hits|top|tops|exceed|exceeds|surpass|surpasses|touch|touches|dip|dips|fall|falls|drop|drops|rise|rises|close|closes|trade|trades)\s+(to\s+|at\s+|above\s+|below\s+)?\$[\d,.]+/i;

// ── Decision ────────────────────────────────────────────────────────────────
// Order matters:
//   1. a game outcome is never in scope, whatever else the title says;
//   2. a price threshold is out UNLESS the title is a corporate action —
//      an acquisition price is a deal term, not a market quote;
//   3. otherwise, any one of the three allowlists admits it.
export const isRelevant = (title = "") => {
  if (!title) return false;
  if (GAME_RE.test(title)) return false;
  const corporate = CORPORATE_RE.test(title);
  if (!corporate && (PRICE_RE.test(title) || INDEX_RE.test(title))) return false;
  return corporate || REGFIN_RE.test(title) || MACRO_RE.test(title);
};

// ── Market families ──────────────────────────────────────────────────────────
// Collapses rolling expiries onto one key: "ceasefire continues through July 30"
// and "...through July 31" are the SAME thesis, not two independent markets.
// Used to key the repeat-flag penalty, so OVER-merging is the safe direction:
// it can only withdraw an unearned demotion, never invent one.
//
// Two deliberate non-rules:
//   - bare years are NOT stripped, so the 2026 and 2028 presidential markets
//     stay distinct theses rather than collapsing into one;
//   - bare month names are NOT stripped, so "Will Theresa May resign?" survives.
// Only a month followed by a day or a year counts as a date.
//
// Named familyOf (not familyKey) so the build-time injection of this file into
// the UI cannot collide with the UI's own familyKey/MONTHS_RE declarations.
const MONTH = "january|february|march|april|may|june|july|august|september|october|november|december";
const DATEY = new RegExp(
  `\\b(?:${MONTH})\\s+(?:\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?|\\d{4})\\b`, "g");

export const familyOf = (title = "") => title.toLowerCase()
  .replace(/\?+\s*$/, "")
  .replace(DATEY, " ")                    // month+day / month+year, ANYWHERE
  .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ") // ISO dates
  .replace(/\bq[1-4]\s*\d{4}\b/g, " ")    // quarters
  .replace(/\s+/g, " ")
  .replace(/\b(by|through|on|before|in|until|after)\s*$/, "")
  .trim();
