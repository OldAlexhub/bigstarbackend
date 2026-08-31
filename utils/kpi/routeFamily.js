// Port of import.R's normalize_route_group(): strips a trailing separator +
// single A/B suffix so 1029-A and 1029-B merge into one route family "1029".
export const normalizeRouteGroup = (code) => {
  const value = String(code ?? "").trim();
  const match = value.match(/^(.+?)[\s_-]+([AaBb])$/);
  return match ? match[1].trim() : value;
};
