/* Fills in the customer Letter of Authority (the team's own Word form) and returns it as a .docx Blob.
   Fields are found by the label next to them, so the original layout and formatting are kept. */
window.AstraLOA = (function () {
  "use strict";

  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

  /* Losing providers we port from most often. "address" is what goes on the form. */
  const PROVIDERS = [
    { id: "bt", name: "BT", address: "One Braham, 1 Braham Street, London, E1 8EE", email: "porting@bt.com" },
    {
      id: "gamma",
      name: "Gamma",
      address: "Kings House, Kings Road West, Newbury, RG14 5BY",
      email: "porting@gamma.com",
    },
    {
      id: "voip-unlimited",
      name: "VOIP Unlimited",
      address: "6 Albany Business Park, Cabot Lane, Poole, BH17 7BX",
      email: "provisioning@voip-unlimited.net",
    },
  ];

  /* How many numbers fit beside the site address on page 1, and in each continuation-sheet box. */
  const PAGE1_NUMBERS = 6;
  const BOX_NUMBERS = 5;

  const text = (el) =>
    [...el.getElementsByTagNameNS(W, "t")]
      .map((t) => t.textContent)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  const cellsOf = (tr) => [...tr.children].filter((c) => c.namespaceURI === W && c.localName === "tc");

  /* Rows whose first cell starts with the label, in document order (page 1, then the continuation page). */
  function rows(doc, label) {
    return [...doc.getElementsByTagNameNS(W, "tr")].filter((tr) => {
      const first = cellsOf(tr)[0];
      return first && text(first).toLowerCase().startsWith(label.toLowerCase());
    });
  }

  /* Plain formatting for filled-in values: the same font and size as the printed "Gamma" on the form, in black. */
  function plainRunProps(doc) {
    const sample = [...doc.getElementsByTagNameNS(W, "t")].find((t) => t.textContent === "Gamma");
    const rPr = sample?.parentNode?.getElementsByTagNameNS(W, "rPr")[0];
    const props = rPr ? rPr.cloneNode(true) : doc.createElementNS(W, "w:rPr");
    for (const tag of ["color", "highlight", "b", "bCs", "i", "iCs", "caps"])
      for (const el of [...props.getElementsByTagNameNS(W, tag)]) el.remove();
    return props;
  }

  /* Replaces everything in a cell with the given lines, one paragraph each. */
  function setCell(doc, tc, lines, runProps) {
    if (!tc) return;
    const paragraphs = [...tc.children].filter((c) => c.localName === "p");
    const template = paragraphs[0];
    const pPr = template?.getElementsByTagNameNS(W, "pPr")[0];
    for (const p of paragraphs) p.remove();
    const values = lines.length ? lines : [""];
    for (const line of values) {
      const p = doc.createElementNS(W, "w:p");
      if (pPr) {
        const props = pPr.cloneNode(true);
        for (const tag of ["color", "highlight", "b", "bCs"])
          for (const el of [...props.getElementsByTagNameNS(W, tag)]) el.remove();
        p.appendChild(props);
      }
      if (line) {
        const r = doc.createElementNS(W, "w:r");
        r.appendChild(runProps.cloneNode(true));
        const t = doc.createElementNS(W, "w:t");
        t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
        t.textContent = line;
        r.appendChild(t);
        p.appendChild(r);
      }
      tc.appendChild(p);
    }
  }

  /* The form's address and company blocks are one tall merged cell beside several labels, so typed lines drift
     away from their labels. Splitting the merge puts each value in its own row, next to its own label. */
  function setRows(doc, firstRow, cellIndex, lines, runProps) {
    let tr = firstRow;
    for (const line of lines) {
      if (!tr) break;
      const tc = cellsOf(tr)[cellIndex];
      if (tc) {
        for (const vm of [...tc.getElementsByTagNameNS(W, "vMerge")]) vm.remove();
        setCell(doc, tc, [line], runProps);
      }
      do tr = tr.nextElementSibling;
      while (tr && tr.localName !== "tr");
    }
  }

  /* Characters a Word file cannot hold (control codes pasted from elsewhere) are dropped, so the file always opens. */
  const clean = (s) =>
    String(s ?? "")
      .replace(/[^\t\n\r\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
      .replace(/\s+/g, " ")
      .trim();

  /* v: the values from the form (see the LOA filler). Missing values leave the field blank. */
  function fillXml(xml, v) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length)
      throw new Error("The LOA template could not be read.");
    const run = plainRunProps(doc);
    const put = (label, cellIndex, lines, which = "all") => {
      const found = rows(doc, label);
      const targets = which === "first" ? found.slice(0, 1) : found;
      for (const tr of targets)
        setCell(
          doc,
          cellsOf(tr)[cellIndex],
          lines.map(clean).filter((l, i, a) => l || a.some(Boolean)),
          run,
        );
    };
    const nonEmpty = (lines) => lines.map(clean).filter(Boolean);

    /* Current and new retailer */
    put("Name", 1, [v.currentName], "first");
    put("Address:", 1, [v.currentAddress], "first");
    put("Contact Email", 1, [v.currentEmail], "first");
    put("Contact Email", 3, [v.newEmail], "first");

    /* Site address and numbers (tall merged cells: one value per labelled row) */
    for (const tr of rows(doc, "Building Name").slice(0, 1))
      setRows(doc, tr, 1, [v.building, v.street, v.town, v.county, v.postcode].map(clean), run);
    /* Page 1 has room for a few numbers; the rest go on the continuation sheet, as the form asks, a few per box with
       the site address beside them. If even that runs out, the last box takes the remainder. */
    const numbers = nonEmpty(v.numbers || []);
    put("Building Name", 2, numbers.slice(0, PAGE1_NUMBERS));
    const rest = numbers.slice(PAGE1_NUMBERS);
    const header = rows(doc, "Site Address(es)")[0];
    if (rest.length && header) {
      const boxes = [];
      for (let tr = header.nextElementSibling; tr && tr.localName === "tr"; tr = tr.nextElementSibling) {
        const cells = cellsOf(tr);
        if (cells.length !== 2 || text(tr)) break;
        boxes.push(cells);
      }
      const site = nonEmpty([v.building, v.street, v.town, v.postcode]).join(", ");
      boxes.forEach((cells, i) => {
        const chunk =
          i === boxes.length - 1
            ? rest.slice(i * BOX_NUMBERS)
            : rest.slice(i * BOX_NUMBERS, (i + 1) * BOX_NUMBERS);
        if (!chunk.length) return;
        setCell(doc, cells[0], [site], run);
        setCell(doc, cells[1], chunk, run);
      });
    }
    const mbn = rows(doc, "MBN")[0];
    if (mbn) setCell(doc, cellsOf(mbn).at(-1), [clean(v.mbn)], run);

    /* Company details */
    for (const tr of rows(doc, "Company Name").slice(0, 1))
      setRows(
        doc,
        tr,
        1,
        [
          v.company,
          v.billingAddress,
          v.billingTown,
          v.billingCounty,
          v.billingPostcode,
          v.regNo,
          v.accountNo,
        ].map(clean),
        run,
      );
    put("Customer Company Name", 1, [v.company]);

    /* Requester, on both pages: the customer signs each one */
    put("Print Name", 1, [v.requesterName]);
    put("Print Name", 3, [v.jobTitle]);
    put("Date", 1, [v.date]);
    put("Date", 3, [v.requesterEmail]);

    /* Both pages go to the customer, so number them 1 of 2 and 2 of 2. */
    rows(doc, "Page Number").forEach((tr, i, all) => {
      const cells = cellsOf(tr);
      setCell(doc, cells[1], [String(i + 1)], run);
      setCell(doc, cells.at(-1), [String(all.length)], run);
    });

    return new XMLSerializer().serializeToString(doc);
  }

  /* Builds the filled-in LOA. Returns a Blob ready to download. */
  async function build(values) {
    const D = window.AstraDocx;
    const files = await D.unzip(D.fromBase64(window.AstraForms.loaDocx));
    const docFile = files.find((f) => f.name === "word/document.xml");
    const xml = new TextDecoder().decode(docFile.data);
    docFile.data = new TextEncoder().encode(fillXml(xml, values));
    return D.zip(files);
  }

  return { build, fillXml, PROVIDERS, PAGE1_NUMBERS };
})();
