/* Builds a calendar invite (.ics, RFC 5545) that Outlook, Google Calendar and Apple Calendar open as an event.
   Times are "floating": they mean the same clock time wherever the file is opened, which is what an engineer slot
   or a port date means. No DOM, no state. */
window.AstraICS = (function () {
  "use strict";

  /* Commas, semicolons, backslashes and line breaks have meanings of their own in the format. */
  const escapeText = (s) =>
    String(s ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r\n|\r|\n/g, "\\n");

  /* Lines longer than 75 bytes are folded: a line break followed by one space. Never splits a UTF-8 character. */
  function fold(line) {
    const bytes = new TextEncoder();
    const out = [];
    let current = "";
    let size = 0;
    for (const ch of line) {
      const n = bytes.encode(ch).length;
      if (size + n > (out.length ? 74 : 75)) {
        out.push(current);
        current = "";
        size = 0;
      }
      current += ch;
      size += n;
    }
    out.push(current);
    return out.join("\r\n ");
  }

  const pad = (n) => String(n).padStart(2, "0");
  const utcStamp = (d) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(
      d.getUTCMinutes(),
    )}${pad(d.getUTCSeconds())}Z`;

  /* "AM 08:00–13:00" or "08:00-13:00" → ["0800", "1300"]; anything else → null (an all-day event). */
  function slotTimes(slot) {
    const m = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/.exec(String(slot || ""));
    return m ? [pad(m[1]) + m[2], pad(m[3]) + m[4]] : null;
  }

  /* date: "YYYY-MM-DD". Returns the file's text, or "" if the date is not valid. */
  function build({ title, description = "", date, slot = "", location = "", now = new Date(), uid = "" }) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
    if (!m) return "";
    const day = `${m[1]}${m[2]}${m[3]}`;
    const times = slotTimes(slot);
    let when;
    if (times) when = [`DTSTART:${day}T${times[0]}00`, `DTEND:${day}T${times[1]}00`];
    else {
      const next = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1));
      const end = `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
      when = [`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${end}`];
    }
    const id =
      uid ||
      `${day}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}@astra.invalid`;
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Astra//Service desk//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${id}`,
      `DTSTAMP:${utcStamp(now)}`,
      ...when,
      `SUMMARY:${escapeText(title)}`,
      ...(location ? [`LOCATION:${escapeText(location)}`] : []),
      ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
      "END:VCALENDAR",
    ];
    return lines.map(fold).join("\r\n") + "\r\n";
  }

  return { build, slotTimes };
})();
