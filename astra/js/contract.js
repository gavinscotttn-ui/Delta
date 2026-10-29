/* Contract dates from our Terms & Conditions (clause 10): the customer's 90 days' written notice, counted from the
   day we receive it, and the minimum term (12 months unless the order says otherwise). Dates are calendar dates
   ("YYYY-MM-DD"), worked out at midday so a clock change never moves a day. */
window.AstraContract = (function () {
  "use strict";

  const NOTICE_DAYS = 90; /* clause 10.2: by the customer, 90 days' written notice */
  const DEFAULT_TERM = 12; /* clause 10.4: minimum term is 12 months unless stated otherwise */

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function parse(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
  }

  /* The date the notice period ends: 90 days after the day it was received. */
  function noticeEnd(received, days = NOTICE_DAYS) {
    const d = parse(received);
    if (!d) return "";
    d.setDate(d.getDate() + days);
    return iso(d);
  }

  /* The minimum term ends this many whole months after the start; a start on the 31st ends on the last day of a
     shorter month rather than spilling into the next. */
  function termEnd(start, months = DEFAULT_TERM) {
    const d = parse(start);
    const n = Math.round(Number(months));
    if (!d || !(n >= 1 && n <= 240)) return "";
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).getDate();
    d.setDate(Math.min(day, last));
    return iso(d);
  }

  /* Whether the service would end inside the minimum term, where early termination fees apply (clause 10.3). */
  function insideTerm(received, start, months = DEFAULT_TERM) {
    const end = noticeEnd(received);
    const term = termEnd(start, months);
    return !!end && !!term && end < term;
  }

  return { NOTICE_DAYS, DEFAULT_TERM, parse, noticeEnd, termEnd, insideTerm };
})();
