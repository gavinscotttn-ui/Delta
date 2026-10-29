/* UK number lookup: is it valid, what kind of number it is, where a landline is, which network a mobile range was
   given to, and how to write it. All from the libphonenumber data in js/uk-numbers.js; nothing is guessed. Also
   finds dialling codes from a place name. No DOM, no state. */
window.AstraNumbers = (function () {
  "use strict";

  const D = window.AstraNumberData;
  const whole = (p) => new RegExp(`^(?:${p})$`);
  const TYPES = Object.entries(D.types).map(([type, p]) => [type, whole(p)]);
  /* Isle of Man, Jersey and Guernsey numbers use +44 but are their own ranges. */
  const CROWN = Object.entries(D.crown || {}).map(([place, types]) => [
    place,
    Object.entries(types).map(([type, p]) => [type, whole(p)]),
  ]);
  const GENERAL = whole(D.general);
  const FORMATS = D.formats.map((f) => ({
    re: whole(f.pattern),
    lead: new RegExp(`^(?:${f.leading})`),
    format: f.format.replace(/\\(\d)/g, "$$$1"),
  }));

  /* The number without the leading 0 (or +44), or "" if the text is not a UK number. */
  function nationalDigits(input) {
    let d = String(input)
      .replace(/\(0\)/g, "")
      .replace(/[^\d+]/g, "");
    if (d.startsWith("+44")) d = d.slice(3);
    else if (d.startsWith("0044")) d = d.slice(4);
    else if (d.startsWith("44") && d.length >= 11) d = d.slice(2);
    else if (d.startsWith("0")) d = d.slice(1);
    else return "";
    return /^\d{6,10}$/.test(d) ? d : "";
  }

  const longest = (table, digits) => {
    for (let n = Math.min(digits.length, 8); n > 0; n--) {
      const hit = table[digits.slice(0, n)];
      if (hit) return hit;
    }
    return "";
  };

  function format(nsn) {
    const f = FORMATS.find((x) => x.lead.test(nsn) && x.re.test(nsn));
    return "0" + (f ? nsn.replace(f.re, f.format) : nsn);
  }

  /* What each kind of number is called. */
  function kind(type, nsn) {
    switch (type) {
      case "fixed_line":
        return "Landline";
      case "mobile":
        return "Mobile";
      case "toll_free":
        return "Freephone (080)";
      case "premium_rate":
        return nsn.startsWith("9") ? "Premium rate (09)" : "Service number (084 or 087)";
      case "personal_number":
        return "Personal number (070)";
      case "voip":
        return "VoIP number (056)";
      case "pager":
        return "Pager (076)";
      case "uan":
        return nsn.startsWith("55") ? "Corporate number (055)" : "UK-wide number (03)";
      default:
        return "";
    }
  }

  /* Everything known about a UK number, or null if the text is not one. */
  function lookup(input) {
    const nsn = nationalDigits(input);
    if (!nsn) return null;
    let hit = TYPES.find(([, re]) => re.test(nsn));
    let place = "";
    if (!hit)
      for (const [where, types] of CROWN) {
        hit = types.find(([, re]) => re.test(nsn));
        if (hit) {
          place = where;
          break;
        }
      }
    const type = hit ? hit[0] : "";
    const national = format(nsn);
    return {
      valid: !!type,
      possible: GENERAL.test(nsn),
      type,
      place,
      kind: kind(type, nsn) + (place ? ` (${place})` : ""),
      national,
      international: "+44 " + national.slice(1),
      e164: "+44" + nsn,
      area: type === "fixed_line" ? longest(D.areas, nsn) || place : "",
      network: type === "mobile" || type === "pager" ? longest(D.networks, nsn) : "",
    };
  }

  /* The lines a person reads: the number, what it is, and where or whose. */
  function describe(r) {
    if (!r) return "";
    if (!r.valid)
      return `${r.national}\nNot a valid UK number${r.possible ? ": no range is in use for it" : ": check the digits"}.`;
    const lines = [r.national, r.kind + (r.area && r.area !== r.place ? ` · ${r.area}` : "")];
    if (r.network)
      lines.push(`Range given to ${r.network}. Numbers can move network, so the current one may differ.`);
    lines.push(`International: ${r.international}`);
    return lines.join("\n");
  }

  /* Dialling codes for a place: "Langholm" -> 013873. At least three letters. */
  function areaCodes(place, limit = 12) {
    const q = String(place || "")
      .trim()
      .toLowerCase();
    if (q.length < 3 || /\d/.test(q)) return [];
    const out = new Map();
    for (const [prefix, name] of Object.entries(D.areas)) {
      const n = name.toLowerCase();
      if (!n.split(/[\s/,-]+/).some((w) => w.startsWith(q)) && !n.startsWith(q)) continue;
      const code = "0" + prefix;
      if (![...out.keys()].some((c) => code.startsWith(c) && out.get(c) === name)) out.set(code, name);
    }
    return [...out]
      .sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([code, name]) => ({ code, name }));
  }

  /* The place for a dialling code typed on its own: "0141" -> Glasgow. */
  function areaOf(code) {
    const d = String(code || "").replace(/\D/g, "");
    if (!/^0[12]\d{1,4}$/.test(d)) return "";
    return longest(D.areas, d.slice(1));
  }

  return { lookup, describe, areaCodes, areaOf, nationalDigits, source: D.source };
})();
