/* Yealink desk phone basics that the supplier documents in /library do not cover. */
(function (seed) {
  const L = (...lines) => lines.join("\n");

  seed.knowledge.push({
    id: "kb-yealink-desk-basics",
    title: "Yealink T46U / T74W: find the IP, open the web page, reboot and factory reset",
    type: "How-to",
    category: "Yealink",
    quick: "Yealink: IP, web page, reset",
    tags: [
      "yealink",
      "t46u",
      "t74w",
      "t46s",
      "ip address",
      "web interface",
      "web ui",
      "factory reset",
      "reset to factory",
      "reboot",
      "admin password",
      "default password",
      "desk phone",
    ],
    summary:
      "Finding a Yealink desk phone's IP address, opening its web page, rebooting it and resetting it to factory settings.",
    rich: true,
    body: L(
      "## Find the IP address",
      "1. On the idle screen press **OK**.",
      "2. Read the address on the **IPv4** line.",
      "",
      "## Open the web page",
      "1. In a browser on the same network, go to the phone's IP address.",
      "2. The factory login is **admin** with the password **admin**. A phone that has been provisioned may use a different password.",
      "",
      "## Reboot",
      "Hold the **X** key under the arrow keys, then press **OK** at the prompt.",
      "",
      "## Factory reset",
      "A reset clears the phone's settings, so it will need provisioning again afterwards: follow the reprovision guide.",
      "",
      "| Method | Steps |",
      "|---|---|",
      "| Web page | **Settings** > **Upgrade** > **Reset to Factory Settings**. |",
      "| Phone menu | **Menu** > **Advanced Settings** (administrator password, **admin** by default) > **Reset Config** > **Reset to Factory Settings**. |",
      "| OK key | Hold **OK** until the phone asks **Reset to factory settings?**, then confirm. |",
      "",
      "For Wi-Fi and Bluetooth on the T74W, see Yealink's T74W Quick Reference Guide.",
    ),
    related: ["kb-yealink-reprovision", "kb-horizon-profile-rules", "kb-yealink-t46u-quick"],
  });
})(window.AstraSeed);
