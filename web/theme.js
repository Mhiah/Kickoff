// Light or dark. Runs before the page is drawn, so there is no flash of the wrong one.
// A visitor first sees whichever their own device is set to. Once they flip the switch, their
// choice is remembered on that device.
(function () {
  var KEY = "kickoff-theme";
  function saved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function fromDevice() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
  }
  apply(saved() || fromDevice());
  window.kickoffTheme = {
    current: function () { return document.documentElement.getAttribute("data-theme"); },
    flip: function () {
      var next = this.current() === "dark" ? "light" : "dark";
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* private browsing: the choice lasts for this visit */ }
      return next;
    },
  };
})();
