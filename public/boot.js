// The boot checks (PLAN D-30), from amorfus's boot.js. A classic script,
// run before the module, so it runs where modules can't. The page is never
// blank: index.html's message shows until the app has started, and a
// failure replaces it with its own, which stays. Codes:
//   F  opened from a file:// URL;
//   S  an insecure context: plain http, not from localhost;
//   W  no WebGL 2, which the module reports when it makes its context;
//   L  the load timeout: the app hasn't started within 20 s.
// html[data-boot] holds the code shown, or "loading" while the app loads,
// or "started". window.terriestBoot, defined only once F and S have
// passed, is how the module reports that it has started or found no
// WebGL 2; it's absent where they failed, so the module does nothing.
(function () {
  'use strict';
  var LOAD_TIMEOUT_MS = 20000;
  var SERVE =
    'To serve a copy on this computer, run `python3 -m http.server 8000` in the folder that ' +
    'holds index.html, or use any static file server, then open `http://localhost:8000/`.';
  var root = document.documentElement;

  /** A paragraph whose `quoted` parts are code. */
  function paragraph(text) {
    var p = document.createElement('p');
    var parts = text.split('`');
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        p.appendChild(document.createTextNode(parts[i]));
      } else {
        var code = document.createElement('code');
        code.textContent = parts[i];
        p.appendChild(code);
      }
    }
    return p;
  }

  function show(code, title, paragraphs) {
    var main = document.getElementById('fallback');
    var heading = document.getElementById('fallback-title');
    if (!main || !heading) return;
    heading.textContent = title;
    while (heading.nextSibling) main.removeChild(heading.nextSibling);
    for (var i = 0; i < paragraphs.length; i++) main.appendChild(paragraph(paragraphs[i]));
    root.setAttribute('data-boot', code);
    heading.focus();
  }

  if (location.protocol === 'file:') {
    show('F', "terriest can't run from a file", [
      'This page was opened as a file, from an address that starts `file://`. The game has to ' +
        'come from a web server, even on this computer.',
      SERVE,
    ]);
    return;
  }
  if (!window.isSecureContext) {
    show('S', 'terriest needs a secure connection', [
      "This page came over plain http from an address that isn't this computer's own, so the " +
        'browser holds back what the game needs to reach other players. Open it over https, or ' +
        'on this computer at a localhost address.',
      SERVE,
    ]);
    return;
  }

  var timer = setTimeout(function () {
    show('L', 'terriest is taking too long to start', [
      "The page loaded, but the game didn't start within " + LOAD_TIMEOUT_MS / 1000 + ' seconds. ' +
        'A content blocker, a broken connection or a half-finished update of the site can cause this.',
      'Reload the page to try again.',
    ]);
  }, LOAD_TIMEOUT_MS);
  root.setAttribute('data-boot', 'loading');

  window.terriestBoot = {
    started: function () {
      clearTimeout(timer);
      var main = document.getElementById('fallback');
      if (main) main.parentNode.removeChild(main);
      root.setAttribute('data-boot', 'started');
    },
    noWebGL2: function () {
      clearTimeout(timer);
      show('W', 'terriest needs WebGL 2', [
        "The game draws with WebGL 2, which this browser didn't offer to this page. It may be " +
          "switched off, or blocked for this computer's graphics.",
        'Current Chrome, Edge, Firefox and Safari all have it. Check that graphics acceleration ' +
          "is on in the browser's settings, update the browser, or try another.",
      ]);
    },
  };
})();
