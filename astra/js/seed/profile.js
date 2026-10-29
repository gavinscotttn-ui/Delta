/* Default profile for a fresh workspace. Used to sign replies and stamp notes; editable in Settings. */
(function (seed) {
  /* Name and initials are asked for at first-run setup: nobody signs as someone else by default. */
  seed.profile = { name: "", company: "Telecom Networks", initials: "" };
})(window.AstraSeed);
