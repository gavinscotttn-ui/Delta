/* The team's everyday systems. Editable in Settings; Alt + key opens one, and Ctrl K finds them by name.
   Keys avoid Alt F, Alt E and Alt D, which Chrome uses itself, and the numbers, which open Astra's pages. */
(function (seed) {
  seed.shortcuts.push(
    { id: "gamma", title: "Gamma portal", url: "https://www.gamma-portal.com/framework/home.jspa", key: "G" },
    {
      id: "tickets",
      title: "My open tickets",
      url: "https://desk.zoho.eu/agent/thistlenetworksltdtatelecomn/thistle-networks-ltd-t-a-telecom-networks/tickets/list/my-open-cases",
      key: "T",
    },
    {
      id: "tickets-unassigned",
      title: "Unassigned tickets",
      url: "https://desk.zoho.eu/agent/thistlenetworksltdtatelecomn/thistle-networks-ltd-t-a-telecom-networks/tickets/list/unassigned-open-cases?view=table",
      key: "U",
    },
    {
      id: "crm-tasks",
      title: "CRM tasks",
      url: "https://crm.zoho.eu/crm/org20106161355/tab/Tasks/custom-view/839606000000269288/list",
      key: "C",
    },
    { id: "billing", title: "Billing", url: "https://telecom-networks.moragbilling.com/billing", key: "B" },
    {
      id: "voip-unlimited",
      title: "VOIP Unlimited portal",
      url: "https://portal2.voip-unlimited.net/",
      key: "V",
    },
    { id: "invosys", title: "Invosys", url: "https://247.invosys.com/", key: "I" },
    { id: "omnichat", title: "Omnichat inbox", url: "https://portal.omnichat.co.uk/inbox", key: "O" },
    { id: "g711", title: "g711.org", url: "https://g711.org/", key: "W" },
    {
      id: "code-lookup",
      title: "Dialling code lookup",
      url: "https://www.telecom-tariffs.co.uk/codelook.htm",
      key: "K",
    },
  );
})(window.AstraSeed);
