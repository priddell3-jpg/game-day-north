/* The one gate between the page and the notification centre.

   The bridge hands every list through here before it cancels or
   schedules anything, so a malformed list is refused whole and the
   alerts already pending are left exactly as they were. Kept apart from
   native-bridge.js because it imports nothing: the bridge bundles it,
   and the tests run it as it ships. */

/* iOS keeps at most 64 pending local notifications per app and silently
   drops the rest, soonest kept. Fifty leaves room and keeps the limit
   ours rather than the system's. */
export const ALERT_MAX = 50;
export const ALERT_TEXT_MAX = 120;
/* A notification id is a 32-bit signed integer on the native side; zero
   and negatives are kept out so an id is always a plain positive one. */
export const ALERT_ID_MAX = 0x7fffffff;

export function clipAlertText(value) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= ALERT_TEXT_MAX ? text : text.slice(0, ALERT_TEXT_MAX - 1).trimEnd() + "…";
}

/* Returns a clean copy — only the four fields, text clipped — or throws.
   Anything unexpected is an error rather than something to repair: a
   reminder at the wrong minute is worse than no reminder. */
export function checkedAlerts(list, now) {
  if (!Array.isArray(list)) throw new Error("Alerts must be a list");
  if (list.length > ALERT_MAX) throw new Error("Too many alerts");
  const seen = new Set();
  return list.map(item => {
    if (!item || typeof item !== "object") throw new Error("Alert is not an object");
    const { id, at, title, body } = item;
    if (!Number.isInteger(id) || id < 1 || id > ALERT_ID_MAX) throw new Error("Alert id is not a positive 31-bit integer");
    if (seen.has(id)) throw new Error("Alert id is repeated");
    seen.add(id);
    if (typeof at !== "number" || !Number.isFinite(at) || at <= now) throw new Error("Alert time is not in the future");
    if (typeof title !== "string" || typeof body !== "string") throw new Error("Alert text is not a string");
    const cleanTitle = clipAlertText(title);
    if (!cleanTitle) throw new Error("Alert has no title");
    return { id, at, title: cleanTitle, body: clipAlertText(body) };
  });
}
