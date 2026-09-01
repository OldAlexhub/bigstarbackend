// Shared by trackerRows.js and scheduleGaps.js so both key a (route, date)
// pair identically - split out to avoid a circular import between them.
export const dateKey = (date) => new Date(date).toISOString().slice(0, 10);
export const rowKey = (routeId, date) => `${routeId}|${dateKey(date)}`;
