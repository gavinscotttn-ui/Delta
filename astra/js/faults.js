/* Fault reports for the supplier, built only from what the guides say each one needs:
   - Horizon call faults: Gamma's "raising a fault" guide (kb-horizon-raise-fault): at least three call examples, each
     with the date and time, calling number, destination number, handset make and model and what happened, plus the
     access investigation and codec for quality faults.
   - Broadband and phone line faults: Gamma's first-line checks (kb-gamma-broadband-checks), and our T&Cs 4.2: before
     a fault goes to Openreach the customer must accept that call-out charges apply if no fault is found (from £85 per
     hour; aborted visit £180). */
window.AstraFaults = (function () {
  "use strict";

  const MIN_EXAMPLES = 3;
  const CHARGES =
    "call-out charges apply if no fault is found (starting from £85 per hour; aborted visit £180)";

  /* The first-line checks, in the guide's order, as the questions the report answers. */
  const LINE_CHECKS = [
    { id: "power", label: "Router powered up, and its cables connected correctly" },
    { id: "reboot", label: "Router rebooted" },
    { id: "master", label: "Router in the master socket, other equipment removed from the line" },
    { id: "test-socket", label: "Phone tried in the test socket behind the master socket faceplate" },
    { id: "quiet-line", label: "Quiet line test (17070, option 2)" },
  ];

  const clean = (v) =>
    String(v ?? "")
      .replace(/\s+/g, " ")
      .trim();

  /* A call example is usable once every detail Gamma asks for is there. */
  const EXAMPLE_FIELDS = [
    ["when", "Date and time"],
    ["from", "Calling number"],
    ["to", "Destination number"],
    ["handset", "Handset make and model"],
    ["what", "What happened"],
  ];
  const exampleComplete = (e) => EXAMPLE_FIELDS.every(([k]) => clean(e?.[k]));

  function horizon(input) {
    const x = input || {};
    const examples = (Array.isArray(x.examples) ? x.examples : []).filter((e) =>
      EXAMPLE_FIELDS.some(([k]) => clean(e?.[k])),
    );
    const missing = [];
    const complete = examples.filter(exampleComplete).length;
    if (complete < MIN_EXAMPLES)
      missing.push(
        `${MIN_EXAMPLES - complete} more complete call example${MIN_EXAMPLES - complete === 1 ? "" : "s"} (Gamma asks for at least ${MIN_EXAMPLES})`,
      );
    if (!clean(x.problem)) missing.push("what the fault is");
    if (x.quality && !clean(x.access)) missing.push("the outcome of your access investigation");
    if (x.quality && !clean(x.codec)) missing.push("the codec in use");
    const lines = [
      ...(clean(x.ref) ? [`Our reference: ${clean(x.ref)}`] : []),
      ...(clean(x.customer)
        ? [`Customer: ${clean(x.customer)}${clean(x.site) ? `, ${clean(x.site)}` : ""}`]
        : []),
      `Fault: ${clean(x.problem) || "[what the fault is]"}`,
      "",
      "Call examples:",
      ...examples.map(
        (e, i) =>
          `${i + 1}. ${EXAMPLE_FIELDS.map(([k, label]) => `${label}: ${clean(e[k]) || "[missing]"}`).join("; ")}`,
      ),
      ...(examples.length ? [] : ["[none yet]"]),
    ];
    if (x.quality)
      lines.push(
        "",
        `Access investigation: ${clean(x.access) || "[missing]"}`,
        `Codec: ${clean(x.codec) || "[missing]"}`,
      );
    if (clean(x.notes)) lines.push("", clean(x.notes));
    return { text: lines.join("\n"), missing, complete };
  }

  function line(input) {
    const x = input || {};
    const done = new Set(Array.isArray(x.checks) ? x.checks : []);
    const missing = [];
    if (!clean(x.problem)) missing.push("what the fault is");
    if (!x.charges) missing.push("the customer's acceptance of the call-out charges (T&Cs 4.2)");
    const notDone = LINE_CHECKS.filter((c) => !done.has(c.id));
    const lines = [
      ...(clean(x.ref) ? [`Our reference: ${clean(x.ref)}`] : []),
      ...(clean(x.customer) ? [`Customer: ${clean(x.customer)}`] : []),
      ...(clean(x.site) ? [`Site: ${clean(x.site)}`] : []),
      ...(clean(x.number) ? [`Line or service: ${clean(x.number)}`] : []),
      `Fault: ${clean(x.problem) || "[what the fault is]"}`,
      "",
      "First-line checks done with the customer:",
      ...LINE_CHECKS.filter((c) => done.has(c.id)).map((c) => `- ${c.label}`),
      ...(done.size ? [] : ["- None yet"]),
    ];
    if (clean(x.lights)) lines.push(`Router lights: ${clean(x.lights)}`);
    if (clean(x.result)) lines.push(`Result: ${clean(x.result)}`);
    if (clean(x.access)) lines.push(`Site access and contact: ${clean(x.access)}`);
    lines.push(
      "",
      x.charges
        ? `The customer accepts that ${CHARGES}.`
        : `Not yet confirmed: the customer accepts that ${CHARGES}.`,
    );
    return { text: lines.join("\n"), missing, notDone: notDone.map((c) => c.label) };
  }

  return { MIN_EXAMPLES, CHARGES, LINE_CHECKS, EXAMPLE_FIELDS, horizon, line, exampleComplete };
})();
