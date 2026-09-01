import { cleanRunName } from "./reportParsing.js";

const leadingNumber = (code) => {
  const match = String(code ?? "").trim().match(/^(\d+)/);
  return match ? match[1] : null;
};

// Only "bare" routes - whose BST-stripped code IS its leading number, with
// no trailing separator/letters at all (e.g. "1101", not "1101-B" or
// "4001-WE") - are valid fuzzy-match targets. A suffixed route is already a
// real, distinct route reachable by ordinary exact matching; including it in
// this index too would make routes like "4001" (which has a real "-WE"
// sibling) ambiguous for no reason. Standby routes are excluded by type as
// well as by shape, since a code like "Standby/4501" has no leading digits
// anyway.
export const buildLeadingNumberIndex = (routes) => {
  const index = new Map();
  for (const route of routes) {
    if (route.type === "standby") continue;
    const clean = cleanRunName(route.code);
    const num = leadingNumber(clean);
    if (!num || clean !== num) continue;
    if (!index.has(num)) index.set(num, []);
    index.get(num).push(route);
  }
  return index;
};

// { route } on a clean single match, { route: null, ambiguous: true,
// candidates } if more than one bare route somehow shares that leading
// number (shouldn't happen given Route.code's per-division uniqueness, but
// never silently guessed if it does), or { route: null } when the code has
// no leading-number shape at all or nothing matches.
export const matchRouteByLeadingNumber = (rawCode, leadingNumberIndex) => {
  const num = leadingNumber(cleanRunName(rawCode));
  if (!num) return { route: null };
  const candidates = leadingNumberIndex.get(num) || [];
  if (candidates.length === 0) return { route: null };
  if (candidates.length > 1) return { route: null, ambiguous: true, candidates };
  return { route: candidates[0] };
};

// One entry point for exact-match-then-fuzzy-fallback, so the sequence
// lives in one place instead of being duplicated per caller.
export const resolveRouteCode = (rawCode, routeByCode, leadingNumberIndex) => {
  const upper = String(rawCode ?? "").trim().toUpperCase();
  const cleanUpper = cleanRunName(rawCode).toUpperCase();
  const exact = routeByCode.get(upper) || routeByCode.get(cleanUpper);
  if (exact) return { route: exact, fuzzy: false };

  const fuzzy = matchRouteByLeadingNumber(rawCode, leadingNumberIndex);
  if (fuzzy.ambiguous) return { route: null, ambiguous: true, candidates: fuzzy.candidates };
  if (fuzzy.route) return { route: fuzzy.route, fuzzy: true };
  return { route: null };
};
