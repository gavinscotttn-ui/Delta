/* Audio converter for music on hold and announcements: reads any audio the browser can play (MP3, M4A/AAC, WAV,
   OGG, FLAC, and the sound from video files) and writes telephony formats, entirely on this computer.
   Gamma Horizon wants .wav, CCITT u-Law, 8000 Hz, 8-bit mono, at most 5 MB or 625 seconds. */
window.AstraAudio = (function () {
  "use strict";

  /* ------------------------------------------------------------- formats */

  const FORMATS = [
    {
      id: "ulaw",
      file: "u-law",
      name: "μ-law WAV",
      detail: "8 kHz, mono, CCITT μ-law",
      rate: 8000,
      ext: "wav",
      horizon: true,
    },
    {
      id: "alaw",
      file: "A-law",
      name: "A-law WAV",
      detail: "8 kHz, mono, CCITT A-law",
      rate: 8000,
      ext: "wav",
    },
    {
      id: "pcm8",
      file: "8-bit",
      name: "8-bit WAV",
      detail: "8 kHz, mono, 8-bit PCM",
      rate: 8000,
      ext: "wav",
    },
    {
      id: "pcm16",
      file: "16-bit",
      name: "16-bit WAV",
      detail: "8 kHz, mono, 16-bit PCM",
      rate: 8000,
      ext: "wav",
    },
    {
      id: "pcm16hd",
      file: "HD",
      name: "HD WAV",
      detail: "16 kHz, mono, 16-bit PCM",
      rate: 16000,
      ext: "wav",
    },
    {
      id: "g722",
      file: "G.722",
      name: "G.722",
      detail: "16 kHz, mono, Asterisk .g722",
      rate: 16000,
      ext: "g722",
    },
    {
      id: "sln",
      file: "raw",
      name: "Raw",
      detail: "8 kHz, mono, 16-bit signed linear, Asterisk .sln",
      rate: 8000,
      ext: "sln",
    },
  ];

  /* Peak level after conversion, in dBFS. Medium leaves headroom; Maximum is as loud as it goes without clipping. */
  const VOLUMES = [
    { id: "quiet", name: "Quiet", peak: -15 },
    { id: "lower", name: "Lower", peak: -10 },
    { id: "medium", name: "Medium", peak: -6 },
    { id: "high", name: "High", peak: -3 },
    { id: "max", name: "Maximum", peak: -1 },
  ];

  /* Horizon's limits for music on hold and announcements. */
  const HORIZON = { seconds: 625, bytes: 5 * 1024 * 1024 };

  /* ------------------------------------------------------------ G.711 */

  const clamp16 = (x) => (x > 32767 ? 32767 : x < -32768 ? -32768 : x);
  const toInt16 = (f) => clamp16(Math.round(f * 32767));

  /* ITU-T G.711 μ-law, from a 16-bit sample. */
  function ulaw(sample) {
    const BIAS = 0x84;
    const CLIP = 32635;
    let s = sample;
    const sign = s < 0 ? 0x80 : 0;
    if (sign) s = -s;
    if (s > CLIP) s = CLIP;
    s += BIAS;
    let exponent = 7;
    for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
    const mantissa = (s >> (exponent + 3)) & 0x0f;
    return ~(sign | (exponent << 4) | mantissa) & 0xff;
  }

  /* ITU-T G.711 A-law, from a 16-bit sample. */
  function alaw(sample) {
    let s = sample >> 3; /* 13-bit */
    let mask;
    if (s >= 0) mask = 0xd5;
    else {
      mask = 0x55;
      s = -s - 1;
    }
    const SEG_END = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff];
    let seg = 0;
    while (seg < 8 && s > SEG_END[seg]) seg++;
    if (seg >= 8) return 0x7f ^ mask;
    let aval = seg << 4;
    aval |= seg < 2 ? (s >> 1) & 0x0f : (s >> seg) & 0x0f;
    return aval ^ mask;
  }

  /* μ-law back to 16-bit, so the preview is exactly what callers will hear. */
  function ulawDecode(byte) {
    const u = ~byte & 0xff;
    const t = (((u & 0x0f) << 3) + 0x84) << ((u & 0x70) >> 4);
    return u & 0x80 ? 0x84 - t : t - 0x84;
  }

  function alawDecode(byte) {
    const a = byte ^ 0x55;
    let t = (a & 0x0f) << 4;
    const seg = (a & 0x70) >> 4;
    if (seg === 0) t += 8;
    else if (seg === 1) t += 0x108;
    else t = (t + 0x108) << (seg - 1);
    return a & 0x80 ? t : -t;
  }

  /* ------------------------------------------------------------- G.722 */
  /* ITU-T G.722 sub-band ADPCM encoder at 64 kbit/s, 16 kHz in, one byte per two samples out. */

  const Q6 = [
    0, 35, 72, 110, 150, 190, 233, 276, 323, 370, 422, 473, 530, 587, 650, 714, 786, 858, 940, 1023, 1121,
    1219, 1339, 1458, 1612, 1765, 1980, 2195, 2557, 2919, 0, 0,
  ];
  const ILN = [
    0, 63, 62, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8,
    7, 6, 5, 4, 0,
  ];
  const ILP = [
    0, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37, 36,
    35, 34, 33, 32, 0,
  ];
  const WL = [-60, -30, 58, 172, 334, 538, 1198, 3042];
  const RL42 = [0, 7, 6, 5, 4, 3, 2, 1, 7, 6, 5, 4, 3, 2, 1, 0];
  const ILB = [
    2048, 2093, 2139, 2186, 2233, 2282, 2332, 2383, 2435, 2489, 2543, 2599, 2656, 2714, 2774, 2834, 2896,
    2960, 3025, 3091, 3158, 3228, 3298, 3371, 3444, 3520, 3597, 3676, 3756, 3838, 3922, 4008,
  ];
  const QM4 = [
    0, -20456, -12896, -8968, -6288, -4240, -2584, -1200, 20456, 12896, 8968, 6288, 4240, 2584, 1200, 0,
  ];
  const QM2 = [-7408, -1616, 7408, 1616];
  const QMF = [3, -11, 12, 32, -210, 951, 3876, -805, 362, -156, 53, -11];
  const IHN = [0, 1, 0];
  const IHP = [0, 3, 2];
  const WH = [0, -214, 798];
  const RH2 = [2, 1, 2, 1];

  const band = (det) => ({
    s: 0,
    sp: 0,
    sz: 0,
    r: [0, 0, 0],
    a: [0, 0, 0],
    ap: [0, 0, 0],
    p: [0, 0, 0],
    d: [0, 0, 0, 0, 0, 0, 0],
    b: [0, 0, 0, 0, 0, 0, 0],
    bp: [0, 0, 0, 0, 0, 0, 0],
    sg: [0, 0, 0, 0, 0, 0, 0],
    nb: 0,
    det,
  });

  function block4(b, d) {
    b.d[0] = d;
    b.r[0] = clamp16(b.s + d);
    b.p[0] = clamp16(b.sz + d);
    for (let i = 0; i < 3; i++) b.sg[i] = b.p[i] >> 15;
    let wd1 = clamp16(b.a[1] << 2);
    let wd2 = b.sg[0] === b.sg[1] ? -wd1 : wd1;
    if (wd2 > 32767) wd2 = 32767;
    let wd3 = (wd2 >> 7) + (b.sg[0] === b.sg[2] ? 128 : -128);
    wd3 += (b.a[2] * 32512) >> 15;
    if (wd3 > 12288) wd3 = 12288;
    else if (wd3 < -12288) wd3 = -12288;
    b.ap[2] = wd3;
    b.sg[0] = b.p[0] >> 15;
    b.sg[1] = b.p[1] >> 15;
    wd1 = b.sg[0] === b.sg[1] ? 192 : -192;
    wd2 = (b.a[1] * 32640) >> 15;
    b.ap[1] = clamp16(wd1 + wd2);
    wd3 = clamp16(15360 - b.ap[2]);
    if (b.ap[1] > wd3) b.ap[1] = wd3;
    else if (b.ap[1] < -wd3) b.ap[1] = -wd3;
    wd1 = d === 0 ? 0 : 128;
    b.sg[0] = d >> 15;
    for (let i = 1; i < 7; i++) {
      b.sg[i] = b.d[i] >> 15;
      wd2 = b.sg[i] === b.sg[0] ? wd1 : -wd1;
      wd3 = (b.b[i] * 32640) >> 15;
      b.bp[i] = clamp16(wd2 + wd3);
    }
    for (let i = 6; i > 0; i--) {
      b.d[i] = b.d[i - 1];
      b.b[i] = b.bp[i];
    }
    for (let i = 2; i > 0; i--) {
      b.r[i] = b.r[i - 1];
      b.p[i] = b.p[i - 1];
      b.a[i] = b.ap[i];
    }
    wd1 = clamp16(b.r[1] + b.r[1]);
    wd1 = (b.a[1] * wd1) >> 15;
    wd2 = clamp16(b.r[2] + b.r[2]);
    wd2 = (b.a[2] * wd2) >> 15;
    b.sp = clamp16(wd1 + wd2);
    b.sz = 0;
    for (let i = 6; i > 0; i--) {
      wd1 = clamp16(b.d[i] + b.d[i]);
      b.sz += (b.b[i] * wd1) >> 15;
    }
    b.sz = clamp16(b.sz);
    b.s = clamp16(b.sp + b.sz);
  }

  /* pcm: Int16Array at 16 kHz. Returns Uint8Array, one byte per two samples. */
  function g722(pcm) {
    const low = band(32);
    const high = band(8);
    const x = new Int32Array(24);
    const out = new Uint8Array(pcm.length >> 1);
    for (let j = 0, n = 0; j + 1 < pcm.length; j += 2, n++) {
      for (let i = 0; i < 22; i++) x[i] = x[i + 2];
      x[22] = pcm[j];
      x[23] = pcm[j + 1];
      let sumodd = 0;
      let sumeven = 0;
      for (let i = 0; i < 12; i++) {
        sumodd += x[2 * i] * QMF[i];
        sumeven += x[2 * i + 1] * QMF[11 - i];
      }
      const xlow = (sumeven + sumodd) >> 14;
      const xhigh = (sumeven - sumodd) >> 14;

      /* Lower sub-band: 6-bit ADPCM */
      const el = clamp16(xlow - low.s);
      let wd = el >= 0 ? el : -(el + 1);
      let i = 1;
      for (; i < 30; i++) if (wd < (Q6[i] * low.det) >> 12) break;
      const ilow = el < 0 ? ILN[i] : ILP[i];
      const ril = ilow >> 2;
      const dlow = (low.det * QM4[ril]) >> 15;
      wd = (low.nb * 127) >> 7;
      low.nb = Math.min(18432, Math.max(0, wd + WL[RL42[ril]]));
      let wd1 = (low.nb >> 6) & 31;
      let wd2 = 8 - (low.nb >> 11);
      low.det = (wd2 < 0 ? ILB[wd1] << -wd2 : ILB[wd1] >> wd2) << 2;
      block4(low, dlow);

      /* Higher sub-band: 2-bit ADPCM */
      const eh = clamp16(xhigh - high.s);
      wd = eh >= 0 ? eh : -(eh + 1);
      const mih = wd >= (564 * high.det) >> 12 ? 2 : 1;
      const ihigh = eh < 0 ? IHN[mih] : IHP[mih];
      const dhigh = (high.det * QM2[ihigh]) >> 15;
      wd = (high.nb * 127) >> 7;
      high.nb = Math.min(22528, Math.max(0, wd + WH[RH2[ihigh]]));
      wd1 = (high.nb >> 6) & 31;
      wd2 = 10 - (high.nb >> 11);
      high.det = (wd2 < 0 ? ILB[wd1] << -wd2 : ILB[wd1] >> wd2) << 2;
      block4(high, dhigh);

      out[n] = ((ihigh << 6) | ilow) & 0xff;
    }
    return out;
  }

  /* --------------------------------------------------------------- WAV */

  function wav({ rate, bits, format, data, samples }) {
    const compressed = format !== 1;
    const fmtSize = compressed ? 18 : 16;
    const header = 12 + 8 + fmtSize + (compressed ? 12 : 0) + 8;
    const pad = data.length & 1;
    const buf = new ArrayBuffer(header + data.length + pad);
    const v = new DataView(buf);
    let o = 0;
    const tag = (s) => [...s].forEach((c) => v.setUint8(o++, c.charCodeAt(0)));
    const u32 = (n) => (v.setUint32(o, n, true), (o += 4));
    const u16 = (n) => (v.setUint16(o, n, true), (o += 2));
    tag("RIFF");
    u32(buf.byteLength - 8);
    tag("WAVE");
    tag("fmt ");
    u32(fmtSize);
    u16(format); /* 1 PCM, 6 A-law, 7 μ-law */
    u16(1); /* mono */
    u32(rate);
    u32((rate * bits) / 8);
    u16(bits / 8);
    u16(bits);
    if (compressed) {
      u16(0); /* no extra format bytes */
      tag("fact");
      u32(4);
      u32(samples);
    }
    tag("data");
    u32(data.length);
    new Uint8Array(buf, header, data.length).set(data);
    return new Uint8Array(buf);
  }

  /* Float samples (-1..1) at the format's rate to the file's bytes. */
  function encode(formatId, samples) {
    const f = FORMATS.find((x) => x.id === formatId);
    const n = samples.length;
    const pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) pcm[i] = toInt16(samples[i]);
    switch (formatId) {
      case "ulaw":
      case "alaw": {
        const data = new Uint8Array(n);
        const enc = formatId === "ulaw" ? ulaw : alaw;
        for (let i = 0; i < n; i++) data[i] = enc(pcm[i]);
        return wav({ rate: f.rate, bits: 8, format: formatId === "ulaw" ? 7 : 6, data, samples: n });
      }
      case "pcm8": {
        const data = new Uint8Array(n);
        for (let i = 0; i < n; i++)
          data[i] = Math.max(0, Math.min(255, Math.round(samples[i] * 127.5 + 128)));
        return wav({ rate: f.rate, bits: 8, format: 1, data, samples: n });
      }
      case "pcm16":
      case "pcm16hd":
        return wav({ rate: f.rate, bits: 16, format: 1, data: new Uint8Array(pcm.buffer), samples: n });
      case "sln":
        return new Uint8Array(pcm.buffer);
      case "g722":
        return g722(pcm);
      default:
        throw new Error("Unknown format.");
    }
  }

  /* ------------------------------------------------------------ shaping */

  /* RBJ biquad, applied in place. */
  function biquad(samples, rate, type, freq, q = Math.SQRT1_2) {
    const w = (2 * Math.PI * freq) / rate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0;
    let b1;
    let b2;
    if (type === "lowpass") {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    }
    const a0 = 1 + alpha;
    const a1 = -2 * cos;
    const a2 = 1 - alpha;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      samples[i] = y;
    }
  }

  /* Audio is decoded above the target rate, cut off sharply just below the target's limit (an
     eighth-order Butterworth filter), then only every fourth (or second) sample kept, so high notes cannot fold
     back as false tones. */
  /* 32 kHz either way: four times for 8 kHz formats, twice for 16 kHz ones, to keep memory down on long files. */
  const oversample = (rate) => (rate >= 16000 ? 2 : 4);
  const BUTTERWORTH_8 = [0.5098, 0.6013, 0.9, 2.5629];
  function downsample(mono, rate) {
    const factor = oversample(rate);
    const high = rate * factor;
    for (const q of BUTTERWORTH_8) biquad(mono, high, "lowpass", rate * 0.42, q);
    const out = new Float32Array(Math.floor(mono.length / factor));
    for (let i = 0; i < out.length; i++) out[i] = mono[i * factor];
    return out;
  }

  /* Mono, band-limited for a phone line if asked, trimmed if asked (with a two-second fade), then scaled so the
     loudest moment sits at the chosen level. channels are at four times the target rate. */
  function shape(channels, rate, { volume = "medium", phone = false, maxSeconds = 0 } = {}) {
    const mono = new Float32Array(channels[0].length);
    for (const ch of channels) for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / channels.length;
    const full = downsample(mono, rate);
    const length = full.length;
    const n = maxSeconds ? Math.min(length, Math.floor(maxSeconds * rate)) : length;
    const out = n === length ? full : full.slice(0, n);
    if (phone) {
      biquad(out, rate, "highpass", 300);
      biquad(out, rate, "lowpass", Math.min(3400, rate * 0.45));
    }
    if (n < length) {
      const fade = Math.min(n, Math.floor(2 * rate));
      for (let i = 0; i < fade; i++) out[n - fade + i] *= 1 - i / fade;
    }
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
    if (peak > 0) {
      const target = 10 ** ((VOLUMES.find((v) => v.id === volume) || VOLUMES[2]).peak / 20);
      const gain = target / peak;
      for (let i = 0; i < n; i++) out[i] *= gain;
    }
    return out;
  }

  /* What callers will hear, as a 16-bit WAV the browser can play: G.711 formats are decoded back first. */
  function preview(formatId, samples, rate) {
    const n = samples.length;
    const pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const s = toInt16(samples[i]);
      pcm[i] =
        formatId === "ulaw"
          ? ulawDecode(ulaw(s))
          : formatId === "alaw"
            ? alawDecode(alaw(s))
            : formatId === "pcm8"
              ? (Math.round(samples[i] * 127.5 + 128) - 128) * 256
              : s;
    }
    return wav({ rate, bits: 16, format: 1, data: new Uint8Array(pcm.buffer), samples: n });
  }

  /* A file name every browser and system accepts: accents dropped (Café -> Cafe), other symbols removed. */
  const safeName = (s) =>
    String(s)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  /* --------------------------------------------------------- in the page */

  /* Reads a file with the browser's own decoders, resampled to the target rate as it is decoded. */
  async function decode(file, rate) {
    const bytes = await file.arrayBuffer();
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctx) throw new Error("This browser cannot convert audio.");
    const ctx = new Ctx(1, 1, rate * oversample(rate));
    try {
      const buffer = await ctx.decodeAudioData(bytes);
      return Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    } catch {
      throw new Error("That file could not be read as audio. Try an MP3, M4A, WAV, OGG or FLAC file.");
    }
  }

  /* The whole job: file in, { bytes, name, seconds, preview } out. */
  async function convert(file, { format = "ulaw", volume = "medium", phone = false, maxSeconds = 0 } = {}) {
    const f = FORMATS.find((x) => x.id === format) || FORMATS[0];
    const channels = await decode(file, f.rate);
    const samples = shape(channels, f.rate, { volume, phone, maxSeconds });
    const bytes = encode(f.id, samples);
    const base = safeName(String(file.name || "audio").replace(/\.[^.]+$/, "")) || "audio";
    return {
      bytes,
      name: `${base} (${f.file}, ${f.rate / 1000} kHz).${f.ext}`,
      seconds: samples.length / f.rate,
      fullSeconds: channels[0].length / (f.rate * oversample(f.rate)),
      format: f,
      preview: preview(f.id, samples, f.rate),
    };
  }

  return {
    FORMATS,
    VOLUMES,
    HORIZON,
    ulaw,
    alaw,
    ulawDecode,
    alawDecode,
    g722,
    encode,
    shape,
    wav,
    convert,
    safeName,
  };
})();
