import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

/* All names, numbers and addresses below are made up. Phone numbers are from Ofcom's ranges reserved for fiction. */
const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync("js/triage-core.js", "utf8"), sandbox);
const T = sandbox.AstraTriage;
const plain = (x) => JSON.parse(JSON.stringify(x));

const CALL_FAULT = `From: Sarah Jones <sarah.jones@brightwater-dental.co.uk>
Sent: 12 October 2026 09:14
Subject: Phones keep dropping calls

Hi there,

Hope you're well. Since this morning our reception phone (Yealink T46U) keeps dropping calls after about 30 seconds.
It happened at 09:02 when we called 01632 960123 and again at 09:10. The phone's IP is 192.168.1.45 and MAC 80:5E:C0:12:AB:CD.
Our ticket ref is INC-48213. Site is BS1 4DJ.

Kind regards,
Sarah Jones
Practice Manager
Brightwater Dental Ltd
Tel: 0117 496 0555

On 11 Oct 2026, Support wrote:
> Old message about 07700 900999 and SW1A 1AA
`;

test("reads a call fault email: who, where, what and the evidence", () => {
  const t = T.read(CALL_FAULT);
  assert.equal(t.sender.name, "Sarah Jones");
  assert.equal(t.sender.email, "sarah.jones@brightwater-dental.co.uk");
  assert.equal(t.sender.company, "Brightwater Dental Ltd");
  assert.equal(t.sender.domain, "brightwater-dental.co.uk");
  assert.equal(t.summary, "Phones keep dropping calls");
  const f = plain(t.facts);
  assert.deepEqual(f.models, ["Yealink T46U"]);
  assert.deepEqual(f.ips, [{ ip: "192.168.1.45", private: true }]);
  assert.deepEqual(f.macs, ["80:5E:C0:12:AB:CD"]);
  assert.deepEqual(f.tickets, ["INC-48213"]);
  assert.deepEqual(f.postcodes, ["BS1 4DJ"]);
  assert.deepEqual(f.phones, ["01632 960123"], "the number called");
  assert.deepEqual(f.contactPhones, ["0117 496 0555"], "the signature number is the contact");
  assert.deepEqual(f.times, ["09:02", "09:10"]);
  assert.ok(f.days.includes("this morning"));
  assert.ok(
    !JSON.stringify(f).includes("SW1A") && !JSON.stringify(f).includes("900999"),
    "quoted history ignored",
  );
  assert.equal(t.kind, "fault");
  assert.equal(t.priority.level, 3);
});

test("the call-fault checklist marks what is present and what is missing", () => {
  const t = T.read(CALL_FAULT);
  const calls = t.checks.find((c) => c.id === "calls");
  assert.equal(calls.guide, "kb-horizon-raise-fault");
  const item = (label) => calls.items.find((i) => i.label.startsWith(label));
  assert.equal(item("Date and time").have, false);
  assert.equal(item("Date and time").partial, "2 found");
  assert.equal(item("Calling number").have, true);
  assert.equal(item("Destination number").have, false);
  assert.equal(item("Handset make").have, true);
  const ask = T.askForDetails(t, { from: "Gavin" });
  assert.match(ask, /^Hi Sarah,/);
  assert.match(ask, /- Date and time of each call/);
  assert.match(ask, /- Destination number/);
  assert.ok(!/Handset make/.test(ask), "does not ask for what it already has");
  assert.match(ask, /Gavin$/);
});

test("the ticket note holds only what was found", () => {
  const t = T.read(CALL_FAULT);
  const note = T.ticketNote(t, { guide: "Horizon: calls drop", stamp: "12/10/2026 09:20 · GS" });
  assert.match(note, /^12\/10\/2026 09:20 · GS\nIssue: Phones keep dropping calls/);
  assert.match(note, /Reported by: Sarah Jones, sarah\.jones@brightwater-dental\.co\.uk, 0117 496 0555/);
  assert.match(note, /Equipment: Yealink T46U/);
  assert.match(note, /IP addresses: 192\.168\.1\.45 \(private\)/);
  assert.match(note, /Likely guide: Horizon: calls drop/);
  assert.match(note, /Still needed:\n- Date and time/);
  assert.ok(!/Workflow:/.test(note), "empty lines are left out");
});

test("priority: a whole site down is critical, several users high, a request low", () => {
  const p = (text) => T.read(text).priority;
  assert.equal(p("Hi, all our phones are down and nobody can make calls.").level, 1);
  assert.equal(p("The office is completely offline since 8am").level, 1);
  assert.equal(p("Several users can't hear callers on Webex").level, 2);
  assert.equal(p("Customers can't get through to our main number").level, 2);
  assert.equal(p("My handset says Initialising, it's urgent please").level, 2);
  assert.equal(p("My handset shows Initialising and won't register").level, 3);
  assert.equal(p("Could you please add a new user called Tom to our system?").level, 4);
  assert.ok(p("all our phones are down").reasons[0].includes("all our phones are down"));
});

test("broadband faults bring up the first line checks and call-out charges", () => {
  const t = T.read(
    "Our broadband has no connection since last night, router lights are red. Postcode LS1 4AP.",
  );
  const bb = t.checks.find((c) => c.id === "broadband");
  assert.equal(bb.guide, "kb-first-line-checks");
  assert.ok(bb.items.some((i) => /call-out charges/.test(i.label) && i.who === "customer"));
  assert.ok(t.facts.services.includes("Broadband") && t.facts.services.includes("Router"));
  assert.deepEqual(plain(t.facts.postcodes), ["LS1 4AP"]);
});

test("quality faults add the engineer's own checks, not questions for the customer", () => {
  const t = T.read("Calls sound robotic and choppy on our Polycom VVX 450 phones.");
  const q = t.checks.find((c) => c.id === "quality");
  assert.ok(q && q.items.every((i) => i.who === "you"));
  assert.deepEqual(plain(t.facts.models), ["Polycom VVX 450"]);
  assert.ok(!/codec/i.test(T.askForDetails(t)), "codec is not asked of the customer");
});

test("does not invent: no model, no company, no ticket when none is written", () => {
  const t = T.read("hello my phone isnt working can you help, john");
  assert.deepEqual(plain(t.facts.models), []);
  assert.equal(t.sender.company, "");
  assert.deepEqual(plain(t.facts.tickets), []);
  assert.deepEqual(plain(t.facts.postcodes), []);
  /* model names and years are not mistaken for postcodes, tickets or phones */
  const u = T.read("Our T46U and W73P stopped in 2024. Reference 12345678. Gmail user bob@gmail.com.");
  assert.deepEqual(plain(u.facts.postcodes), []);
  assert.deepEqual(plain(u.facts.models).sort(), ["Yealink T46U", "Yealink W73P"]);
  assert.equal(u.sender.domain, "", "a personal mail address says nothing about the company");
});

test("phone numbers: UK formats normalised, others ignored", () => {
  assert.equal(T.ukPhone("+44 (0)7700 900123"), "07700 900123");
  assert.equal(T.ukPhone("02079460018"), "020 7946 0018");
  assert.equal(T.ukPhone("0161 496 0000"), "0161 496 0000");
  assert.equal(T.ukPhone("0333 241 7044"), "0333 241 7044");
  assert.equal(T.ukPhone("12345"), "");
});

test("a bare MAC needs the word MAC next to it", () => {
  assert.deepEqual(plain(T.read("mac address 805EC012ABCD please").facts.macs), ["80:5E:C0:12:AB:CD"]);
  assert.deepEqual(plain(T.read("order 805EC012ABCD please").facts.macs), []);
});

test("the search query is short and about the problem", () => {
  const t = T.read(CALL_FAULT);
  assert.ok(t.query.split(" ").length <= 40);
  assert.match(t.query, /calls dropping/);
  assert.ok(t.queries.includes("Phones keep dropping calls"), "the subject is searched too");
  assert.ok(!/@|01632/.test(t.query));
});

test("requests with a form or standard email of their own are recognised, and ordinary wording is not", () => {
  const req = (text) => plain(T.read(text).requests);
  assert.deepEqual(req("Hi, we'd like to port our numbers over to you from BT. What do you need from us?"), [
    "port",
  ]);
  assert.deepEqual(req("Can we keep our existing phone numbers when we move?"), ["port"]);
  assert.deepEqual(req("We're getting a new phone system for the office next month."), ["new-system"]);
  assert.deepEqual(
    req("The handset on reception is broken, the screen is cracked. Can we get a replacement handset?"),
    ["rma"],
  );
  assert.deepEqual(req("Openreach have given us an engineer appointment for Tuesday morning."), [
    "openreach",
  ]);
  assert.deepEqual(
    req("Calls drop after 30 seconds. Ports 5060 and 10000-20000 are open, port forwarding is off."),
    [],
  );
  assert.deepEqual(req("Please send an update on the ticket."), []);
});

/* ---------------------------------------------------- found in the usability audit */

test("asking to be called back is not a call fault: a broadband email gets no call evidence list", () => {
  const t = T.read(`Subject: Internet down

Hi, our broadband has been down since 8:30 this morning and the router lights are red. Can you call me back on 0117 496 0555?

Thanks
Sarah`);
  assert.deepEqual(plain(t.checks.map((c) => c.id)), ["broadband"]);
});

test("a time in the customer's words is quoted whole, not cut at its colon", () => {
  const t = T.read(
    "Subject: Phones\n\nAll our phones are down since about 8:30 this morning, it's urgent.\n\nSarah",
  );
  assert.equal(t.priority.level, 1);
  assert.match(t.priority.reasons[0], /8:30/);
});

test("every handset not registering is the whole site, and a callback number is not a call example", () => {
  const t = T.read(`Subject: Phones

All handsets are showing Initialising since this morning.
Please call me on 0117 496 0555.

Sarah Jones
Tel: 0117 496 0555`);
  assert.equal(t.priority.level, 1, t.priority.label);
  const calls = t.checks.find((c) => c.id === "calls");
  if (calls) assert.equal(calls.items.find((i) => i.label === "Calling number").have, false);
});
