// Inhouse-Formular: Live-Kursberechnung "X Personen -> Y Kurse" (max. 20/Kurs).
// Eigenständig, keine Abhängigkeit von booking.js oder site.js. Vorbild: personal-paramedic.de
// (app-e15e9982.js, Funktion updCalc, Math.ceil(n/20)). Der statische Hinweistext im
// Formular bleibt als Baseline ohne JavaScript stehen — das hier ist eine Ergänzung.
(function () {
  var an = document.getElementById("f-teilnehmerzahl");
  var calc = document.getElementById("ih-calc");
  if (!an || !calc) return;
  function upd() {
    var n = parseInt(an.value, 10) || 0;
    if (n <= 0) { calc.hidden = true; return; }
    var k = Math.ceil(n / 20);
    calc.hidden = false;
    calc.innerHTML = k <= 1
      ? "<b>1 Kurs</b> reicht aus — max. 20 Teilnehmende pro Kurs."
      : "Bei " + n + " Teilnehmenden sind <b>" + k + " Kurse</b> nötig (max. 20 pro Kurs).";
  }
  an.addEventListener("input", upd);
})();
