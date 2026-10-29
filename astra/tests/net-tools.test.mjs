import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync("js/net-tools.js", "utf8"), sandbox);
const N = sandbox.AstraNet;
const plain = (x) => JSON.parse(JSON.stringify(x));

test("MAC addresses: any common format in, every format out", () => {
  for (const input of [
    "805ec012abcd",
    "80:5E:C0:12:AB:CD",
    "80-5e-c0-12-ab-cd",
    "805e.c012.abcd",
    " 80 5E C0 12 AB CD ",
  ])
    assert.deepEqual(plain(N.mac(input)), {
      plain: "805EC012ABCD",
      colons: "80:5E:C0:12:AB:CD",
      dashes: "80-5E-C0-12-AB-CD",
      dots: "805e.c012.abcd",
      lower: "805ec012abcd",
    });
  assert.equal(N.mac("805EC012ABC"), null, "11 characters");
  assert.equal(N.mac("805EC012ABCG"), null, "not hex");
});

test("subnets: CIDR, dotted mask, bare address", () => {
  const a = plain(N.subnet("192.168.1.45/24"));
  assert.deepEqual(
    [a.network, a.broadcast, a.first, a.last, a.mask, a.wildcard, a.hosts, a.scope],
    [
      "192.168.1.0",
      "192.168.1.255",
      "192.168.1.1",
      "192.168.1.254",
      "255.255.255.0",
      "0.0.0.255",
      254,
      "Private",
    ],
  );
  const b = plain(N.subnet("10.20.30.40 255.255.252.0"));
  assert.deepEqual([b.prefix, b.network, b.broadcast, b.hosts], [22, "10.20.28.0", "10.20.31.255", 1022]);
  const c = plain(N.subnet("80.83.208.10/20"));
  assert.deepEqual([c.network, c.last, c.scope], ["80.83.208.0", "80.83.223.254", "Public"]);
  assert.equal(N.subnet("192.168.1.5").assumed, true);
  assert.equal(N.subnet("169.254.3.4/16").scope, "Link-local (no DHCP address was received)");
  const p31 = plain(N.subnet("1.2.3.4/31"));
  assert.deepEqual([p31.hosts, p31.first, p31.last], [2, "1.2.3.4", "1.2.3.5"]);
  assert.equal(N.subnet("192.168.1.300/24"), null);
  assert.equal(N.subnet("10.0.0.1 255.0.255.0"), null, "non-contiguous mask");
  assert.equal(N.subnet("10.0.0.1/33"), null);
});

test("codes are found in a question, and not invented", () => {
  const codes = (q) => plain(N.lookup(q)).map((e) => `${e.kind} ${e.code}`);
  assert.deepEqual(codes("calls failing with sip 486"), ["SIP 486"]);
  assert.deepEqual(codes("getting a 403 error on outbound calls"), ["SIP 403"]);
  assert.deepEqual(codes("carrier says cause 34"), ["Cause 34"]);
  assert.deepEqual(codes("Q.850 cause 16 and SIP 487"), ["Cause 16", "SIP 487"]);
  assert.deepEqual(codes("488"), ["SIP 488"]);
  assert.deepEqual(codes("busy here"), ["SIP 486"]);
  assert.deepEqual(codes("sip 999"), [], "not a real code");
  assert.deepEqual(codes("I have 17 users"), [], "a bare small number is not a cause");
  assert.deepEqual(codes("ticket 48213"), []);
  assert.match(N.lookup("sip 488")[0].meaning, /codec/i);
});

test("the code tables have no duplicates and every entry is complete", () => {
  for (const list of [N.SIP, N.CAUSES]) {
    const seen = new Set();
    for (const e of list) {
      assert.ok(!seen.has(e.code), `duplicate ${e.code}`);
      seen.add(e.code);
      assert.ok(e.name && e.meaning);
    }
  }
  assert.ok(N.search("timeout").some((e) => e.code === 408));
  assert.equal(N.search("").length, N.SIP.length + N.CAUSES.length);
});
