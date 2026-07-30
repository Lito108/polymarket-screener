// filters.mjs — SINGLE SOURCE OF TRUTH for market classification.
//
// This file is consumed two ways, so the rules can never drift apart again:
//   • collector.mjs imports it directly (Netlify bundles the relative import).
//   • index.html gets it INJECTED at build time, replacing the __FILTERS__
//     marker in insider-screener-feed.jsx. Never hand-edit the copy in
//     index.html — edit here and recompile.
//
// Insider trading needs non-public info about a deterministic outcome. That
// concentrates in politics, governance, geopolitics, legal/regulatory,
// corporate actions and macro — NOT sports (the outcome doesn't exist yet) or
// crypto price markets (they resolve on public feeds).

export const GOV_RE = /\b(election|elected|electoral|president|presiden\w+|prime minister|mayor|mayoral|governor|gubernatorial|senator|senate|congress\w*|parliament\w*|chancellor|candidate|nominee|nominn?ation|nominated|primary|primaries|ballot|referendum|coalition|cabinet|incumbent|impeach\w*|inaugurat\w*|re-?elect\w*|GOP|republican|democrat|tory|tories|labour party|conservative party)s?\b/i;
export const OFFICE_RE = /\b(resign\w*|step down|steps down|stepping down|ousted?|out as|removed from office|leaves? office|leaving office|leaves? power|in power|remain in power|stay in power|seize power|hold office|approval rating|no[- ]confidence|vote of no confidence)s?\b/i;
export const GEO_RE = /\b(cease[- ]?fire|armistice|peace deal|peace talks|peace agreement|truce|sanction\w*|embargo|treaty|summit|NATO|united nations|G7|G20|nuclear|air ?strike|military strike|missile strike|missile|invasion|invade|coup|regime|overthrow|annex\w*|hostage|prisoner swap|strait of hormuz|hormuz|strait|drone strike|cartel|counter[- ]?narcotics|martial law|deploy troops|troops to|declares? war|go to war|war (before|by|with|breaks out)|strike (iran|israel|russia|china|north korea|ukraine|gaza|taiwan|syria))s?\b/i;
export const LEGAL_RE = /\b(SEC|FDA|FTC|DOJ|FBI|CIA|antitrust|indict\w*|convicted|verdict|ruling|supreme court|SCOTUS|lawsuit|subpoena|FISA|reauthoriz\w*|confirmed as|merger|acquisition|IPO|bankruptcy|delisting|recall|investigation|probe|CEO|fired as|sued?|pardon|executive order|extradit\w*|state of emergency)s?\b/i;
export const MACRO_RE = /\b(fed|FOMC|interest rate|rate (cut|hike|decision)|powell|inflation|CPI|recession|GDP|unemployment|jobs report|debt ceiling|shutdown|government shutdown|budget|tariff\w*|trade deal|debt default|central bank|monetary policy|basis points|rate decision|bank of (england|japan|korea|canada|mexico|israel|russia|india|brazil)|ECB|BOJ|PBOC)s?\b/i;

// Esports/sports veto — overrides the allowlist. A sports title containing an
// allowlist keyword can otherwise leak through: observed live with
// "Counter-Strike: … BetBoom RUSH B! Summit Playoffs", where `summit` (there
// for peace/NATO/G7 summits) matched. Narrow on purpose, so political
// "X vs Y debate" markets are never caught.
export const DENY_RE = /\b(counter[- ]?strike|cs:?go|cs2|dota ?2|valorant|overwatch|rocket league|league of legends|esports|bo[1357])\b/i;

export const isRelevant = (title = "") =>
  !DENY_RE.test(title) &&
  (GOV_RE.test(title) || OFFICE_RE.test(title) || GEO_RE.test(title) ||
   LEGAL_RE.test(title) || MACRO_RE.test(title));

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
