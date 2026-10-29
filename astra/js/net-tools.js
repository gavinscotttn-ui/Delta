/* Network helpers for the Toolkit, search and Ask: MAC address formats, IPv4 subnets, and SIP response and
   ISDN (Q.850) cause codes. No DOM, no state. */
window.AstraNet = (function () {
  "use strict";

  /* ------------------------------------------------------------------ MAC */

  /* Any common way of writing a MAC address in, every common way out. Returns null if it is not a MAC. */
  function mac(input) {
    const hex = String(input).replace(/[\s:.\-]/g, "");
    if (!/^[0-9a-f]{12}$/i.test(hex)) return null;
    const up = hex.toUpperCase();
    const pairs = up.match(/../g);
    return {
      plain: up,
      colons: pairs.join(":"),
      dashes: pairs.join("-"),
      dots: up.toLowerCase().match(/..../g).join("."),
      lower: up.toLowerCase(),
    };
  }

  /* --------------------------------------------------------------- subnet */

  const toInt = (ip) => ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
  const toIp = (n) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
  const validIp = (ip) => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split(".").every((o) => Number(o) <= 255);

  function maskBits(mask) {
    if (!validIp(mask)) return -1;
    const bin = toInt(mask).toString(2).padStart(32, "0");
    return /^1*0*$/.test(bin) ? (bin.indexOf("0") === -1 ? 32 : bin.indexOf("0")) : -1;
  }

  function scope(n) {
    const ip = toIp(n);
    if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return "Private";
    if (/^127\./.test(ip)) return "Loopback";
    if (/^169\.254\./.test(ip)) return "Link-local (no DHCP address was received)";
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return "Carrier-grade NAT";
    return "Public";
  }

  /* "192.168.1.10/24", "192.168.1.10 255.255.255.0" or a bare address (assumed /24). Returns null if invalid. */
  function subnet(input) {
    const m = String(input)
      .trim()
      .match(/^(\d{1,3}(?:\.\d{1,3}){3})(?:\s*\/\s*(\d{1,2})|\s+(\d{1,3}(?:\.\d{1,3}){3}))?$/);
    if (!m || !validIp(m[1])) return null;
    const bits = m[2] !== undefined ? Number(m[2]) : m[3] ? maskBits(m[3]) : 24;
    if (!(bits >= 0 && bits <= 32)) return null;
    const ip = toInt(m[1]);
    const size = 2 ** (32 - bits);
    const network = Math.floor(ip / size) * size;
    const broadcast = network + size - 1;
    const usable = bits >= 31 ? size : size - 2;
    return {
      address: m[1],
      prefix: bits,
      mask: toIp(2 ** 32 - size),
      wildcard: toIp(size - 1),
      network: toIp(network),
      broadcast: toIp(broadcast),
      first: toIp(bits >= 31 ? network : network + 1),
      last: toIp(bits >= 31 ? broadcast : broadcast - 1),
      hosts: usable,
      scope: scope(ip),
      assumed: m[2] === undefined && !m[3],
    };
  }

  /* ---------------------------------------------------------------- codes */

  /* SIP responses: RFC 3261 (422 from RFC 4028). The note is what the code usually means on a service desk. */
  const SIP = [
    [100, "Trying", "The call is being processed. Normal."],
    [180, "Ringing", "The far end is ringing. Normal."],
    [181, "Call Is Being Forwarded", "The call is being diverted. Normal."],
    [182, "Queued", "The call is queued at the far end."],
    [183, "Session Progress", "Early audio, such as a ringback tone or announcement. Normal."],
    [200, "OK", "Success."],
    [202, "Accepted", "Request accepted for processing, for example a transfer."],
    [301, "Moved Permanently", "The user has a new permanent address."],
    [302, "Moved Temporarily", "The call is redirected, often by call forwarding."],
    [400, "Bad Request", "The request was malformed. Usually a device or configuration fault."],
    [
      401,
      "Unauthorized",
      "A login challenge. Normal once; repeated means the SIP username or password is wrong.",
    ],
    [
      403,
      "Forbidden",
      "Refused: the call is barred, the account is not allowed to make it, or the credentials are wrong.",
    ],
    [404, "Not Found", "The number or user does not exist on that system."],
    [405, "Method Not Allowed", "The request type is not supported by that device."],
    [
      407,
      "Proxy Authentication Required",
      "A login challenge from the proxy. Repeated means wrong credentials.",
    ],
    [
      408,
      "Request Timeout",
      "No response in time: the device is offline, or a firewall or network is dropping traffic.",
    ],
    [410, "Gone", "The user existed but is no longer available at that address."],
    [415, "Unsupported Media Type", "The far end cannot handle the message body format."],
    [422, "Session Interval Too Small", "Session timer settings differ between the two ends."],
    [423, "Interval Too Brief", "The registration expiry requested is too short for the server."],
    [480, "Temporarily Unavailable", "The user is not registered, is unavailable, or has Do Not Disturb on."],
    [
      481,
      "Call/Transaction Does Not Exist",
      "The far end does not recognise the call, often after a timeout or failover.",
    ],
    [482, "Loop Detected", "The call is going round in a loop, often from forwarding set up in a circle."],
    [483, "Too Many Hops", "The call passed through too many servers, often a routing loop."],
    [484, "Address Incomplete", "The number dialled is too short or incomplete."],
    [486, "Busy Here", "The called user is busy."],
    [
      487,
      "Request Terminated",
      "The call was cancelled, usually because the caller hung up before it was answered.",
    ],
    [488, "Not Acceptable Here", "No codec or media setting both ends support. Check codecs and SIP ALG."],
    [491, "Request Pending", "Two changes to the call crossed. Usually clears on retry."],
    [500, "Server Internal Error", "A fault on the server handling the call."],
    [501, "Not Implemented", "The server does not support that request."],
    [502, "Bad Gateway", "An upstream server or carrier gave an invalid response."],
    [503, "Service Unavailable", "The server is overloaded, under maintenance, or a trunk is down."],
    [504, "Server Time-out", "An upstream server or carrier did not respond in time."],
    [600, "Busy Everywhere", "The user is busy on every device."],
    [603, "Decline", "The called user rejected the call."],
    [604, "Does Not Exist Anywhere", "The number or user does not exist anywhere."],
    [606, "Not Acceptable", "The user's devices cannot accept the call's media."],
  ];

  /* ISDN cause values: ITU-T Q.850, as reported by carriers and phone systems when a call ends or fails. */
  const CAUSES = [
    [1, "Unallocated (unassigned) number", "The number is not in service."],
    [3, "No route to destination", "The network cannot route to that number."],
    [16, "Normal call clearing", "One side hung up. Normal."],
    [17, "User busy", "The called party is busy."],
    [
      18,
      "No user responding",
      "The called device did not respond, often because it is unregistered or offline.",
    ],
    [19, "No answer from user (user alerted)", "It rang but nobody answered."],
    [20, "Subscriber absent", "The mobile or user is unreachable, for example switched off."],
    [21, "Call rejected", "The called party, or a rule on their system, refused the call."],
    [22, "Number changed", "The number has changed."],
    [27, "Destination out of order", "The far end's line or equipment is not working."],
    [28, "Invalid number format", "The number dialled is incomplete or wrongly formatted."],
    [31, "Normal, unspecified", "A normal ending with no more specific reason."],
    [34, "No circuit/channel available", "No capacity on the route: all channels are in use."],
    [38, "Network out of order", "A network fault that is likely to last."],
    [41, "Temporary failure", "A short-term network fault. Try again."],
    [42, "Switching equipment congestion", "The network is congested. Try again."],
    [44, "Requested circuit/channel not available", "The specific channel requested is in use."],
    [47, "Resource unavailable, unspecified", "A network resource is unavailable."],
    [50, "Requested facility not subscribed", "The line or account is not set up for that type of call."],
    [57, "Bearer capability not authorized", "The call type is not allowed on this line or account."],
    [58, "Bearer capability not presently available", "The call type is not available right now."],
    [65, "Bearer capability not implemented", "The network does not support that call type."],
    [88, "Incompatible destination", "The far end cannot accept that type of call."],
    [102, "Recovery on timer expiry", "A network timer ran out, often from signalling not getting through."],
    [111, "Protocol error, unspecified", "A signalling error between systems."],
    [127, "Interworking, unspecified", "The call passed between networks that could not say why it failed."],
  ];

  const entry =
    (kind) =>
    ([code, name, meaning]) => ({ kind, code, name, meaning });
  const SIP_LIST = SIP.map(entry("SIP"));
  const CAUSE_LIST = CAUSES.map(entry("Cause"));

  /* Finds codes in a question: "sip 486", "error 403", "cause 17", "q.850 34", or a bare SIP code on its own.
     A bare small number is not treated as a cause: it is too often something else. */
  function lookup(query) {
    const q = String(query).toLowerCase();
    const out = [];
    const add = (list, code) => {
      const e = list.find((x) => x.code === code);
      if (e && !out.includes(e)) out.push(e);
    };
    for (const m of q.matchAll(
      /\b(?:q\.?\s?850|isdn|cause|clearing cause|release cause)\s*(?:code|value)?\s*#?(\d{1,3})\b/g,
    ))
      add(CAUSE_LIST, Number(m[1]));
    for (const m of q.matchAll(
      /\b(?:sip|error|response|code|status)\s*(?:code|error|response)?\s*#?([1-6]\d\d)\b/g,
    ))
      add(SIP_LIST, Number(m[1]));
    for (const m of q.matchAll(/\b([1-6]\d\d)\s+(?:error|response|from the carrier|on calls?)\b/g))
      add(SIP_LIST, Number(m[1]));
    const bare = q.trim().match(/^([1-6]\d\d)$/);
    if (bare) add(SIP_LIST, Number(bare[1]));
    /* By name: "busy here", "request timeout", "normal call clearing" */
    if (!out.length && q.trim().length >= 6)
      for (const e of [...SIP_LIST, ...CAUSE_LIST]) if (q.includes(e.name.toLowerCase())) out.push(e);
    return out;
  }

  /* For the Toolkit list: everything matching the text, by code or words. */
  function search(text) {
    const q = String(text).trim().toLowerCase();
    if (!q) return [...SIP_LIST, ...CAUSE_LIST];
    const found = lookup(q);
    if (found.length) return found;
    return [...SIP_LIST, ...CAUSE_LIST].filter(
      (e) => String(e.code) === q || `${e.name} ${e.meaning}`.toLowerCase().includes(q),
    );
  }

  return { mac, subnet, lookup, search, SIP: SIP_LIST, CAUSES: CAUSE_LIST };
})();
