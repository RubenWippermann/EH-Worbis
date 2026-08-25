/* Chat-Assistentin, öffentliche Websites (25.08.2026)
 *
 * Gefunden beim Sweep durch worker/public.ts: /api/assistent stand seit Wochen
 * vollständig gebaut da (Rate-Limit, Kontext aus echten Kursdaten, eigener
 * Anthropic-Aufruf) — nur nirgends verlinkt. Dieser Baustein ist der fehlende
 * Anschluss, für alle Websites gleich (eine Datei, mehrfach eingebunden statt
 * mehrfach geschrieben — dieselbe Regel wie bei SEITEN_OPTIK).
 *
 * Liest window.EHD_CONFIG (existiert bereits, jede Seite trägt es): `api` für
 * die Basis-Adresse, `orgLead` für die Firma. Keine zweite Konfiguration nötig.
 *
 * ⚠️ Läuft OHNE Fehlermeldung leer, wenn EHD_CONFIG fehlt — eine Website ohne
 * dieses Objekt bekommt keinen kaputten Chat, sondern gar keinen. Genau die
 * Regel, die überall im Haus gilt: ein Baustein darf die Seite um sich herum
 * nie mitreißen.
 *
 * Kein Framework, keine Abhängigkeit — reines JS/CSS in einer Datei, damit sie
 * sich unverändert in jede der Website-Repos kopieren lässt (Worbis, Duderstadt,
 * .online). Bei Änderungen: an ALLEN Stellen nachziehen, sonst laufen drei
 * Fassungen desselben Bausteins auseinander.
 */
(function () {
  "use strict";
  var cfg = window.EHD_CONFIG;
  if (!cfg || !cfg.api) return;

  var API = cfg.api;
  var ORG = cfg.orgLead || "bww";
  var verlauf = []; // { role: "user"|"assistant", content: string }
  var name = null; // kommt aus der ersten Antwort (Auftrag: WEB_ASSISTANT[org] zeigen)
  var offen = false;
  var sendetGerade = false;

  // ── Minimales, SICHERES Markdown: erst escapen, dann NUR **fett** und [text](url)
  // zulassen. Die Antworten kommen aus einem Sprachmodell — roh als HTML einsetzen
  // wäre ein Einfallstor. Escapen zuerst, Auszeichnung danach, nie umgekehrt.
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function leichtesMarkdown(s) {
    var t = escapeHtml(s);
    t = t.replace(/\[([^\]]+)\]\(([^)"]+)\)/g, function (_, txt, url) {
      // Nur eigene, relative Links zulassen (führt zur eigenen Buchungsseite) —
      // ein Modell soll keinen beliebigen externen Link einsetzen können.
      if (!/^\//.test(url)) return escapeHtml(txt);
      return '<a href="' + url.replace(/"/g, "%22") + '">' + txt + "</a>";
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/\n/g, "<br>");
    return t;
  }

  // ── Aufbau: ein Knopf unten rechts, ein Fenster, das sich darüber öffnet.
  var wurzel = document.createElement("div");
  wurzel.id = "eh-assistent";
  wurzel.innerHTML =
    '<button type="button" class="eha-knopf" aria-label="Chat öffnen" aria-expanded="false">💬</button>' +
    '<div class="eha-fenster" hidden role="dialog" aria-label="Chat">' +
    '  <div class="eha-kopf"><span class="eha-name">Chat</span><button type="button" class="eha-schliessen" aria-label="Schließen">✕</button></div>' +
    '  <div class="eha-verlauf" aria-live="polite"></div>' +
    '  <form class="eha-form">' +
    '    <input class="eha-eingabe" type="text" placeholder="Ihre Frage …" autocomplete="off" maxlength="500">' +
    '    <button type="submit" class="eha-senden" aria-label="Senden">➤</button>' +
    "  </form>" +
    "</div>";
  document.body.appendChild(wurzel);

  var style = document.createElement("style");
  style.textContent =
    "#eh-assistent{position:fixed;right:16px;bottom:16px;z-index:9000;font-family:inherit}" +
    ".eha-knopf{width:56px;height:56px;border-radius:50%;border:0;background:#0b63a9;color:#fff;font-size:24px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.22)}" +
    ".eha-fenster{position:fixed;right:16px;bottom:84px;width:min(340px,calc(100vw - 32px));height:min(460px,calc(100vh - 140px));background:#fff;border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden}" +
    ".eha-kopf{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#0b63a9;color:#fff;font-weight:700}" +
    ".eha-schliessen{background:none;border:0;color:#fff;font-size:16px;cursor:pointer;padding:2px 6px}" +
    ".eha-verlauf{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;font-size:.92rem}" +
    ".eha-blase{max-width:82%;padding:8px 11px;border-radius:12px;line-height:1.45}" +
    ".eha-blase.bot{align-self:flex-start;background:#f0f3f8;color:#14243c}" +
    ".eha-blase.user{align-self:flex-end;background:#0b63a9;color:#fff}" +
    ".eha-blase a{color:inherit;text-decoration:underline}" +
    ".eha-form{display:flex;gap:6px;padding:10px;border-top:1px solid #e8edf4}" +
    ".eha-eingabe{flex:1;min-height:40px;padding:0 10px;border:1px solid #d8e0ea;border-radius:20px;font:inherit}" +
    ".eha-senden{width:40px;height:40px;border-radius:50%;border:0;background:#0b63a9;color:#fff;cursor:pointer;font-size:16px}" +
    ".eha-senden:disabled,.eha-eingabe:disabled{opacity:.55;cursor:not-allowed}" +
    "@media (max-width:480px){.eha-fenster{right:8px;bottom:72px}}";
  document.head.appendChild(style);

  var knopf = wurzel.querySelector(".eha-knopf");
  var fenster = wurzel.querySelector(".eha-fenster");
  var verlaufEl = wurzel.querySelector(".eha-verlauf");
  var nameEl = wurzel.querySelector(".eha-name");
  var form = wurzel.querySelector(".eha-form");
  var eingabe = wurzel.querySelector(".eha-eingabe");
  var senden = wurzel.querySelector(".eha-senden");

  function blase(text, wer) {
    var el = document.createElement("div");
    el.className = "eha-blase " + wer;
    el.innerHTML = leichtesMarkdown(text);
    verlaufEl.appendChild(el);
    verlaufEl.scrollTop = verlaufEl.scrollHeight;
  }

  function oeffnen() {
    offen = true;
    fenster.hidden = false;
    knopf.setAttribute("aria-expanded", "true");
    eingabe.focus();
    // Erste Nachricht erst beim ersten Öffnen — kein Aufruf, solange niemand
    // den Knopf gedrückt hat. Ein Gruß-Aufruf ohne Nutzerabsicht wäre unnötige
    // Last auf einem Endpunkt, der ohnehin ratenbegrenzt ist.
    if (!verlaufEl.childElementCount) {
      blase("Hallo! Wie kann ich Ihnen helfen?", "bot");
    }
  }
  function schliessen() {
    offen = false;
    fenster.hidden = true;
    knopf.setAttribute("aria-expanded", "false");
  }

  knopf.addEventListener("click", function () { offen ? schliessen() : oeffnen(); });
  wurzel.querySelector(".eha-schliessen").addEventListener("click", schliessen);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = eingabe.value.trim();
    if (!text || sendetGerade) return;
    blase(text, "user");
    eingabe.value = "";
    sendetGerade = true;
    eingabe.disabled = true;
    senden.disabled = true;

    fetch(API + "/api/assistent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org: ORG, message: text, verlauf: verlauf, website: "" }),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.name && !name) { name = j.name; nameEl.textContent = "Chat mit " + name; }
        var antwort = (j && j.reply) || "Entschuldigung, da ist gerade etwas schiefgelaufen. Bitte nutzen Sie das Kontaktformular.";
        blase(antwort, "bot");
        // Verlauf NUR bei echtem Erfolg fortschreiben — sonst würde eine
        // Fehlerantwort als „das hat die Assistentin gesagt" in die nächste
        // Anfrage wandern und das Gespräch für das Modell verfälschen.
        if (j && j.ok) {
          verlauf.push({ role: "user", content: text });
          verlauf.push({ role: "assistant", content: antwort });
          if (verlauf.length > 16) verlauf = verlauf.slice(-16);
        }
      })
      .catch(function () {
        blase("Verbindung fehlgeschlagen. Bitte später erneut versuchen oder das Kontaktformular nutzen.", "bot");
      })
      .finally(function () {
        sendetGerade = false;
        eingabe.disabled = false;
        senden.disabled = false;
        eingabe.focus();
      });
  });
})();
