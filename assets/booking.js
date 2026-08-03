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
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
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

  /* ---------- Rendering einer Termin-Zeile ---------- */
  function rowHTML(k) {
    var tags = [k.stadt];
    if (k.fuehrerschein_geeignet) tags.push('Führerschein');
    if (k.bg_uk_abrechenbar) tags.push('BG/UK abrechenbar');
    if (k.mehrtaegig) tags.push('mehrtägig');

    var zeit  = k.uhrzeit ? esc(k.uhrzeit) + (k.uhrzeit_ende ? '–' + esc(k.uhrzeit_ende) : '') + ' Uhr' : '';
    var preis = (k.preis != null && k.preis !== '') ? esc(k.preis) + ' €' : 'auf Anfrage';
    var voll  = !!k.ausgebucht;
    var frei  = (k.freie_plaetze != null && k.freie_plaetze !== '' && +k.freie_plaetze <= 4 && !voll)
                ? 'nur noch ' + esc(k.freie_plaetze) + ' Plätze' : 'Plätze frei';

    var inner =
      '<span class="termin-date"><b>' + fmtRange(k) + '</b>' + (zeit ? '<small>' + zeit + '</small>' : '') + '</span>' +
      '<span class="termin-info"><b>' + esc(k.titel) + '</b><small>' + tags.filter(Boolean).map(esc).join(' · ') + '</small></span>' +
      '<span class="termin-meta"><b>' + preis + '</b><small>' + (voll ? 'Ausgebucht' : frei) + '</small></span>';

    if (voll) {
      return '<div class="termin-row is-full">' + inner +
        '<button type="button" class="termin-cta wl-open" data-termin="' + esc(k.id) + '"' +
        ' data-titel="' + esc(k.titel) + '"' +
        ' data-datum="' + esc(fmtRange(k)) + (k.stadt ? ' · ' + esc(k.stadt) : '') + '">Warteliste →</button></div>';
    }
    // buchungs_url unverändert übernehmen (enthält den org des Veranstalters!)
    var url = k.buchungs_url || (API + '/buchen?termin=' + encodeURIComponent(k.id || ''));
    return '<a class="termin-row" href="' + esc(url) + '" target="_blank" rel="noopener"' +
      ' data-termin-id="' + esc(k.id || '') + '" data-titel="' + esc(label(k.titel)) + '">' +
      inner + '<span class="termin-cta">Platz buchen →</span></a>';
  }

  var EMPTY =
    '<p class="termine-empty">Für diesen Zeitraum sind gerade keine offenen Termine freigeschaltet. ' +
    'Neue Termine kommen laufend dazu — oder fragt direkt einen <a href="/inhouse-kurse/">Kurs bei euch vor Ort</a> an.</p>';

  /* ---------- Liste mit Filter ---------- */
  function renderFiltered(el, all) {
    var arten = {}, staedte = {};
    all.forEach(function (k) {
      if (k.kursart && !arten[k.kursart]) arten[k.kursart] = label(k.titel);
      if (k.stadt) staedte[k.stadt] = 1;
    });
    var artKeys = Object.keys(arten).sort(function (a, b) { return arten[a].localeCompare(arten[b]); });
    var stadtKeys = Object.keys(staedte).sort();
    var showArt = artKeys.length > 1, showStadt = stadtKeys.length > 1;
    var hasBg = all.some(function (k) { return k.bg_uk_abrechenbar; });

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
        return (!a || k.kursart === a) && (!s || k.stadt === s) && (!bg || k.bg_uk_abrechenbar);
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
      var frei = all.filter(function (k) { return !k.ausgebucht; }).length;
      Array.prototype.forEach.call(els, function (el) { el.textContent = frei > 0 ? String(frei) : '—'; });
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
