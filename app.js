'use strict';

const $ = (s, el = document) => el.querySelector(s);
const nf = (d = 0) => new Intl.NumberFormat('sl-SI', { maximumFractionDigits: d, minimumFractionDigits: d });
const eur = (v, d = 0) => nf(d).format(v) + ' €';
const FUEL_NAME = { b: 'bencin', d: 'dizel', lpg: 'avtoplin', e: 'elektrika', hev: 'hibrid', pb: 'priključni hibrid', pd: 'priključni hibrid (dizel)' };
const FUEL_KINDS = { b: ['b95', 'b100'], hev: ['b95', 'b100'], pb: ['b95', 'b100'], d: ['d', 'dp'], pd: ['d', 'dp'], lpg: ['lpg', 'b95'] };
const EL_KINDS = ['el_home', 'el_ac', 'el_dc', 'el_hpc'];
const GROUP_NAME = { b: 'bencinski', d: 'dizelski', e: 'električni', h: 'hibridni (HEV in PHEV)' };
const SRC_TAG = ['ARSO, WLTP', 'ADAC, WLTP', 'ADAC, NEDC→WLTP'];
const LPG_FACTOR = 1.2; // ponytail: LPG burns ~20 % more litres than petrol; ARSO lists the petrol figure
const SMALL_SAMPLE = 60; // ads behind a curve below which the app flags it
const YEAR = 2026;

let P, CARS, cars = [], nextId = 1;
const variantByLabel = new Map();

const plural = (n, one, two, few, many) => {
  const m = Math.abs(n) % 100;
  return m === 1 ? one : m === 2 ? two : m === 3 || m === 4 ? few : many;
};
const yearsWord = (n) => `${nf(0).format(n)} ${plural(n, 'leto', 'leti', 'leta', 'let')}`;
const yearsLoc = (n) => `${nf(0).format(n)} ${plural(n, 'letu', 'letih', 'letih', 'letih')}`; // "pri 3 letih"
const adsWord = (n) => `${nf(0).format(n)} ${plural(n, 'oglas', 'oglasa', 'oglasi', 'oglasov')}`;
const variantLabel = (r) => `${r[0]} ${r[1]} · ${FUEL_NAME[r[2]]} · ${r[2] === 'e' ? nf(1).format(r[4]) + ' kWh' : nf(1).format(r[3]) + ' l'} · ${SRC_TAG[r[7]]}`;
const groupOf = (fuel) => (fuel === 'e' ? 'e' : fuel === 'd' ? 'd' : ['hev', 'pb', 'pd'].includes(fuel) ? 'h' : 'b');

// ---------- market curves ----------

// Median German asking price at an age: log-linear between the sampled yearly medians,
// outside the sampled years extended with the curve's own average yearly loss (k).
function priceAt(c, age) {
  const p = c.pts;
  if (age <= p[0][0]) return p[0][1] * Math.exp(-c.k * (age - p[0][0]));
  for (let i = 1; i < p.length; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i];
    if (age <= x1) return Math.exp(Math.log(y0) + ((age - x0) / (x1 - x0)) * (Math.log(y1) - Math.log(y0)));
  }
  const [xn, yn] = p[p.length - 1];
  return yn * Math.exp(-c.k * (age - xn));
}

// Group fallback: relative value by whole year (1 = new), log-interpolated.
function relAt(rel, age) {
  const i = Math.min(Math.floor(age), rel.length - 2);
  const t = age - i;
  return Math.exp(Math.log(rel[i]) + t * (Math.log(rel[i + 1]) - Math.log(rel[i])));
}

function matchCurves(make, model) {
  const name = model.replace(/^NOV[IA]\s+/i, '');
  return P.curves.filter((c) => c.make === make && new RegExp(c.re, 'i').test(name));
}

// Picks the curve for a car's own model and fuel group; never borrows another fuel group's curve.
function autoCurve(c, make, model) {
  const g = groupOf(c.fuel);
  const matches = make ? matchCurves(make, model) : [];
  const own = matches.find((x) => x.group === g);
  c.modelKey = (own || matches[0] || {}).key || null;
  c.modelLabel = (own || matches[0] || {}).label || null;
  c.curve = own && !own.thin ? P.curves.indexOf(own) : null;
  c.curveWhy = own ? (own.thin ? 'thin' : 'own') : matches.length ? 'nogroup' : make ? 'nomodel' : 'custom';
  c.thinN = own ? own.n : 0;
  c.thinWhy = own ? own.why : null;
}

const curveOf = (c) => (c.curve === null ? null : P.curves[c.curve]);
const groupUsed = (c) => (curveOf(c) ? curveOf(c).group : groupOf(c.fuel));
const siInfo = (c) => (c.modelKey && P.si[c.modelKey]) || null;

function valuation(c, years) {
  const cur = curveOf(c);
  const at = (a) => (cur ? priceAt(cur, a) : relAt(P.groups[groupUsed(c)], a));
  const a0 = c.age, a1 = c.age + years;
  const share = at(a1) / at(a0);
  const sold = c.origin === 'eu' ? c.ratio / 100 : 1; // an import is resold in Slovenia
  const extrap = cur && (a0 < cur.pts[0][0] - 0.5 || a1 > cur.pts[cur.pts.length - 1][0] + 0.5);
  return { share, resaleAuto: c.price * share * sold, extrap, v0: cur && at(a0), v1: cur && at(a1) };
}

function marketPrice(c) {
  const cur = curveOf(c);
  if (!cur) return {};
  const de = priceAt(cur, c.age);
  return { de, si: (de * c.ratio) / 100 };
}

// ---------- taxes and costs ----------

function euroDefault(age) {
  const y = YEAR - age;
  return y >= 2021 ? 'EURO 6d' : y >= 2015 ? 'EURO 6 (6a, 6b)' : y >= 2011 ? 'EURO 5' : y >= 2006 ? 'EURO 4' : 'EURO 0–3';
}

function dmv(c) {
  if (c.fuel === 'e') return 0;
  const g = c.fuel === 'd' || c.fuel === 'pd' ? 'd' : 'b';
  const co2 = Math.round((c.co2 || 0) * (c.co2Type === 'nedc' ? P.dmv.nedcFactor[g] : 1));
  let band = P.dmv.co2[g][0];
  for (const b of P.dmv.co2[g]) if (co2 >= b[0]) band = b;
  const base = co2 > 50 ? band[2] + (co2 - band[0]) * band[1] : 0;
  const tax = base + P.dmv.euro[g][c.euro];
  const pct = c.newVat ? 100 : P.dmv.agePct[Math.min(Math.floor(c.age), 10)];
  return Math.round(tax * pct) / 100;
}

function importCosts(c) {
  if (c.origin !== 'eu') return [];
  const I = P.import;
  const rows = [
    ['Davek na motorna vozila (DMV)', dmv(c)],
    [I.conformity.label, I.conformity.price],
    [I.inspection.label, I.inspection.price],
    ['Registracija', c.registration],
    ['Prevoz', c.transport],
  ];
  if (c.newVat) rows.unshift(['DDV 22 % (novo vozilo)', c.price * I.vat]);
  return rows;
}

function compute(c, kmYear, years) {
  const price = (k) => P.energy[k].price;
  const fuelPerKm = c.fuel === 'e' ? 0 : (c.lit * price(c.fuelKind)) / 100;
  const elPerKm = ['e', 'pb', 'pd'].includes(c.fuel) ? (c.kwh * price(c.elKind)) / 100 : 0;
  const share = c.fuel === 'e' ? 1 : ['pb', 'pd'].includes(c.fuel) ? c.evShare / 100 : 0;
  const energyPerKm = share * elPerKm + (1 - share) * fuelPerKm;
  const imp = importCosts(c).reduce((s, r) => s + r[1], 0);
  const val = valuation(c, years);
  const resale = c.resaleTouched ? c.resale : val.resaleAuto;
  const loss = c.price + imp - resale;
  const km = kmYear * years;
  const depPerKm = loss / km;
  return { energyPerKm, depPerKm, totalPerKm: energyPerKm + depPerKm, imp, resale, loss, km, val,
    energyYear: energyPerKm * kmYear, lossYear: loss / years };
}

// ---------- car cards ----------

function newCar(r) {
  const c = { id: nextId++, name: '', src: null, fuel: 'b', lit: 6, kwh: 17, co2: 130, evShare: 50, fuelKind: 'b95', elKind: 'el_home',
    origin: 'si', age: 3, price: 20000, ratio: P.ratio, co2Type: 'wltp', euro: euroDefault(3), resale: 0, resaleTouched: false,
    transport: P.import.transport.price, registration: P.import.registration.price, newVat: false };
  if (r) applyVariant(c, r);
  else autoCurve(c, null, '');
  return c;
}

function applyVariant(c, r) {
  const [make, model, fuel, lit, kwh, co2, , src] = r;
  c.name = `${make} ${model}`;
  c.src = src;
  c.fuel = fuel;
  if (lit) c.lit = fuel === 'lpg' ? +(lit * LPG_FACTOR).toFixed(1) : lit;
  if (kwh) c.kwh = kwh;
  else if (fuel === 'pb' || fuel === 'pd') c.kwh = 18;
  if (co2) c.co2 = co2;
  c.co2Type = src === 2 ? 'nedc' : 'wltp';
  const end = model.match(/\(\d\d\/\d\d - \d\d\/(\d\d)\)/); // ADAC names carry the production period (MM/YY - MM/YY)
  if (end) { c.age = Math.max(0, YEAR - 2000 - +end[1]); c.euro = euroDefault(c.age); }
  c.fuelKind = FUEL_KINDS[fuel] ? FUEL_KINDS[fuel][0] : c.fuelKind;
  autoCurve(c, make, model);
  const si = siInfo(c);
  c.ratio = si && si.n >= 8 ? si.ratio : P.ratio;
  c.priceTouched = false;
  c.resaleTouched = false;
  suggestPrice(c);
}

function suggestPrice(c) {
  const mp = marketPrice(c);
  const p = c.origin === 'eu' ? mp.de : mp.si;
  if (p) c.price = Math.round(p / 100) * 100;
}

function fillSelect(sel, keys, labelOf) {
  sel.innerHTML = keys.map((k) => `<option value="${k}">${labelOf(k)}</option>`).join('');
}

function curveOptions() {
  return ['e', 'h', 'b', 'd'].map((g) => {
    const opts = P.curves.map((x, i) => [x, i]).filter(([x]) => x.group === g && !x.thin)
      .sort(([a], [b]) => a.label.localeCompare(b.label, 'sl'))
      .map(([x, i]) => `<option value="${i}">${x.label} – ${FUEL_NAME[x.group === 'h' ? 'hev' : x.group]} (${adsWord(x.n)})</option>`).join('');
    return `<optgroup label="${GROUP_NAME[g][0].toUpperCase() + GROUP_NAME[g].slice(1)} avti">${opts}</optgroup>`;
  }).join('');
}

function renderCard(c, el) {
  el.querySelector('.car-title').textContent = c.name || 'Avto po meri';
  fillSelect($('[name=fuelKind]', el), FUEL_KINDS[c.fuel] || ['b95'], (k) => P.energy[k].label);
  $('[name=curve] option[value=""]', el).textContent = `Povprečje: ${GROUP_NAME[groupOf(c.fuel)]} avti`;
  for (const k of ['fuel', 'fuelKind', 'elKind', 'lit', 'kwh', 'evShare', 'age', 'price', 'ratio', 'co2', 'co2Type', 'euro', 'transport', 'registration']) {
    $(`[name=${k}]`, el).value = k === 'ratio' ? Math.round(c[k]) : c[k];
  }
  $('[name=curve]', el).value = c.curve === null ? '' : String(c.curve);
  $('[name=newVat]', el).checked = c.newVat;
  el.querySelectorAll('.seg input').forEach((i) => { i.checked = i.value === c.origin; });
  el.querySelectorAll('.f-fuel').forEach((x) => { x.hidden = c.fuel === 'e'; });
  el.querySelectorAll('.f-el').forEach((x) => { x.hidden = !['e', 'pb', 'pd'].includes(c.fuel); });
  el.querySelectorAll('.f-phev').forEach((x) => { x.hidden = !['pb', 'pd'].includes(c.fuel); });
  el.querySelectorAll('.f-eu').forEach((x) => { x.hidden = c.origin !== 'eu'; });
  renderHints(c, el);
}

function consumptionNote(c) {
  if (!c.name) return 'Avta ni na seznamu? Izberite pogon in vpišite porabo ter kupnino sami.';
  if (c.src === 2) return 'Poraba: ADAC Autokatalog, izmerjena po NEDC in preračunana v WLTP (× 1,22 bencin, × 1,20 dizel, kot ZDMV-1 za CO2). CO2 za DMV ostane NEDC.';
  if (c.src === 1) return 'Poraba: ADAC Autokatalog, WLTP.';
  return 'Poraba: seznam ARSO, WLTP (avti, ki so zdaj v prodaji).';
}

// Value-lost explanation with the ad counts behind it (per country and total); thin data flagged.
function depNote(c, r, years) {
  const cur = curveOf(c);
  const si = siInfo(c);
  const siN = si ? si.n : 0;
  const lines = [];
  let warn = false;
  if (c.resaleTouched) {
    lines.push('<p><b>Vrednost ob prodaji ste vpisali sami.</b> <button type="button" class="link reset-resale">Po tržnih podatkih</button></p>');
  }
  if (cur) {
    const deN = cur.n;
    const small = deN < SMALL_SAMPLE || cur.pts.length < 4;
    warn = small || r.val.extrap;
    lines.push(`<p>${cur.label}, ${FUEL_NAME[cur.group === 'h' ? 'hev' : cur.group]}: pri ${yearsLoc(c.age)} ~${eur(r.val.v0)}, čez ${yearsWord(years)} ~${eur(r.val.v1)} (${nf(0).format((r.val.share - 1) * 100)} %).</p>`);
    lines.push(`<p class="counts">Na podlagi: Nemčija ${adsWord(deN)} (${cur.pts.length} ${plural(cur.pts.length, 'letnik', 'letnika', 'letniki', 'letnikov')}, ${cur.pts.map((p) => p[2]).join('/')} na letnik)`
      + ` · Slovenija ${adsWord(siN)} (raven cen, vsi pogoni${siN < 8 ? '; premalo, zato povprečje vseh modelov' : ''})`
      + ` · skupaj ${adsWord(deN + siN)}</p>`);
    if (small) lines.push(`<p class="warn">Majhen vzorec – številka je groba ocena.</p>`);
    if (r.val.extrap) {
      lines.push(`<p class="warn">Oglasi pokrivajo starost ${nf(0).format(cur.pts[0][0])}–${nf(0).format(cur.pts[cur.pts.length - 1][0])} let; zunaj tega računamo s povprečnim letnim padcem tega modela.</p>`);
    }
  } else {
    warn = true;
    const g = groupUsed(c);
    const n = P.curves.filter((x) => x.group === g && !x.thin);
    const why = { thin: c.thinWhy ? `Krivulje za ${c.modelLabel} (${FUEL_NAME[c.fuel]}) ne uporabljamo: ${c.thinWhy}.`
      : `Za ${c.modelLabel} (${FUEL_NAME[c.fuel]}) je premalo oglasov (${adsWord(c.thinN)}).`,
      nogroup: `Za ${c.modelLabel} nimamo oglasov s tem pogonom.`,
      nomodel: 'Za ta model nimamo tržnih podatkov.', custom: 'Avto po meri.',
      manual: 'Izbrali ste povprečje.' }[c.curveWhy] || '';
    lines.push(`<p class="warn">${why} Uporabljamo povprečno krivuljo: ${GROUP_NAME[g]} avti (${n.length} modelov, ${adsWord(n.reduce((s, x) => s + x.n, 0))} v Nemčiji): čez ${yearsWord(years)} ${nf(0).format((r.val.share - 1) * 100)} %.</p>`);
    lines.push('<p>Izberite podoben model zgoraj ali vpišite vrednost ob prodaji sami.</p>');
  }
  return { html: lines.join(''), warn };
}

function renderHints(c, el, r) {
  const years = +$('#years').value || 5;
  r = r || compute(c, +$('#kmYear').value || 15000, years);
  $('.match', el).textContent = consumptionNote(c);
  const mp = marketPrice(c);
  $('.market', el).innerHTML = mp.de
    ? `Tipična oglaševana cena pri ${yearsLoc(c.age)}: SLO ~${eur(mp.si)} · DE ~${eur(mp.de)} <button type="button" class="link use-price">Uporabi</button>`
    : '';
  $('.resale-label', el).textContent = `Vrednost ob prodaji čez ${yearsWord(years)} (€)`;
  const resaleInp = $('[name=resale]', el);
  if (!c.resaleTouched && document.activeElement !== resaleInp) resaleInp.value = Math.round(r.resale / 100) * 100;
  const note = depNote(c, r, years);
  const box = $('.dep-src', el);
  box.innerHTML = note.html;
  box.classList.toggle('is-warn', note.warn);
  const imp = importCosts(c);
  $('.breakdown', el).innerHTML = imp.map(([k, v]) => `<tr><td>${k}</td><td>${eur(v, 2)}</td></tr>`).join('')
    + `<tr class="sum"><td>Skupaj uvoz</td><td>${eur(imp.reduce((s, x) => s + x[1], 0), 2)}</td></tr>`;
}

function bindCard(c) {
  const el = $('#carTpl').content.firstElementChild.cloneNode(true);
  el.dataset.id = c.id;
  el.querySelectorAll('.seg input').forEach((i) => { i.name = `origin-${c.id}`; });
  fillSelect($('[name=elKind]', el), EL_KINDS, (k) => P.energy[k].label);
  fillSelect($('[name=euro]', el), Object.keys(P.dmv.euro.b), (k) => k);
  $('[name=curve]', el).innerHTML = `<option value="">Povprečje</option>${curveOptions()}`;
  $('[name=variant]', el).value = c.name;

  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.name === 'variant') {
      const r = variantByLabel.get(t.value);
      if (!r) return;
      applyVariant(c, r);
      t.value = c.name;
      renderCard(c, el);
    } else if (t.type === 'radio') {
      c.origin = t.value;
      if (!c.priceTouched) suggestPrice(c);
      renderCard(c, el);
    } else if (t.name === 'newVat') {
      c.newVat = t.checked;
    } else if (t.name === 'curve') {
      c.curve = t.value === '' ? null : +t.value;
      c.curveWhy = 'manual';
      if (!c.priceTouched) { suggestPrice(c); $('[name=price]', el).value = c.price; }
    } else if (t.name) {
      const v = t.type === 'number' ? parseFloat(t.value) : t.value;
      if (t.type === 'number' && !Number.isFinite(v)) return;
      c[t.name] = v;
      if (t.name === 'price') c.priceTouched = true;
      if (t.name === 'resale') c.resaleTouched = true;
      if (t.name === 'age') {
        c.euro = euroDefault(v);
        $('[name=euro]', el).value = c.euro;
        if (!c.priceTouched) { suggestPrice(c); $('[name=price]', el).value = c.price; }
      }
      if (t.name === 'fuel') {
        c.fuelKind = (FUEL_KINDS[v] || ['b95'])[0];
        if (curveOf(c) && curveOf(c).group !== groupOf(v)) { c.curve = null; c.curveWhy = 'nogroup'; }
        renderCard(c, el);
      }
    }
    renderResults();
  });
  el.addEventListener('click', (e) => {
    const cl = e.target.classList;
    if (cl.contains('use-price')) {
      suggestPrice(c);
      $('[name=price]', el).value = c.price;
    } else if (cl.contains('reset-resale')) {
      c.resaleTouched = false;
    } else if (cl.contains('remove')) {
      cars = cars.filter((x) => x !== c);
      el.remove();
    } else return;
    renderResults();
  });
  renderCard(c, el);
  $('#cars').append(el);
  return el;
}

// ---------- results ----------

function renderResults() {
  const kmYear = +$('#kmYear').value || 15000;
  const years = +$('#years').value || 5;
  const rows = cars.map((c) => ({ c, r: compute(c, kmYear, years) }));
  for (const { c, r } of rows) {
    const el = $(`.car[data-id="${c.id}"]`);
    renderHints(c, el, r);
    $('.mini', el).innerHTML = `<b>${nf(0).format(100 / r.energyPerKm)} km</b> za 100 € goriva/elektrike · <b>${nf(0).format(100 / r.totalPerKm)} km</b> z izgubo vrednosti · ${nf(3).format(r.totalPerKm)} €/km`;
  }
  const maxKm = Math.max(...rows.map(({ r }) => 100 / r.energyPerKm), 1);
  const maxCost = Math.max(...rows.map(({ r }) => r.totalPerKm), 0.01);
  const basis = (c) => {
    if (c.resaleTouched) return '<span class="n">vaša ocena</span>';
    const cur = curveOf(c);
    if (!cur) return `<span class="n warn">povprečje skupine</span>`;
    const small = cur.n < SMALL_SAMPLE || cur.pts.length < 4;
    return `<span class="n${small ? ' warn' : ''}">${adsWord(cur.n)}${small ? ', majhen vzorec' : ''}</span>`;
  };
  $('#results').innerHTML = rows.length ? rows.map(({ c, r }) => `
    <div class="res">
      <h3>${c.name || 'Avto po meri'} <span class="tag">${yearsWord(c.age)} · ${eur(c.price)}${c.origin === 'eu' ? ' · uvoz' : ''}</span></h3>
      <div class="kpis">
        <div><b>${nf(0).format(100 / r.energyPerKm)} km</b><span>za 100 € goriva/elektrike</span></div>
        <div><b>${nf(0).format(100 / r.totalPerKm)} km</b><span>za 100 € z izgubo vrednosti</span></div>
        <div><b>${nf(3).format(r.totalPerKm)} €</b><span>na km skupaj</span></div>
      </div>
      <div class="bar" title="Kilometri za 100 € goriva ali elektrike">
        <i class="b-km" style="width:${(100 / r.energyPerKm / maxKm) * 100}%"></i>
      </div>
      <div class="bar stack" title="Strošek na km: energija + izguba vrednosti">
        <i class="b-en" style="width:${(r.energyPerKm / maxCost) * 100}%"></i><i class="b-dep" style="width:${(Math.max(r.depPerKm, 0) / maxCost) * 100}%"></i>
      </div>
      <p class="legend"><span class="sw b-km"></span>km za 100 € energije
        <span class="sw b-en"></span>energija ${nf(3).format(r.energyPerKm)} €/km · ${eur(r.energyYear)}/leto
        <span class="sw b-dep"></span>izguba vrednosti ${nf(3).format(r.depPerKm)} €/km · ${eur(r.lossYear)}/leto ${basis(c)}</p>
      <p class="small">Izguba vrednosti v ${yearsLoc(years)}: <b>${eur(r.loss)}</b> (kupnina ${eur(c.price)}${r.imp ? ` + uvoz ${eur(r.imp)}` : ''} − vrednost ob prodaji ~${eur(r.resale)}), ${nf(0).format(r.km)} km.</p>
    </div>`).join('') : '<p>Dodajte avto.</p>';
}

// ---------- prices & sources ----------

function renderPrices() {
  $('#prices').innerHTML = Object.entries(P.energy).map(([k, e]) => `
    <label>${e.label} (${e.unit})
      <input type="number" data-k="${k}" value="${e.price}" min="0" step="0.001" inputmode="decimal">
      <small>${e.note} · <a href="#src-${e.src}">vir</a></small>
    </label>`).join('');
  $('#prices').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v)) { P.energy[e.target.dataset.k].price = v; renderResults(); }
  });
}

function renderSources() {
  const s = P.sources;
  const good = P.curves.filter((x) => !x.thin);
  const ev = good.filter((x) => x.group === 'e');
  const li = Object.entries(s).map(([k, v]) => `<li id="src-${k}">${v.url ? `<a href="${v.url}" rel="noopener" target="_blank">${v.title}</a>` : v.title}</li>`).join('');
  const nSrc = (i) => CARS.filter((r) => r[7] === i).length;
  $('#sources').innerHTML = `
    <h3>Kaj računamo</h3>
    <ul>
      <li><b>Energija na km</b> = poraba (l ali kWh na 100 km) × cena ÷ 100. Pri priključnem hibridu tehtamo po deležu km na elektriko.</li>
      <li><b>Izguba vrednosti</b> = kupnina + stroški uvoza − vrednost ob prodaji. Vrednost ob prodaji = kupnina × (tržna cena pri starosti ob prodaji ÷ tržna cena pri starosti ob nakupu), obe iz krivulje oglasov za isti model in isti pogon. Pri uvozu še × razmerje cen SLO/DE, ker avto prodate v Sloveniji. Vrednost ob prodaji lahko vpišete sami.</li>
      <li><b>Km za 100 €</b> = 100 ÷ strošek na km. Prva številka je samo gorivo ali elektrika (kot v izvirnem grafu), druga doda izgubo vrednosti.</li>
      <li>Ne upoštevamo zavarovanja, letne dajatve, servisov, gum in financiranja.</li>
    </ul>
    <h3>Podatki</h3>
    <ul>
      <li>Poraba: ${nf(0).format(nSrc(0))} različic iz seznama ARSO (WLTP, avti v prodaji) in ${nf(0).format(nSrc(1) + nSrc(2))} starejših ali opuščenih iz ADAC Autokatalog (${nf(0).format(nSrc(1))} WLTP, ${nf(0).format(nSrc(2))} NEDC, preračunanih v WLTP z ×1,22 za bencin in ×1,20 za dizel, kot ZDMV-1 za CO2). Vir in cikel sta pri vsakem vnosu. Če avta ni, ga vnesite ročno. WLTP poraba elektrike je merjena na vtičnici, z izgubami pri polnjenju.</li>
      <li>Izguba vrednosti: mediane oglaševanih cen po letniku za vsak model <i>in pogon posebej</i> (zajem ${P.fetched}): ${good.length} krivulj, od tega ${ev.length} za električne avte, skupaj ${adsWord(P.sample.de)} na AutoScout24.de (Nemčija). Električni in hibridni avti imajo svoje krivulje iz svojih oglasov. Kjer je za model in pogon premalo oglasov (manj kot 3 letniki s po vsaj 4 oglasi), aplikacija to pove in uporabi povprečje istega pogona. Število oglasov je navedeno ob vsaki številki.</li>
      <li>Raven cen v Sloveniji: ${adsWord(P.sample.si)} na Bolhi; mediana ${nf(0).format(P.ratio)} % nemških cen. Bolha je večinoma zasebna prodaja, AutoScout24 večinoma trgovci. Avto.net in mobile.de samodejnega branja ne dovolita, zato ju nismo uporabili. To so oglaševane, ne prodajne cene; kilometrina in oprema nista upoštevani.</li>
      <li>DMV po ZDMV-1: znesek po CO2 + znesek po emisijskem razredu, pri rabljenem vozilu znižan glede na starost (91 % do 1 leta … 33 % nad 10 let). Električni avti ne plačajo DMV. Znižanje za 8+ sedežev ni upoštevano. Končni znesek odmeri FURS.</li>
    </ul>
    <h3>Viri</h3><ol class="src">${li}</ol>`;
}

// ---------- boot ----------

async function boot() {
  [P, CARS] = await Promise.all(['data/presets.json', 'data/cars.json'].map((u) => fetch(u, { cache: 'no-cache' }).then((r) => r.json())));
  const opts = [];
  for (const r of CARS) {
    const l = variantLabel(r);
    variantByLabel.set(l, r);
    opts.push(`<option value="${l.replace(/"/g, '&quot;')}">`);
  }
  $('#variants').innerHTML = opts.join('');
  renderPrices();
  renderSources();
  const pick = (re, fuel) => CARS.find((r) => r[2] === fuel && r[7] === 0 && re.test(`${r[0]} ${r[1]}`));
  for (const r of [pick(/ŠKODA Octavia.*2\.0 TDI/i, 'd'), pick(/TESLA Model 3 Rear/i, 'e')]) {
    if (r) cars.push(newCar(r));
  }
  cars.forEach(bindCard);
  $('#addCar').addEventListener('click', () => {
    const c = newCar();
    cars.push(c);
    bindCard(c).querySelector('[name=variant]').focus();
    renderResults();
  });
  $('#kmYear').addEventListener('input', renderResults);
  $('#years').addEventListener('input', renderResults);
  renderResults();
}

if (typeof document !== 'undefined') boot();
else module.exports = { dmv, compute, valuation, priceAt, relAt, setPresets: (p) => { P = p; } }; // for tools/check.js
