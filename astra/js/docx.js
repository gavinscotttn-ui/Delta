/* Reads and writes Word (.docx) files, which are zip archives, using the browser's own compression.
   No DOM, no state. */
window.AstraDocx = (function () {
  "use strict";

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const through = async (bytes, stream) =>
    new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

  const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  /* Returns [{ name, data }] for every file in the archive. */
  async function unzip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = bytes.length - 22;
    while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
    if (end < 0) throw new Error("Not a valid Word file.");
    const count = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    const files = [];
    for (let i = 0; i < count; i++) {
      if (view.getUint32(at, true) !== 0x02014b50) throw new Error("Not a valid Word file.");
      const method = view.getUint16(at + 10, true);
      const size = view.getUint32(at + 20, true);
      const nameLength = view.getUint16(at + 28, true);
      const extraLength = view.getUint16(at + 30, true);
      const commentLength = view.getUint16(at + 32, true);
      const local = view.getUint32(at + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const raw = bytes.subarray(start, start + size);
      const data = method === 0 ? raw.slice() : await through(raw, new DecompressionStream("deflate-raw"));
      files.push({ name, data });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return files;
  }

  /* Builds an archive from [{ name, data }]. Entries are compressed; Word requires [Content_Types].xml first,
     so the original order is kept. */
  async function zip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
    for (const f of files) {
      const name = enc.encode(f.name);
      const packed = await through(f.data, new CompressionStream("deflate-raw"));
      const crc = crc32(f.data);
      const header = new DataView(new ArrayBuffer(30));
      header.setUint32(0, 0x04034b50, true);
      header.setUint16(4, 20, true);
      header.setUint16(8, 8, true);
      header.setUint16(12, date, true);
      header.setUint32(14, crc, true);
      header.setUint32(18, packed.length, true);
      header.setUint32(22, f.data.length, true);
      header.setUint16(26, name.length, true);
      parts.push(new Uint8Array(header.buffer), name, packed);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(10, 8, true);
      entry.setUint16(14, date, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, packed.length, true);
      entry.setUint32(24, f.data.length, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), name);
      offset += 30 + name.length + packed.length;
    }
    const centralSize = central.reduce((n, p) => n + p.length, 0);
    const endRecord = new DataView(new ArrayBuffer(22));
    endRecord.setUint32(0, 0x06054b50, true);
    endRecord.setUint16(8, files.length, true);
    endRecord.setUint16(10, files.length, true);
    endRecord.setUint32(12, centralSize, true);
    endRecord.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(endRecord.buffer)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  }

  return { unzip, zip, crc32, fromBase64 };
})();
