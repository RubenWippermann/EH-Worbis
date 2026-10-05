/* Kurskalender — Monatsansicht aller offenen Kurse mit direkter Anmeldung.
   Abhängigkeitsfrei (Vanilla JS). Einbindung:
     <div class="kal" data-kalender data-api="https://software-wippermann.de"
          data-orgs="bww" data-quelle="erstehilfe-worbis" data-liste="/offene-kurse/"></div>
   Datenquelle: GET {api}/api/kurse?org={org}&ab_datum={heute} -> {kurse:[…]}
   Regeln:
   - Abgesagte Kurse (eventStatus "cancelled") erscheinen nicht.
   - Ausgebuchte Kurse erscheinen deutlich markiert, OHNE Anmeldelink.
   - Freie Platzzahlen werden NIE angezeigt (Hausregel: nur "buchbar"/"ausgebucht").
   - Alle Datumsrechnungen auf "YYYY-MM-DD"-Zeichenketten bzw. UTC — keine
     Sommerzeit-Verschiebung, keine Zeitzonen-Umrechnung der Kurstage. */
(function () {
  'use strict';

  var MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
    'September', 'Oktober', 'November', 'Dezember'];
  var WT_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  var WT_LANG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  var MAX_CHIPS = 2;
  // Kategorien statt einer Pille je Kursformat: neue Formate (z. B. 2027) landen über
  // Kürzel oder Titelwörter automatisch in einer Gruppe, sonst unter "Weitere".
  var KATEGORIEN = [
    ['eh', 'Erste Hilfe', /^(EH|NFT|AED|REA)/i, /erste[\s-]hilfe|notfall|reanimation|aed|baby|kind/i],
    ['bs', 'Brandschutz', /^(BH|BSH|EVA|BRA)/i, /brandschutz|evakuierung|feuer/i],
    ['san', 'Sanitätsdienst', /^(BSG|BSA|BSF|SAN)/i, /sanit/i],
    ['lk', 'Lehrkräfte & Ausbilder', /^(LK|LB|AUS)/i, /lehrkr|ausbilder|multiplikator|dozent/i]
  ];
  function kategorie(k) {
    var art = String(k.kursart || ''), t = String(k.titel || '');
    for (var i = 0; i < KATEGORIEN.length; i++) if (KATEGORIEN[i][2].test(art)) return KATEGORIEN[i][0];
    for (i = 0; i < KATEGORIEN.length; i++) if (KATEGORIEN[i][3].test(t)) return KATEGORIEN[i][0];
    return 'weitere';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }           // m: 0–11
  function heute() { var d = new Date(); return iso(d.getFullYear(), d.getMonth(), d.getDate()); }
  function teile(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? [+m[1], +m[2] - 1, +m[3]] : null; }
  // Tagesrechnung in UTC: kein Tag "verschwindet" an der Zeitumstellung (25.10.2026).
  function plusTage(s, n) {
    var p = teile(s), t = new Date(Date.UTC(p[0], p[1], p[2] + n));
    return iso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  }
  function wochentag(s) { var p = teile(s); return (new Date(Date.UTC(p[0], p[1], p[2])).getUTCDay() + 6) % 7; } // Mo=0
  function tageImMonat(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  function datumLang(s) { var p = teile(s); return WT_LANG[wochentag(s)] + ', ' + p[2] + '. ' + MONATE[p[1]] + ' ' + p[0]; }
  function datumKurz(s) { var p = teile(s); return p[2] + '. ' + MONATE[p[1]]; }

  function titelAnzeige(t) {                       // Inhouse-Auftraggeber hinter " · " nie zeigen
    var s = String(t == null ? '' : t), kopf = s.split(/\s+[·•]\s+/)[0].trim();
    return kopf || s;
  }
  function sichereUrl(u) { return (u && /^https?:\/\//i.test(String(u).trim())) ? String(u).trim() : null; }
  function anhaengen(u, k, v) {
    if (new RegExp('[?&]' + k + '=').test(u)) return u;                         // vorhandenes nie überschreiben
    return u + (u.indexOf('?') === -1 ? '?' : '&') + k + '=' + encodeURIComponent(v);
  }
  function preisText(p) {
    if (p == null || p === '') return 'auf Anfrage';
    var n = Number(p);
    if (isNaN(n)) return esc(p);
    return n.toLocaleString('de-DE', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';
  }

  function Kalender(el) {
    this.el = el;
    this.api = (el.getAttribute('data-api') || 'https://software-wippermann.de').replace(/\/$/, '');
    this.orgs = (el.getAttribute('data-orgs') || 'bww').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    this.quelle = el.getAttribute('data-quelle') || '';
    this.liste = el.getAttribute('data-liste') || '/';
    this.zeigeVeranstalter = el.hasAttribute('data-veranstalter');   // firmenübergreifende Einbindung
    this.heute = heute();
    var h = teile(this.heute);
    this.jahr = h[0]; this.monat = h[1];
    this.fokus = this.heute;      // Tag mit tabindex=0 im Raster
    this.gewaehlt = null;         // geöffneter Tag
    this.proTag = {};             // 'YYYY-MM-DD' -> [{k, nr, von}]
    this.kurse = [];
    this.filter = '';             // '' = alle Kategorien
    this.mql = window.matchMedia ? window.matchMedia('(max-width: 699px)') : null;
    this.geruest();
    this.laden();
  }

  Kalender.prototype.geruest = function () {
    var self = this;
    this.el.innerHTML =
      '<div class="kal-kopf">' +
        '<button type="button" class="kal-btn kal-vor" data-nav="-1" aria-label="Vorheriger Monat">‹</button>' +
        '<h2 class="kal-titel" aria-live="polite"></h2>' +
        '<button type="button" class="kal-btn kal-nach" data-nav="1" aria-label="Nächster Monat">›</button>' +
        '<button type="button" class="kal-btn kal-heute" data-nav="0">Heute</button>' +
      '</div>' +
      '<div class="kal-filter" role="group" aria-label="Nach Kursbereich filtern" hidden></div>' +
      '<div class="kal-legende" aria-hidden="true"><span class="kal-punkt"></span> buchbar <span class="kal-punkt is-voll"></span> ausgebucht</div>' +
      '<div class="kal-body" aria-busy="true"><p class="kal-status">Termine werden geladen …</p></div>' +
      '<div class="kal-detail" hidden></div>';
    this.titel = this.el.querySelector('.kal-titel');
    this.body = this.el.querySelector('.kal-body');
    this.detail = this.el.querySelector('.kal-detail');
    this.el.addEventListener('click', function (e) {
      var f = e.target.closest('[data-filter]');
      if (f) { self.filter = f.getAttribute('data-filter'); self.einsortieren(); self.filterZeichnen(); self.gewaehlt = null; self.zeichne(0); return; }
      var nav = e.target.closest('[data-nav]');
      if (nav) { self.navigiere(+nav.getAttribute('data-nav')); return; }
      var tag = e.target.closest('[data-tag]');
      if (tag && self.body.contains(tag) && !tag.disabled) { self.oeffne(tag.getAttribute('data-tag')); return; }
      if (e.target.closest('.kal-zu')) { self.schliesse(true); return; }
      var sprung = e.target.closest('[data-sprung]');
      if (sprung) { var p = teile(sprung.getAttribute('data-sprung')); self.jahr = p[0]; self.monat = p[1]; self.fokus = sprung.getAttribute('data-sprung'); self.gewaehlt = null; self.zeichne(0); }
    });
    this.el.addEventListener('keydown', function (e) { self.taste(e); });
    if (this.mql) {
      var neu = function () { self.zeichne(0); };
      if (this.mql.addEventListener) this.mql.addEventListener('change', neu); else if (this.mql.addListener) this.mql.addListener(neu);
    }
    this.titel.textContent = MONATE[this.monat] + ' ' + this.jahr;
  };

  Kalender.prototype.laden = function () {
    var self = this, ab = this.heute;
    Promise.all(this.orgs.map(function (org) {
      return fetch(self.api + '/api/kurse?org=' + encodeURIComponent(org) + '&ab_datum=' + ab, { credentials: 'omit' })
        .then(function (r) { if (!r.ok) throw new Error('http_' + r.status); return r.json(); })
        .then(function (d) {
          var v = d && d.veranstalter && (d.veranstalter.kurzname || d.veranstalter.name);
          return ((d && d.kurse) || []).map(function (k) { k._org = org; k._veranstalter = v || ''; return k; });
        })
        .catch(function () { return null; });
    })).then(function (listen) {
      var live = listen.filter(function (l) { return l !== null; });
      if (!live.length) { self.fehler(); return; }
      var gesehen = {};
      live.forEach(function (l) {
        l.forEach(function (k) {
          var id = String(k.id || (k.kursart + k.datum));
          if (gesehen[id] || k.eventStatus === 'cancelled' || !teile(k.datum)) return;
          gesehen[id] = 1;
          self.kurse.push(k);
        });
      });
      self.kurse.forEach(function (k) { k._kat = kategorie(k); });
      self.einsortieren();
      self.filterZeichnen();
      self.body.setAttribute('aria-busy', 'false');
      self.zeichne(0);
    });
  };

  // Jeden Kurs auf ALLE seine Kurstage legen. Quelle: termine[] (echte Einzeltage,
  // z. B. Wochenend-Split), sonst lückenlos datum..datum_ende.
  Kalender.prototype.einsortieren = function () {
    var self = this;
    this.proTag = {};
    this.kurse.sort(function (a, b) {
      return (a.datum + (a.uhrzeit || '')).localeCompare(b.datum + (b.uhrzeit || ''));
    });
    this.kurse.forEach(function (k) {
      if (self.filter && k._kat !== self.filter) return;
      var tage = [];
      (k.termine || []).forEach(function (t) { if (t && teile(t.datum)) tage.push({ d: t.datum, von: t.uhrzeit, bis: t.uhrzeit_ende }); });
      if (!tage.length) {
        var ende = teile(k.datum_ende) && k.datum_ende >= k.datum ? k.datum_ende : k.datum;
        for (var d = k.datum, i = 0; d <= ende && i < 60; d = plusTage(d, 1), i++) tage.push({ d: d, von: k.uhrzeit, bis: k.uhrzeit_ende });
      }
      tage.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
      k._tage = tage;
      tage.forEach(function (t, i) {
        (self.proTag[t.d] = self.proTag[t.d] || []).push({ k: k, nr: i + 1, von: t.von, bis: t.bis });
      });
    });
  };

  Kalender.prototype.filterZeichnen = function () {
    var da = {}, self = this, box = this.el.querySelector('.kal-filter');
    this.kurse.forEach(function (k) { da[k._kat] = 1; });
    var liste = KATEGORIEN.filter(function (x) { return da[x[0]]; }).map(function (x) { return [x[0], x[1]]; });
    if (da.weitere) liste.push(['weitere', 'Weitere']);
    if (liste.length < 2) { box.hidden = true; return; }
    box.innerHTML = [['', 'Alle Kurse']].concat(liste).map(function (x) {
      return '<button type="button" class="kal-fbtn" data-filter="' + x[0] + '" aria-pressed="' + (self.filter === x[0]) + '">' + esc(x[1]) + '</button>';
    }).join('');
    box.hidden = false;
  };

  Kalender.prototype.fehler = function () {
    this.body.setAttribute('aria-busy', 'false');
    this.body.innerHTML = '<div class="kal-fehler" role="status"><p><b>Der Kalender lädt gerade nicht.</b> ' +
      'Die Kursdaten sind im Moment nicht erreichbar — bitte versuch es gleich noch einmal.</p>' +
      '<p><a class="kal-cta" href="' + esc(this.liste) + '">Zur Terminliste</a></p></div>';
  };

  Kalender.prototype.mobil = function () { return !!(this.mql && this.mql.matches); };

  Kalender.prototype.navigiere = function (n) {
    if (n === 0) {
      var h = teile(this.heute); this.jahr = h[0]; this.monat = h[1]; this.fokus = this.heute;
    } else {
      var t = new Date(Date.UTC(this.jahr, this.monat + n, 1));
      this.jahr = t.getUTCFullYear(); this.monat = t.getUTCMonth();
      var fp = teile(this.fokus);
      this.fokus = iso(this.jahr, this.monat, Math.min(fp ? fp[2] : 1, tageImMonat(this.jahr, this.monat)));
    }
    this.gewaehlt = null;
    this.zeichne(n);
  };

  Kalender.prototype.status = function (k) { return k.ausgebucht ? 'voll' : 'frei'; };

  Kalender.prototype.chip = function (e) {
    var k = e.k, n = k._tage.length;
    return '<span class="kal-chip' + (k.ausgebucht ? ' is-voll' : '') + (n > 1 ? ' is-mehr' + (e.nr > 1 ? ' is-folge' : '') : '') + '">' +
      (e.von ? '<i>' + esc(e.von) + '</i> ' : '') + esc(titelAnzeige(k.titel)) + '</span>';
  };

  Kalender.prototype.zeichne = function (richtung) {
    var y = this.jahr, m = this.monat, self = this;
    this.titel.textContent = MONATE[m] + ' ' + y;
    if (this.body.getAttribute('aria-busy') === 'true') return;
    var anz = tageImMonat(y, m), erster = iso(y, m, 1), letzter = iso(y, m, anz);
    var imMonat = 0;
    for (var d = 1; d <= anz; d++) if (this.proTag[iso(y, m, d)]) imMonat++;
    var leer = '';
    if (!imMonat) {
      var naechster = null;
      Object.keys(this.proTag).sort().some(function (t) { if (t > letzter) { naechster = t; return true; } return false; });
      leer = '<div class="kal-leer"><p>In diesem Monat sind keine offenen Kurse' + (this.filter ? ' in diesem Bereich' : '') + ' freigeschaltet.</p>' +
        (naechster ? '<button type="button" class="kal-cta" data-sprung="' + naechster + '">Nächster Kurs: ' + datumKurz(naechster) + ' ' + teile(naechster)[0] + '</button>' :
          '<p><a href="' + esc(this.liste) + '">Zur Terminliste</a></p>') + '</div>';
    }
    var html;
    if (this.mobil()) {
      html = leer || this.agenda(y, m, anz);
      this.detail.hidden = true;
    } else {
      html = this.raster(y, m, anz, erster) + leer;
    }
    this.body.innerHTML = '<div class="kal-blatt' + (richtung ? (richtung > 0 ? ' kal-rein-r' : ' kal-rein-l') : '') + '">' + html + '</div>';
    if (!this.mobil()) {
      if (this.gewaehlt) this.zeigeDetail(this.gewaehlt, false); else this.detail.hidden = true;
    }
  };

  Kalender.prototype.raster = function (y, m, anz, erster) {
    var vor = wochentag(erster), zellen = [], i;
    var fp = teile(this.fokus);
    if (!fp || fp[0] !== y || fp[1] !== m) this.fokus = (teile(this.heute)[0] === y && teile(this.heute)[1] === m) ? this.heute : erster;
    for (i = 0; i < vor; i++) zellen.push('<div class="kal-zelle is-aussen" role="gridcell"></div>');
    for (var d = 1; d <= anz; d++) {
      var tag = iso(y, m, d), e = this.proTag[tag] || [], kl = 'kal-tag';
      if (tag === this.heute) kl += ' is-heute';
      if (tag < this.heute) kl += ' is-vorbei';
      if (e.length) kl += ' hat-kurs';
      if (tag === this.gewaehlt) kl += ' is-gewaehlt';
      var frei = e.filter(function (x) { return !x.k.ausgebucht; }).length;
      var label = datumLang(tag) + (e.length ? ', ' + e.length + (e.length === 1 ? ' Kurs' : ' Kurse') + (frei ? '' : ', ausgebucht') : ', keine Kurse');
      var chips = e.slice(0, MAX_CHIPS).map(this.chip, this).join('') +
        (e.length > MAX_CHIPS ? '<span class="kal-mehr">+' + (e.length - MAX_CHIPS) + ' weitere</span>' : '');
      zellen.push('<div class="kal-zelle" role="gridcell"><button type="button" class="' + kl + '" data-tag="' + tag + '"' +
        ' tabindex="' + (tag === this.fokus ? '0' : '-1') + '" aria-label="' + esc(label) + '"' +
        (tag === this.gewaehlt ? ' aria-pressed="true"' : (e.length ? ' aria-pressed="false"' : '')) + '>' +
        '<span class="kal-nr" aria-hidden="true">' + d + '</span>' + (chips ? '<span class="kal-chips" aria-hidden="true">' + chips + '</span>' : '') +
        '</button></div>');
    }
    while (zellen.length % 7) zellen.push('<div class="kal-zelle is-aussen" role="gridcell"></div>');
    var zeilen = '';
    for (i = 0; i < zellen.length; i += 7) zeilen += '<div class="kal-zeile" role="row">' + zellen.slice(i, i + 7).join('') + '</div>';
    return '<div class="kal-raster" role="grid" aria-label="' + MONATE[m] + ' ' + y + '">' +
      '<div class="kal-zeile kal-wt" role="row">' + WT_KURZ.map(function (w, j) {
        return '<div class="kal-wtag" role="columnheader"><abbr title="' + WT_LANG[j] + '">' + w + '</abbr></div>';
      }).join('') + '</div>' + zeilen + '</div>';
  };

  Kalender.prototype.karte = function (e, tag) {
    var k = e.k, voll = !!k.ausgebucht, n = k._tage.length;
    var zeit = e.von ? esc(e.von) + (e.bis ? '–' + esc(e.bis) : '') + ' Uhr' : 'Uhrzeit folgt';
    var ort = k.adresse || k.stadt || '';
    var zeitraum = n > 1 ? 'Tag ' + e.nr + ' von ' + n + ' · ' + datumKurz(k._tage[0].d) + ' bis ' + datumKurz(k._tage[n - 1].d) + ' ' + teile(k._tage[n - 1].d)[0] : '';
    var aktion;
    if (voll) {
      aktion = '<span class="kal-badge is-voll">Ausgebucht</span><a class="kal-link" href="' + esc(this.liste) + '">Andere Termine ansehen</a>';
    } else {
      var url = sichereUrl(k.buchungs_url) || (this.api + '/buchen/?termin=' + encodeURIComponent(k.id || ''));
      url = anhaengen(url, 'org', k._org);
      if (this.quelle) url = anhaengen(url, 'quelle', this.quelle);
      aktion = '<span class="kal-badge">Buchbar</span><a class="kal-cta" href="' + esc(url) + '" target="_blank" rel="noopener"' +
        ' aria-label="Jetzt anmelden: ' + esc(titelAnzeige(k.titel)) + ' am ' + esc(datumKurz(k.datum)) + '">Jetzt anmelden</a>';
    }
    return '<article class="kal-kurs' + (voll ? ' is-voll' : '') + '">' +
      '<h4>' + esc(titelAnzeige(k.titel)) + '</h4>' +
      '<dl>' +
        '<div><dt>Datum</dt><dd>' + datumLang(tag) + (zeitraum ? '<small>' + zeitraum + '</small>' : '') + '</dd></div>' +
        '<div><dt>Uhrzeit</dt><dd>' + zeit + '</dd></div>' +
        (ort ? '<div><dt>Ort</dt><dd>' + esc(ort) + '</dd></div>' : '') +
        '<div><dt>Preis</dt><dd>' + preisText(k.preis) + '</dd></div>' +
        (this.zeigeVeranstalter && k._veranstalter ? '<div><dt>Veranstalter</dt><dd>' + esc(k._veranstalter) + '</dd></div>' : '') +
      '</dl><div class="kal-aktion">' + aktion + '</div></article>';
  };

  Kalender.prototype.agenda = function (y, m, anz) {
    var out = '';
    for (var d = 1; d <= anz; d++) {
      var tag = iso(y, m, d), e = this.proTag[tag];
      if (!e) continue;
      out += '<section class="kal-agtag' + (tag === this.heute ? ' is-heute' : '') + (tag < this.heute ? ' is-vorbei' : '') + '">' +
        '<h3><span class="kal-agnr">' + d + '</span><span>' + WT_LANG[wochentag(tag)] + '<small>' + datumKurz(tag) + '</small></span></h3>' +
        e.map(function (x) { return this.karte(x, tag); }, this).join('') + '</section>';
    }
    return '<div class="kal-agenda">' + out + '</div>';
  };

  Kalender.prototype.oeffne = function (tag) {
    this.fokus = tag;
    if (this.gewaehlt === tag) { this.schliesse(false); return; }
    this.gewaehlt = tag;
    var alt = this.body.querySelector('.is-gewaehlt');
    if (alt) { alt.classList.remove('is-gewaehlt'); if (alt.hasAttribute('aria-pressed')) alt.setAttribute('aria-pressed', 'false'); }
    var btn = this.body.querySelector('[data-tag="' + tag + '"]');
    if (btn) { btn.classList.add('is-gewaehlt'); btn.setAttribute('aria-pressed', 'true'); }
    this.zeigeDetail(tag, true);
  };

  Kalender.prototype.zeigeDetail = function (tag, fokus) {
    var e = this.proTag[tag] || [];
    this.detail.innerHTML =
      '<div class="kal-detail-kopf"><h3 tabindex="-1">' + datumLang(tag) + '</h3>' +
      '<button type="button" class="kal-btn kal-zu" aria-label="Tagesansicht schließen">×</button></div>' +
      (e.length ? e.map(function (x) { return this.karte(x, tag); }, this).join('') :
        '<p class="kal-status">An diesem Tag findet kein offener Kurs statt.</p>');
    this.detail.hidden = false;
    this.detail.classList.remove('kal-auf'); void this.detail.offsetWidth; this.detail.classList.add('kal-auf');
    if (fokus) {
      var h = this.detail.querySelector('h3');
      try { h.focus({ preventScroll: true }); } catch (x) { h.focus(); }
      var r = this.detail.getBoundingClientRect();
      if (r.top > window.innerHeight - 120 || r.top < 0) this.detail.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  Kalender.prototype.schliesse = function (fokusZurueck) {
    this.gewaehlt = null;
    this.detail.hidden = true;
    var alt = this.body.querySelector('.is-gewaehlt');
    if (alt) { alt.classList.remove('is-gewaehlt'); alt.setAttribute('aria-pressed', 'false'); }
    if (fokusZurueck) { var b = this.body.querySelector('[data-tag="' + this.fokus + '"]'); if (b) b.focus(); }
  };

  Kalender.prototype.taste = function (e) {
    if (e.key === 'Escape' && !this.detail.hidden) { e.preventDefault(); this.schliesse(true); return; }
    var btn = e.target.closest && e.target.closest('.kal-tag');
    if (!btn) return;
    var schritt = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    var tag = btn.getAttribute('data-tag'), ziel;
    if (schritt) ziel = plusTage(tag, schritt);
    else if (e.key === 'Home') ziel = plusTage(tag, -wochentag(tag));
    else if (e.key === 'End') ziel = plusTage(tag, 6 - wochentag(tag));
    else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault(); this.navigiere(e.key === 'PageUp' ? -1 : 1); this.fokussiere(); return;
    } else return;
    e.preventDefault();
    var p = teile(ziel);
    this.fokus = ziel;
    if (p[0] !== this.jahr || p[1] !== this.monat) { this.jahr = p[0]; this.monat = p[1]; this.gewaehlt = null; this.zeichne(schritt > 0 ? 1 : -1); this.fokus = ziel; }
    this.fokussiere();
  };

  Kalender.prototype.fokussiere = function () {
    var self = this;
    Array.prototype.forEach.call(this.body.querySelectorAll('.kal-tag'), function (b) {
      b.tabIndex = b.getAttribute('data-tag') === self.fokus ? 0 : -1;
    });
    var b = this.body.querySelector('[data-tag="' + this.fokus + '"]');
    if (b) b.focus();
  };

  function start() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-kalender]'), function (el) {
      if (!el._kal) el._kal = new Kalender(el);
    });
  }
  window.Kurskalender = { start: start, _intern: { plusTage: plusTage, wochentag: wochentag, tageImMonat: tageImMonat } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
