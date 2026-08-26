/* =============================================================================
   Erste Hilfe Duderstadt — Anbindung an die Firmensoftware (software-wippermann.de)
   -----------------------------------------------------------------------------
   Lesend : GET  /api/kurse?org=&ab_datum=&stadt=&art=   -> {kurse:[…]}
            GET  /api/bewertungen?org=                   -> {bewertungen:[…]}
   Schreib: POST /api/inhouse-anfrage · /api/kurs-buchung · /api/dozent-bewerbung
            POST /api/kontakt · /api/warteliste · /api/newsletter

   WICHTIG — Mandanten-Logik:
   • Offene Kurse (Worbis) werden von BWW veranstaltet. Deren `buchungs_url`
     enthält bereits `org=bww` und wird NIE umgeschrieben — sonst landet die
     Zahlung beim falschen Mandanten.
   • Leads dieser Website gehören Personal Paramedic (`org=personal-paramedic`)
     und tragen `quelle=erstehilfe-duderstadt` zur Attribution im Arbeitsbereich.
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.EHD_CONFIG || {};
  var API        = CFG.api        || 'https://software-wippermann.de';
  var ORG_LEAD   = CFG.orgLead    || 'personal-paramedic';
  var ORG_FEEDS  = CFG.orgFeeds   || ['bww', 'personal-paramedic'];
  var QUELLE     = CFG.quelle     || 'erstehilfe-duderstadt';
  var TEL        = CFG.tel        || '+49 5527 748849 5';
  var TEL_HREF   = CFG.telHref    || '+4955277488495';

  var MONTHS = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];

  /* ---------- Helfer ---------- */
  // Herkunft an einen Portal-Link haengen. Der Kurs-Feed liefert `…/buchen?termin=…&org=bww`
  // OHNE `quelle` (10.08.2026 an allen 41 Terminen nachgemessen) — ohne diesen Zusatz kommt
  // jede Buchung im Arbeitsbereich herkunftslos an, und niemand kann sagen, welche Website
  // die Kunden bringt. Eine vom Server mitgegebene `quelle` wird NICHT ueberschrieben:
  // bei fremden Veranstaltern kennt er die richtige besser als wir.
  function mitQuelle(u) {
    if (!u || /[?&]quelle=/.test(u)) return u;
    return u + (u.indexOf('?') === -1 ? '?' : '&') + 'quelle=' + encodeURIComponent(QUELLE);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  // Nur http(s) durchlassen. buchungs_url kommt aus dem externen Kursfeed — esc()
  // schuetzt vor kaputtem HTML, nicht vor einem Schema wie 'javascript:'.
  function sichereUrl(u, ersatz) {
    return (u && /^https?:\/\//i.test(String(u).trim())) ? u : ersatz;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fmtDate(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
    if (!m) return esc(d);
    return parseInt(m[3], 10) + '. ' + MONTHS[parseInt(m[2], 10) - 1] + ' ' + m[1];
  }
  /* Mehrtägige Kurse als Datumsbereich („12.–14. Okt. 2026") */
  function fmtRange(k) {
    var a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k.datum || '');
    var b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k.datum_ende || '');
    if (!a) return esc(k.datum);
    if (!b || k.datum_ende === k.datum) return fmtDate(k.datum);
    var d1 = +a[3], m1 = +a[2], y1 = a[1], d2 = +b[3], m2 = +b[2], y2 = b[1];
    if (y1 === y2 && m1 === m2) return d1 + '.–' + d2 + '. ' + MONTHS[m1 - 1] + ' ' + y1;
    if (y1 === y2) return d1 + '. ' + MONTHS[m1 - 1] + ' – ' + d2 + '. ' + MONTHS[m2 - 1] + ' ' + y1;
    return fmtDate(k.datum) + ' – ' + fmtDate(k.datum_ende);
  }
  function label(t) { return String(t == null ? '' : t).replace(/\s*\([^)]*\)/g, '').trim(); }
  /* Kundenname aus dem Kurstitel halten — NUR fuer die Anzeige.
     Im Kurssystem trennt " · " (Leerzeichen-Mittelpunkt-Leerzeichen) den Kurs vom
     AUFTRAGGEBER einer Inhouse-Schulung: "Erste-Hilfe-Ausbildung · Muster GmbH".
     Wird so ein Kurs versehentlich oeffentlich geschaltet, stuende der Firmenname
     auf unserer Seite. Gemessen vom Software-Chat: bei 735 von 795 Kursen ist " · "
     genau dieser Trenner, 0 legitime Zusaetze.
     DREI GRENZEN, gemeinsam mit den anderen drei Seiten festgelegt:
     (1) NUR Anzeige. buchungs_url, id und alles Gespeicherte bleiben ROH — der Zusatz
         IST die Inhouse-Zuordnung, wer ihn wegschneidet, zerstoert sie.
     (2) NUR " · " mit Leerzeichen auf beiden Seiten. Klammern und Halbgeviertstrich
         bleiben: "Erste-Hilfe-Ausbildung (Grund-/Fuehrerscheinkurs)" und
         "Lehrkraefte-Ausbildung – Themenbereich 1" sind echte Titelbestandteile.
     (3) NUR ein Anzeige-Netz auf dieser Seite. Die eigentliche Datenkorrektur
         gehoert nicht in diesen Client-Code.
     Am 17.08.2026 traf die Regel auf erstehilfe-worbis.de 0 von 37 Titeln — sie ist
     Vorsorge, keine Reparatur. Genau deshalb steht das hier: Eine Regel, die heute
     nichts tut, wird sonst beim naechsten Umbau als tot entfernt. */
  function titelAnzeige(t) {
    var s = String(t == null ? '' : t), kopf = s.split(/\s+[·•]\s+/)[0].trim();
    return kopf || s;
  }
  function jget(url) {
    return fetch(url, { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('http_' + r.status);
      return r.json();
    });
  }

  /* ---------- Termin-Feed (mehrere Mandanten, zusammengeführt) ---------- */
  var _feed = null;
  function loadFeed() {
    if (_feed) return _feed;
    var ab = today();
    _feed = Promise.all(ORG_FEEDS.map(function (org) {
      return jget(API + '/api/kurse?org=' + encodeURIComponent(org) + '&ab_datum=' + ab)
        .then(function (d) {
          return ((d && d.kurse) || []).map(function (k) { k._org = org; return k; });
        })
        .catch(function () { return null; }); // ein Mandant offline -> andere trotzdem zeigen
    })).then(function (lists) {
      var live = lists.filter(function (l) { return l !== null; });
      var all = [];
      live.forEach(function (l) { all = all.concat(l); });
      // Kein einziger Feed erreichbar -> eingebackener Snapshot als Notfall-Fallback
      if (!live.length) {
        all = (window.__EHD_TERMINE__ || []).filter(function (k) { return (k.datum || '') >= ab; });
      }
      // Dubletten (gleicher Termin über zwei Mandanten) entfernen, nach Datum sortieren
      var seen = {}, out = [];
      all.forEach(function (k) {
        var id = String(k.id || (k.kursart + k.datum));
        if (seen[id]) return;
        seen[id] = 1; out.push(k);
      });
      out.sort(function (a, b) {
        return String(a.datum).localeCompare(String(b.datum)) ||
               String(a.uhrzeit || '').localeCompare(String(b.uhrzeit || ''));
      });
      return out;
    });
    return _feed;
  }

  /* ---------- BG/UK-Abrechenbarkeit: Guard gegen fehlerhaftes Feed-Flag ----------
     Der Kursfeed liefert bg_uk_abrechenbar=true auch für Kursarten, die der
     Unfallversicherungsträger NICHT übernimmt (BH, NFT, LK1, LK2, SanH, BSG, BSA).
     Die eigene BG/UK-Seite sagt dazu ausdrücklich "Nein". Die Kostenübernahme nach
     § 23 Abs. 2 SGB VII gilt für die Aus- und Fortbildung benannter Ersthelfender —
     das sind EHA, EHF und EHB (Bildungs-/Betreuungseinrichtungen).
     Bewusst konservativ: lieber kein Label als ein falscher Kostenanspruch.
     TEMPORÄR — entfällt, sobald der Feed korrigiert ist (gemeldet an den Software-Chat). */
  var BG_UK_ARTEN = { EHA: 1, EHF: 1, EHB: 1 };
  function istBgUk(k) {
    return !!(k && k.bg_uk_abrechenbar && BG_UK_ARTEN[k.kursart]);
  }

  /* ---------- Rendering einer Termin-Zeile ---------- */
  function rowHTML(k) {
    var tags = [k.stadt];
    if (k.fuehrerschein_geeignet) tags.push('Führerschein');
    if (istBgUk(k)) tags.push('BG/UK abrechenbar');
    if (k.mehrtaegig) tags.push('mehrtägig');

    var zeit  = k.uhrzeit ? esc(k.uhrzeit) + (k.uhrzeit_ende ? '–' + esc(k.uhrzeit_ende) : '') + ' Uhr' : '';
    var preis = (k.preis != null && k.preis !== '') ? esc(k.preis) + ' €' : 'auf Anfrage';
    /* 🔴 17.08.2026: DRITTER ZUSTAND — abgesagt. Bis heute kannte diese Zeile nur
       „frei" und „ausgebucht"; ein abgesagter Kurs waere als BUCHBAR erschienen, mit
       funktionierendem Link. Das Buero stellt abgesagte Kurse derzeit ersatzweise auf
       „ausgebucht" — sicherer, aber der Kunde liest „voll" statt „faellt aus" und setzt
       sich auf eine Warteliste fuer einen Kurs, den es nicht geben wird.
       ⚠️ Muss zeichengleich mit dem Bau bleiben (build.py, `termin_zeilen_html`), sonst
       springt die Zeile beim Nachladen um. */
    var faelltAus = k.eventStatus === 'cancelled';
    var voll  = !faelltAus && !!k.ausgebucht;
    /* 🔴 17.08.2026, ENTSCHEIDUNG RUBENS — WORTLAUT:
       „jeder kurs hat 20 Plätze, wenn sich jemand anmeldet über die website oder manuell
        vom büro schrumpft die personenanzahl — DIE ANZAHL DER FREIEN PLÄTZE DARF
        ÖFFENTLICH NICHT EINSEHBAR SEIN, dort steht nur, dass plätze frei sind"

       Hier stand bis heute ein Knappheitshinweis: bei vier oder weniger freien Plaetzen
       „nur noch N Plätze". Er ist ERSATZLOS entfernt — nicht auf eine andere Spalte
       umgestellt, nicht auf eine andere Schwelle gesetzt.
       🔑 Die Anzeige sagt nur noch etwas ueber das OB, nie ueber die ANZAHL.
       ⚠️ Das gilt UEBERALL, nicht nur hier: kein `inventoryLevel` in den strukturierten
          Daten, keine Restzahl in `data-`Attributen, keine Zahl im Wartelistenfenster.
          Wer eine Anzeige aendert, prueft diese Regel neu.
       📌 Nebenwirkung, die die Sache leichter macht: In der Datenbank widersprechen sich
          bei 19 von 37 kuenftigen Kursen zwei Kapazitaetsspalten. Ohne Knappheitsaussage
          kann uns dieser Widerspruch nicht mehr treffen — eine falsche Zahl, die niemand
          anzeigt, richtet keinen Schaden an.
       📌 Damit ist auch die alte Notiz erledigt, `plaetze_frei` sei „bei uns tragfaehig,
          bei Duderstadt nicht": Die Zahl wird auf KEINER Seite mehr gezeigt. */
    var frei = 'Plätze frei';

    var inner =
      '<span class="termin-date"><b>' + fmtRange(k) + '</b>' + (zeit ? '<small>' + zeit + '</small>' : '') + '</span>' +
      '<span class="termin-info"><b>' + esc(titelAnzeige(k.titel)) + '</b><small>' + tags.filter(Boolean).map(esc).join(' · ') + '</small></span>' +
      '<span class="termin-meta"><b>' + preis + '</b><small>' +
        (faelltAus ? 'Abgesagt' : (voll ? 'Ausgebucht' : frei)) + '</small></span>';

    if (faelltAus) {
      /* Kein Buchungslink und KEINE Warteliste: Für einen Kurs, der nicht stattfindet,
         gibt es nichts anzustehen. Der Termin bleibt trotzdem sichtbar — wer schon
         gebucht hat, muss ihn finden. */
      return '<div class="termin-row is-cancelled">' + inner +
        '<span class="termin-cta">Fällt aus</span></div>';
    }
    if (voll) {
      return '<div class="termin-row is-full">' + inner +
        '<button type="button" class="termin-cta wl-open" data-termin="' + esc(k.id) + '"' +
        ' data-titel="' + esc(titelAnzeige(k.titel)) + '"' +
        ' data-datum="' + esc(fmtRange(k)) + (k.stadt ? ' · ' + esc(k.stadt) : '') + '">Warteliste →</button></div>';
    }
    // buchungs_url sonst unverändert übernehmen (enthält den org des Veranstalters!)
    var url = mitQuelle(sichereUrl(k.buchungs_url, null) || (API + '/buchen?termin=' + encodeURIComponent(k.id || '')));
    return '<a class="termin-row" href="' + esc(url) + '" target="_blank" rel="noopener"' +
      ' data-termin-id="' + esc(k.id || '') + '" data-titel="' + esc(label(titelAnzeige(k.titel))) + '">' +
      inner + '<span class="termin-cta">Platz buchen →</span></a>';
  }

  var EMPTY =
    '<p class="termine-empty">Für diesen Zeitraum sind gerade keine offenen Termine freigeschaltet. ' +
    'Neue Termine kommen laufend dazu — oder fragt direkt einen <a href="/inhouse-kurse/">Kurs bei euch vor Ort</a> an.</p>';

  /* ---------- Liste mit Filter ---------- */
  function renderFiltered(el, all) {
    var arten = {}, staedte = {};
    all.forEach(function (k) {
      if (k.kursart && !arten[k.kursart]) arten[k.kursart] = label(titelAnzeige(k.titel));
      if (k.stadt) staedte[k.stadt] = 1;
    });
    var artKeys = Object.keys(arten).sort(function (a, b) { return arten[a].localeCompare(arten[b]); });
    var stadtKeys = Object.keys(staedte).sort();
    var showArt = artKeys.length > 1, showStadt = stadtKeys.length > 1;
    var hasBg = all.some(istBgUk);

    var bar = '';
    if (showArt || showStadt || hasBg) {
      bar = '<div class="termine-filter">' +
        (showArt ? '<select class="tf-art" aria-label="Nach Kursart filtern"><option value="">Alle Kursarten</option>' +
          artKeys.map(function (c) { return '<option value="' + esc(c) + '">' + esc(arten[c]) + '</option>'; }).join('') + '</select>' : '') +
        (showStadt ? '<select class="tf-stadt" aria-label="Nach Ort filtern"><option value="">Alle Orte</option>' +
          stadtKeys.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('') + '</select>' : '') +
        (hasBg ? '<label class="tf-bg"><input type="checkbox" class="tf-bgchk"> Nur BG/UK-abrechenbar</label>' : '') +
        '<span class="tf-count" aria-live="polite"></span></div>';
    }
    el.innerHTML = bar + '<div class="termine-rows"></div>';

    var artSel = el.querySelector('.tf-art'), stadtSel = el.querySelector('.tf-stadt'),
        bgChk = el.querySelector('.tf-bgchk'), rows = el.querySelector('.termine-rows'),
        count = el.querySelector('.tf-count');

    function apply() {
      var a = artSel ? artSel.value : '', s = stadtSel ? stadtSel.value : '', bg = bgChk && bgChk.checked;
      var f = all.filter(function (k) {
        return (!a || k.kursart === a) && (!s || k.stadt === s) && (!bg || istBgUk(k));
      });
      rows.innerHTML = f.length ? f.map(rowHTML).join('')
        : '<p class="termine-empty">Für diese Auswahl ist gerade nichts frei. <a href="/inhouse-kurse/">Wunschtermin anfragen →</a></p>';
      if (count) count.textContent = f.length + (f.length === 1 ? ' Termin' : ' Termine');
    }
    [artSel, stadtSel, bgChk].forEach(function (n) { if (n) n.addEventListener('change', apply); });
    apply();
  }

  /* ---------- Alle [data-termine]-Container befüllen ---------- */
  function initTermine() {
    var els = document.querySelectorAll('[data-termine]');
    if (!els.length) return;
    Array.prototype.forEach.call(els, function (el) {
      // Vorgerenderte Zeilen NICHT durch das Platzhalter-Gerippe ersetzen: Sie stehen seit
      // dem Bau im HTML (static-first) und sind das, was Crawler und Antwortmaschinen sehen.
      // Der Erfolgsfall unten ersetzt sie gleich durch frische — frische Daten schlagen
      // gebackene, aber erst, wenn sie wirklich da sind.
      if (el.getAttribute('data-prerendered')) return;
      el.innerHTML = '<div class="termine-skeleton"><div class="sk-row"></div><div class="sk-row"></div><div class="sk-row"></div></div>';
    });
    loadFeed().then(function (all) {
      Array.prototype.forEach.call(els, function (el) {
        var limitA = el.getAttribute('data-limit');
        var limit  = (!limitA || limitA === 'all') ? 0 : parseInt(limitA, 10);
        var stadt  = el.getAttribute('data-stadt') || '';
        var arten  = (el.getAttribute('data-art') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);

        var list = all.slice();
        if (stadt) list = list.filter(function (k) { return String(k.stadt || '') === stadt; });
        if (arten.length) list = list.filter(function (k) { return arten.indexOf(String(k.kursart || '')) !== -1; });

        if (!list.length) {
          el.innerHTML = arten.length
            ? '<p class="termine-empty">Für dieses Format ist gerade kein offener Termin ausgeschrieben. ' +
              'Als Kurs bei euch vor Ort jederzeit möglich — <a href="/inhouse-kurse/">Wunschtermin anfragen →</a></p>'
            : EMPTY;
          return;
        }
        if (limit > 0 || arten.length) {
          el.innerHTML = '<div class="termine-rows">' +
            (limit > 0 ? list.slice(0, limit) : list).map(rowHTML).join('') + '</div>';
          return;
        }
        renderFiltered(el, list);
      });
    }).catch(function () {
      Array.prototype.forEach.call(els, function (el) {
        // Feed zur Laufzeit weg? Dann sind die vorgerenderten Zeilen das Beste, was wir
        // haben — hoechstens einen Tag alt. Sie durch „laesst sich nicht laden" zu ersetzen
        // waere ein Rueckschritt gegenueber dem Zustand vor dem Vorrendern.
        if (el.getAttribute('data-prerendered')) return;
        el.innerHTML = '<p class="termine-empty">Die Termine lassen sich gerade nicht laden. ' +
          'Bitte kurz später erneut versuchen oder anrufen: <a href="tel:' + TEL_HREF + '">' + TEL + '</a>.</p>';
      });
    });
  }

  /* ---------- Zähler „x offene Termine" ---------- */
  function initCounters() {
    var els = document.querySelectorAll('[data-termine-count]');
    if (!els.length) return;
    loadFeed().then(function (all) {
      /* ⚖️ Diese Zahl ist erlaubt und muss bleiben: Sie zaehlt buchbare TERMINE, nicht
         freie PLAETZE. Rubens Regel vom 17.08. verbietet die Anzahl freier Plaetze je
         Kurs — wie viele Termine offen sind, ist eine Aussage ueber das Angebot.
         🔴 Abgesagte zaehlen seit 17.08. NICHT mehr mit: Bis dahin filterte die Zeile nur
            `ausgebucht`, ein abgesagter Kurs waere also als offener Termin mitgezaehlt
            worden — dieselbe Luecke wie in der Terminzeile, nur an einer zweiten Stelle. */
      var offen = all.filter(function (k) {
        return !k.ausgebucht && k.eventStatus !== 'cancelled';
      }).length;
      Array.prototype.forEach.call(els, function (el) { el.textContent = offen > 0 ? String(offen) : '—'; });
    }).catch(function () {});
  }

  /* ---------- Formulare (data-api="…") ---------- */
  function wireForms(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('form[data-api]'), function (form) {
      if (form.__ehdWired) return; // Doppel-Bindung (und damit Doppel-Absendung) verhindern
      form.__ehdWired = true;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var endpoint = form.getAttribute('data-api');
        var status = form.querySelector('.form-status');

        // Honeypot: Bot hat das versteckte Feld ausgefüllt -> stiller Abbruch
        var hp = form.querySelector('input[name="website"]');
        if (hp && hp.value) { if (status) status.textContent = 'Danke!'; return; }

        var payload = { org: ORG_LEAD, website: '', quelle: QUELLE };
        Array.prototype.forEach.call(form.querySelectorAll('[name]'), function (f) {
          var n = f.getAttribute('name');
          if (n === 'website' || n === 'consent' || n === 'newsletter') return;
          if (f.type === 'checkbox') { if (f.checked) (payload[n] = payload[n] || []).push(f.value); }
          else if (f.type === 'radio') { if (f.checked) payload[n] = f.value; }
          else if (String(f.value).trim() !== '') payload[n] = f.value;
        });
        if (payload.teilnehmerzahl) payload.teilnehmerzahl = parseInt(payload.teilnehmerzahl, 10) || undefined;
        if (payload.teilnehmer)     payload.teilnehmer     = parseInt(payload.teilnehmer, 10) || undefined;

        var btn = form.querySelector('button[type="submit"]');
        var orig = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Wird gesendet …'; }
        if (status) { status.className = 'form-status'; status.textContent = ''; }

        // Newsletter separat (Opt-in), fire-and-forget
        var nl = form.querySelector('input[name="newsletter"]');
        if (nl && nl.checked) {
          var mail = (form.querySelector('[name="email"]') || {}).value || '';
          if (mail) {
            try {
              fetch(API + '/api/newsletter', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ org: ORG_LEAD, email: mail, quelle: QUELLE, website: '' })
              });
            } catch (err) {}
          }
        }

        var http = 0;
        fetch(API + '/api/' + endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        }).then(function (r) {
          http = r.status;
          return r.json().catch(function () { return {}; });
        }).then(function (res) {
          if (res && res.ok) {
            form.innerHTML =
              '<div class="form-success"><span class="form-success-ic">✓</span>' +
              '<h3>Danke — eure Anfrage ist da!</h3>' +
              '<p>Wir melden uns persönlich und zeitnah.' +
              (res.ticket_id ? ' Eure Vorgangsnummer: <b>' + esc(res.ticket_id) + '</b>.' : '') + '</p>' +
              '<p class="muted">Dringend? Ruft uns an: <a href="tel:' + TEL_HREF + '">' + TEL + '</a></p></div>';
            form.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
          }
          var msg;
          if (http === 429 || (res && res.error === 'too_many_requests')) {
            msg = 'Es sind gerade sehr viele Anfragen eingegangen. Bitte in etwa einer Stunde erneut versuchen — oder direkt anrufen: ' + TEL + '.';
          } else if (res && res.error === 'invalid_input') {
            msg = 'Bitte prüft die Pflichtfelder und die E-Mail-Adresse.';
          } else {
            msg = 'Das hat leider nicht geklappt. Bitte erneut versuchen oder anrufen: ' + TEL + '.';
          }
          if (status) { status.className = 'form-status is-error'; status.textContent = msg; }
          if (btn) { btn.disabled = false; btn.textContent = orig; }
        }).catch(function () {
          if (status) {
            status.className = 'form-status is-error';
            status.textContent = 'Verbindung fehlgeschlagen. Bitte später erneut versuchen oder anrufen: ' + TEL + '.';
          }
          if (btn) { btn.disabled = false; btn.textContent = orig; }
        });
      });
    });
  }

  /* ---------- Warteliste für ausgebuchte Termine ---------- */
  function ensureModal() {
    if (document.getElementById('wlModal')) return;
    var d = document.createElement('div');
    d.className = 'modal-bd'; d.id = 'wlModal'; d.hidden = true;
    d.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="wlTitle">' +
        '<button type="button" class="modal-x" aria-label="Schließen">&times;</button>' +
        '<h3 id="wlTitle">Auf die Warteliste</h3>' +
        '<p class="m-sub" id="wlSub"></p>' +
        '<form data-api="warteliste">' +
          '<input type="hidden" name="termin" value="">' +
          '<div class="field"><label for="wlName">Name <span class="req">*</span></label>' +
            '<input id="wlName" name="name" required autocomplete="name"></div>' +
          '<div class="field"><label for="wlMail">E-Mail <span class="req">*</span></label>' +
            '<input id="wlMail" name="email" type="email" required autocomplete="email"></div>' +
          '<div class="field"><label for="wlTel">Telefon</label>' +
            '<input id="wlTel" name="telefon" type="tel" autocomplete="tel"></div>' +
          '<input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
          '<label class="consent"><input type="checkbox" required>' +
            '<span>Ich bin einverstanden, dass meine Daten zur Bearbeitung der Wartelisten-Anfrage ' +
            'gespeichert werden. <a href="/datenschutz/">Datenschutz</a></span></label>' +
          '<button class="btn primary block" type="submit">Auf die Warteliste setzen</button>' +
          '<p class="form-status"></p>' +
        '</form>' +
      '</div>';
    document.body.appendChild(d);
    function close() { d.hidden = true; }
    d.querySelector('.modal-x').addEventListener('click', close);
    d.addEventListener('click', function (e) { if (e.target === d) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !d.hidden) close(); });
    wireForms(d); // nur das Formular im Modal anbinden
  }

  function wireWaitlist() {
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.wl-open') : null;
      if (!b) return;
      ensureModal();
      var m = document.getElementById('wlModal');
      m.querySelector('[name="termin"]').value = b.getAttribute('data-termin') || '';
      m.querySelector('#wlSub').textContent =
        (b.getAttribute('data-titel') || '') + ' — ' + (b.getAttribute('data-datum') || '') +
        '. Wir melden uns, sobald ein Platz frei wird oder ein Zusatztermin steht.';
      m.hidden = false;
      setTimeout(function () { var i = m.querySelector('#wlName'); if (i) i.focus(); }, 60);
    });
  }

  /* ---------- Kundenstimmen (optional; Bereich bleibt leer, wenn nichts da ist) ---------- */
  function initReviews() {
    var el = document.getElementById('bewertungen');
    if (!el) return;
    jget(API + '/api/bewertungen?org=' + encodeURIComponent(ORG_LEAD)).then(function (d) {
      var list = (d && d.bewertungen) || [];
      if (!list.length) { var s = el.closest('section'); if (s) s.remove(); return; }
      el.innerHTML = list.slice(0, 6).map(function (b) {
        var stars = '★★★★★'.slice(0, Math.max(1, Math.min(5, +b.sterne || 5)));
        return '<figure class="card"><div style="color:var(--accent);font-size:1.05rem;letter-spacing:.08em">' + stars + '</div>' +
          '<blockquote style="margin:12px 0 14px;font-size:1rem;color:var(--ink-2)">' + esc(b.text || '') + '</blockquote>' +
          '<figcaption class="muted" style="font-size:.87rem">' + esc(b.name || 'Teilnehmer:in') +
          (b.ort ? ' · ' + esc(b.ort) : '') + '</figcaption></figure>';
      }).join('');
    }).catch(function () { var s = el.closest('section'); if (s) s.remove(); });
  }

  /* ---------- Start ---------- */
  function boot() { initTermine(); initCounters(); wireForms(); wireWaitlist(); initReviews(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
