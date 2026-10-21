// Settings: the "Robot" section. Loads the robot picker from /robot.js into the card.
(function () {
  'use strict';
  var S = window.ChowaniecSettings;
  var host = document.getElementById('robot-host');
  if (!host) return;
  function start() {
    if (window.ChowaniecRobot) { window.ChowaniecRobot.mountPicker(host, {}); return; }
    var sc = document.createElement('script');
    sc.src = '/robot.js';
    sc.onload = function () { window.ChowaniecRobot.mountPicker(host, {}); };
    sc.onerror = function () { host.textContent = 'The robot picker could not load. Check your connection.'; };
    document.head.appendChild(sc);
  }
  if (S && S.whenSignedIn) S.whenSignedIn(start); else start();
})();
