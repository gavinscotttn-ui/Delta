/* Passwords and PINs, made with the browser's secure random numbers. Nothing is saved or sent. */
self.AstraPasswords = (function () {
  "use strict";

  /* Characters that are easy to misread (l, 1, I, O, 0) are left out unless asked for. The symbols are ones that
     survive SIP, web forms and being read out: no quotes, slashes, brackets, spaces, &, <, >, ; or commas. */
  const SETS = {
    lower: { clear: "abcdefghijkmnpqrstuvwxyz", all: "abcdefghijklmnopqrstuvwxyz" },
    upper: { clear: "ABCDEFGHJKLMNPQRSTUVWXYZ", all: "ABCDEFGHIJKLMNOPQRSTUVWXYZ" },
    digits: { clear: "23456789", all: "0123456789" },
    symbols: { clear: "!#$%*+-=?@_", all: "!#$%*+-=?@_" },
  };

  /* A whole number from 0 to n - 1, every value equally likely. */
  function randomBelow(n, random = (a) => crypto.getRandomValues(a)) {
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    for (;;) {
      random(buf);
      if (buf[0] < limit) return buf[0] % n;
    }
  }

  /* length 8 to 64; every chosen kind of character appears at least once. */
  function password({ length = 16, symbols = true, clear = true } = {}, random) {
    const n = Math.max(8, Math.min(64, Math.floor(Number(length)) || 16));
    const kinds = ["lower", "upper", "digits", ...(symbols ? ["symbols"] : [])].map(
      (k) => SETS[k][clear ? "clear" : "all"],
    );
    const pool = kinds.join("");
    for (;;) {
      let out = "";
      for (let i = 0; i < n; i++) out += pool[randomBelow(pool.length, random)];
      /* Retrying until every kind appears keeps each allowed password equally likely. */
      if (kinds.every((set) => [...out].some((c) => set.includes(c)))) return out;
    }
  }

  /* A PIN nobody would guess first: not one digit repeated (1111), not a straight run (1234, 9876), and not a
     repeated pair (1212). */
  function weakPin(pin) {
    const d = [...pin].map(Number);
    if (d.every((x) => x === d[0])) return true;
    const steps = d.slice(1).map((x, i) => x - d[i]);
    if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true;
    if (d.length >= 4 && d.every((x, i) => x === d[i % 2])) return true;
    return false;
  }

  function pin({ length = 6 } = {}, random) {
    const n = Math.max(4, Math.min(12, Math.floor(Number(length)) || 6));
    for (;;) {
      let out = "";
      for (let i = 0; i < n; i++) out += String(randomBelow(10, random));
      if (!weakPin(out)) return out;
    }
  }

  return { password, pin, weakPin, randomBelow, SETS };
})();
