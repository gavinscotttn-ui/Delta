/* QR codes, made on this computer (ISO/IEC 18004, byte mode, versions 1 to 40, all four error correction levels).
   Nothing is sent anywhere. Also builds the text a phone reads for Wi-Fi, phone, email and web links. */
self.AstraQR = (function () {
  "use strict";

  const LEVELS = { L: 0, M: 1, Q: 2, H: 3 };
  /* The two bits each level writes into the format information. */
  const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  /* Error correction codewords per block, and the number of blocks, by level then version (index 0 unused). */
  const ECC_PER_BLOCK = [
    [
      -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26,
      28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    ],
    [
      -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28,
      28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    ],
    [
      -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30,
      28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    ],
    [
      -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30,
      30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    ],
  ];
  const BLOCKS = [
    [
      -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16,
      17, 18, 19, 19, 20, 21, 22, 24, 25,
    ],
    [
      -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26,
      28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
    ],
    [
      -1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35,
      38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
    ],
    [
      -1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40,
      42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
    ],
  ];

  const bit = (x, i) => ((x >>> i) & 1) !== 0;

  function rawModules(ver) {
    let n = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const align = Math.floor(ver / 7) + 2;
      n -= (25 * align - 10) * align - 55;
      if (ver >= 7) n -= 36;
    }
    return n;
  }
  const dataCodewords = (ver, lvl) =>
    Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[lvl][ver] * BLOCKS[lvl][ver];
  /* Bits for the character count of a byte-mode segment. */
  const countBits = (ver) => (ver <= 9 ? 8 : 16);
  const capacity = (ver, lvl) => Math.floor((dataCodewords(ver, lvl) * 8 - 4 - countBits(ver)) / 8);

  /* ---------------------------------------------------------- Reed-Solomon */

  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  function rsDivisor(degree) {
    const out = new Array(degree).fill(0);
    out[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < out.length; j++) {
        out[j] = gfMul(out[j], root);
        if (j + 1 < out.length) out[j] ^= out[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return out;
  }

  function rsRemainder(data, divisor) {
    const out = new Array(divisor.length).fill(0);
    for (const b of data) {
      const factor = b ^ out.shift();
      out.push(0);
      divisor.forEach((coef, i) => (out[i] ^= gfMul(coef, factor)));
    }
    return out;
  }

  function withEcc(data, ver, lvl) {
    const blocks = BLOCKS[lvl][ver];
    const eccLen = ECC_PER_BLOCK[lvl][ver];
    const raw = Math.floor(rawModules(ver) / 8);
    const shortBlocks = blocks - (raw % blocks);
    const shortLen = Math.floor(raw / blocks);
    const divisor = rsDivisor(eccLen);
    const all = [];
    for (let i = 0, k = 0; i < blocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, divisor);
      if (i < shortBlocks) dat.push(0);
      all.push(dat.concat(ecc));
    }
    const out = [];
    for (let i = 0; i < all[0].length; i++)
      all.forEach((block, j) => {
        /* The padding byte added to short blocks is skipped. */
        if (i !== shortLen - eccLen || j >= shortBlocks) out.push(block[i]);
      });
    return out;
  }

  /* --------------------------------------------------------------- drawing */

  function alignmentPositions(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    const out = [6];
    for (let pos = ver * 4 + 17 - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  function build(codewords, ver, lvl, level) {
    const size = ver * 4 + 17;
    const dark = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, on) => {
      dark[y][x] = on;
      fixed[y][x] = true;
    };

    for (let i = 0; i < size; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [
      [3, 3],
      [size - 4, 3],
      [3, size - 4],
    ])
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
        }
    const align = alignmentPositions(ver);
    const last = align.length - 1;
    align.forEach((ax, i) =>
      align.forEach((ay, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }),
    );

    const drawFormat = (mask) => {
      const data = (FORMAT_BITS[level] << 3) | mask;
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i));
      set(8, 7, bit(bits, 6));
      set(8, 8, bit(bits, 7));
      set(7, 8, bit(bits, 8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits, i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits, i));
      set(8, size - 8, true);
    };
    drawFormat(0);

    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const on = bit(bits, i);
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        set(a, b, on);
        set(b, a, on);
      }
    }

    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? size - 1 - vert : vert;
          if (!fixed[y][x] && i < codewords.length * 8) {
            dark[y][x] = bit(codewords[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
    }
    return { size, dark, fixed, drawFormat };
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  function applyMask(q, mask) {
    for (let y = 0; y < q.size; y++)
      for (let x = 0; x < q.size; x++) if (!q.fixed[y][x] && MASKS[mask](x, y)) q.dark[y][x] = !q.dark[y][x];
  }

  /* The standard's penalty score: lower scans more reliably. */
  function penalty(q) {
    const n = q.size;
    const m = q.dark;
    let score = 0;
    const line = (get) => {
      let run = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && get(i) === get(i - 1)) run++;
        else {
          if (run >= 5) score += 3 + run - 5;
          run = 1;
        }
      }
      const pat = [true, false, true, true, true, false, true];
      for (let i = 0; i + 7 <= n; i++) {
        if (!pat.every((v, k) => get(i + k) === v)) continue;
        const lightBefore = [1, 2, 3, 4].every((k) => i - k < 0 || !get(i - k));
        const lightAfter = [0, 1, 2, 3].every((k) => i + 7 + k >= n || !get(i + 7 + k));
        if (lightBefore || lightAfter) score += 40;
      }
    };
    for (let y = 0; y < n; y++) line((x) => m[y][x]);
    for (let x = 0; x < n; x++) line((y) => m[y][x]);
    for (let y = 0; y < n - 1; y++)
      for (let x = 0; x < n - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    let darkCount = 0;
    for (const row of m) for (const c of row) if (c) darkCount++;
    score += Math.floor(Math.abs((darkCount * 100) / (n * n) - 50) / 5) * 10;
    return score;
  }

  function utf8(text) {
    return Array.from(new TextEncoder().encode(String(text)));
  }

  /* Encodes text. Returns { version, size, level, mask, dark: rows of true (dark) or false }, or throws when the
     text is too long for any QR code at that level. */
  function encode(text, { level = "M", mask = -1, minVersion = 1 } = {}) {
    if (!(level in LEVELS)) throw new Error("Unknown error correction level");
    const lvl = LEVELS[level];
    const bytes = utf8(text);
    let ver = Math.max(1, Math.min(40, minVersion | 0));
    while (ver <= 40 && bytes.length > capacity(ver, lvl)) ver++;
    if (ver > 40) throw new Error("Too long for a QR code");

    const bits = [];
    const put = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };
    put(0b0100, 4);
    put(bytes.length, countBits(ver));
    for (const b of bytes) put(b, 8);
    const capBits = dataCodewords(ver, lvl) * 8;
    put(0, Math.min(4, capBits - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8)
      data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

    const codewords = withEcc(data, ver, lvl);
    let chosen = mask;
    if (chosen < 0) {
      let best = Infinity;
      for (let k = 0; k < 8; k++) {
        const q = build(codewords, ver, lvl, level);
        applyMask(q, k);
        q.drawFormat(k);
        const p = penalty(q);
        if (p < best) {
          best = p;
          chosen = k;
        }
      }
    }
    const q = build(codewords, ver, lvl, level);
    applyMask(q, chosen);
    q.drawFormat(chosen);
    return { version: ver, size: q.size, level, mask: chosen, dark: q.dark };
  }

  /* An SVG of the code with the four-module quiet zone the standard asks for. */
  function svg(qr, { border = 4, dark = "#000", light = "#fff" } = {}) {
    const n = qr.size + border * 2;
    let path = "";
    qr.dark.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) path += `M${x + border},${y + border}h1v1h-1z`;
      }),
    );
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
  }

  /* ------------------------------------------------- what the phone reads */

  /* Wi-Fi: the format phone cameras read (the same one Android and iOS use when sharing a network). */
  const wifiEscape = (s) => String(s).replace(/([\\;,:"])/g, "\\$1");
  function wifi({ ssid = "", password = "", security = "WPA", hidden = false } = {}) {
    const type = security === "nopass" || !password ? "nopass" : security;
    return `WIFI:T:${type};S:${wifiEscape(ssid)};${type === "nopass" ? "" : `P:${wifiEscape(password)};`}${hidden ? "H:true;" : ""};`;
  }
  /* A phone number to ring: digits and a leading + only. */
  const tel = (number) => {
    const n = String(number).replace(/[^\d+]/g, "");
    return n ? `tel:${n.replace(/(?!^)\+/g, "")}` : "";
  };
  function mailto({ to = "", subject = "", body = "" } = {}) {
    const q = [
      subject && `subject=${encodeURIComponent(subject)}`,
      body && `body=${encodeURIComponent(body)}`,
    ]
      .filter(Boolean)
      .join("&");
    return to.trim() ? `mailto:${to.trim()}${q ? `?${q}` : ""}` : "";
  }

  return { encode, svg, wifi, tel, mailto, capacity: (ver, level = "M") => capacity(ver, LEVELS[level]) };
})();
