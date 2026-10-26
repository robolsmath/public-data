// Weekly league updates: loads one week's numbers (data/) and write-up (content/) on demand and draws the page.
const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
};
const get = async (url, json = true) => { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw Object.assign(new Error(r.statusText), { status: r.status }); return json ? r.json() : r.text(); };
const pad = (n) => String(n).padStart(2, '0');
const num = (v, d = 0) => Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (p, d = 0) => `${(p * 100).toFixed(d)}%`;
const state = { man: null, season: null, week: null, data: null };

// ---------- a very small markdown reader (headings, lists with nesting, quotes, bold/italic/links)
function markdown(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>').replace(/\[(.+?)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const root = h('div'); let list = null; let depthStack = []; let para = [];
  const flushPara = () => { if (para.length) { root.append(h('p', { html: inline(para.join(' ')) })); para = []; } };
  const closeList = () => { list = null; depthStack = []; };
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const li = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const depth = Math.floor(li[1].replace(/\t/g, '  ').length / 2);
      if (!list) { list = h('ul'); root.append(list); depthStack = [list]; }
      while (depthStack.length - 1 > depth) depthStack.pop();
      while (depthStack.length - 1 < depth) { const parent = depthStack[depthStack.length - 1]; const sub = h('ul'); (parent.lastElementChild || parent.appendChild(h('li'))).append(sub); depthStack.push(sub); }
      depthStack[depthStack.length - 1].append(h('li', { html: inline(li[2]) }));
      continue;
    }
    if (!line.trim()) { flushPara(); closeList(); continue; }
    closeList();
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) { flushPara(); root.append(h(m[1].length <= 2 ? 'h3' : 'h4', { html: inline(m[2]) })); }
    else if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); root.append(h('blockquote', { html: inline(m[1]) })); }
    else para.push(line.trim());
  }
  flushPara();
  return root;
}

// ---------- formatting
const isPct = (c) => state.data.percent.includes(c);
const fmt = (c, v) => (v == null ? '–' : isPct(c) ? v.toFixed(3).replace(/^0/, '') : Number.isInteger(v) ? String(v) : v.toFixed(1));
const heat = (rank, n = 12) => { const t = n > 1 ? (rank - 1) / (n - 1) : 0.5; return t < 0.5 ? `background:rgba(52,199,89,${((0.5 - t) * 0.42).toFixed(2)})` : `background:rgba(255,59,48,${((t - 0.5) * 0.34).toFixed(2)})`; };
const team = (m, t) => h('span', { class: 'team' }, h('span', { class: 'nm' }, h('b', m), t && t !== m ? h('small', t) : null));
const rankBadge = (r) => h('span', { class: `rank${r <= 3 ? ' r' + r : ''}` }, r);
const awardValue = (a, v) => (typeof v !== 'number' ? v : a === 'Mr. Efficiency' ? pct(v, 1) : a === 'Point God' ? v.toFixed(2) : num(v));

// ---------- sections
function sec(id, title, sub, body, flush) { return h('section', { id }, h('div', { class: 'sec-head' }, h('h2', title), sub ? h('small', sub) : null), flush ? h('div', { class: 'card flush' }, body) : h('div', { class: 'card' }, body)); }
const tbl = (heads, rows, { cut, cls = '' } = {}) => h('div', { class: `scroll ${cls}` }, h('table', h('thead', h('tr', heads.map((x) => h('th', { class: x.l ? 'l' : '' }, x.t ?? x)))), h('tbody', rows.map((r, i) => h('tr', { class: cut === i + 1 ? 'cut' : '' }, r)))));
const td = (c, cls) => h('td', { class: cls || '' }, c);

function standings(d) {
  return sec('standings', 'Standings', `After week ${d.week}. Top ${d.playoff_teams} make the playoffs.`, tbl(
    ['#', '', { t: 'Team', l: true }, 'Categories', 'Pts', 'GB', 'Matchups'],
    d.standings.map((r) => [td(rankBadge(r.rank)), td(r.change ? h('span', { class: r.change > 0 ? 'up' : 'down' }, `${r.change > 0 ? '▲' : '▼'}${Math.abs(r.change)}`) : h('span', { class: 'muted' }, '–')),
      td(team(r.manager, r.team), 'l'), td(`${r.cw}-${r.cl}-${r.ct}`), td(h('b', num(r.points, 1))), td(num(r.gb, 1)), td(`${r.mw}-${r.ml}-${r.md}`)]), { cut: d.week <= d.regular_season_end ? d.playoff_teams : null }), true);
}

// One simple table for both results and the forecast: team | score (click for the category detail) | team.
function matchTable(rows) {
  const body = h('tbody');
  for (const r of rows) {
    const detail = h('tr', { class: 'detail', hidden: true }, h('td', { colspan: 3 }, h('table', h('tbody', r.detail))));
    const btn = h('button', { class: 'scorebtn', 'aria-expanded': 'false', title: 'Show category breakdown', onclick: () => { detail.hidden = !detail.hidden; btn.setAttribute('aria-expanded', String(!detail.hidden)); } }, r.mid, h('i', { class: 'chev' }));
    body.append(h('tr', h('td', { class: `side ${r.a.dim ? 'dim' : ''}` }, h('b', r.a.name), r.a.sub ? h('small', r.a.sub) : null), h('td', { class: 'mid' }, btn),
      h('td', { class: `side r ${r.b.dim ? 'dim' : ''}` }, h('b', r.b.name), r.b.sub ? h('small', r.b.sub) : null)), detail);
  }
  return h('div', { class: 'mt' }, h('table', body));
}
const catRow = (left, mid, right, lw, rw, sub) => h('tr', h('td', { class: lw ? 'w' : '' }, left), h('td', { class: 'cat' }, mid, sub ? h('small', sub) : null), h('td', { class: rw ? 'w' : '' }, right));

function results(d) {
  if (!d.results.length) return null;
  return sec('results', 'Match results', 'Tap a score to see the nine categories.', matchTable(d.results.map((m) => ({
    a: { name: m.a.manager, sub: m.a.team, dim: m.winner === 'b' }, b: { name: m.b.manager, sub: m.b.team, dim: m.winner === 'a' },
    mid: `${m.a.cats}–${m.b.cats}${m.ties ? '–' + m.ties : ''}`,
    detail: m.cats.map((c) => catRow(fmt(c.cat, c.a), c.cat, fmt(c.cat, c.b), c.w === 1, c.w === -1)) }))));
}

function stats(d) {
  const n = d.stats.length; const cats = d.categories; const gp = d.stats.some((r) => r.games > 0); // manual seasons may not record games played
  const lower = new Set(d.lower_is_better);
  const cols = [
    { t: '#', asc: true, get: (r) => r.overall_rank, cell: (r) => td(h('b', r.overall_rank)) },
    { t: 'Team', l: true, get: (r) => r.manager.toLowerCase(), asc: true, cell: (r) => td(team(r.manager, null, true), 'l') },
    ...(gp ? [{ t: 'GP', get: (r) => r.games, cell: (r) => td(r.games) }] : []),
    ...cats.map((c) => ({ t: c, get: (r) => r.values[c], asc: lower.has(c), cell: (r) => h('td', { style: heat(r.ranks[c], n) }, fmt(c, r.values[c]), h('small', `${r.ranks[c]}`)) })),
    { t: 'Avg rank', get: (r) => r.avg_rank, asc: true, cell: (r) => td(h('b', r.avg_rank.toFixed(2))) },
    { t: 'Opponent', l: true, get: (r) => (r.opponent || '').toLowerCase(), asc: true, cell: (r) => td(r.opponent || '–', 'l') },
    { t: 'Result', get: (r) => (r.score ? r.score[0] - r.score[1] : -99), cell: (r) => td(r.score ? h('span', { class: `chip ${r.score[0] > r.score[1] ? 'win' : r.score[0] < r.score[1] ? 'loss' : 'tie'}` }, `${r.score[0]}-${r.score[1]}-${r.score[2]}`) : '–') }];
  let key = 0; let dir = 1; // the first column (overall rank) is the default order
  const head = h('tr'); const body = h('tbody');
  const draw = () => {
    const col = cols[key];
    const rows = [...d.stats].sort((x, y) => { const p = col.get(x); const q = col.get(y); return dir * (p < q ? -1 : p > q ? 1 : 0) || x.overall_rank - y.overall_rank; });
    body.replaceChildren(...rows.map((r) => h('tr', cols.map((c) => c.cell(r)))));
    [...head.children].forEach((th, i) => { th.classList.toggle('sorted', i === key); th.dataset.dir = i === key ? (dir === 1 ? 'asc' : 'desc') : ''; th.setAttribute('aria-sort', i === key ? (dir === 1 ? 'ascending' : 'descending') : 'none'); });
  };
  cols.forEach((c, i) => head.append(h('th', { class: `sortable ${c.l ? 'l' : ''}`, tabindex: 0, title: 'Sort by this column', onclick: () => { if (key === i) dir = -dir; else { key = i; dir = c.asc ? 1 : -1; } draw(); } }, c.t)));
  draw();
  return sec('stats', `Week ${d.week} stats`, 'Each stat with its rank among all teams in brackets (1 is best; fewer turnovers is better). Tap a column heading to sort.', h('div', { class: 'scroll dense' }, h('table', h('thead', head), body)), true);
}

function matrix(d) {
  const m = d.matrix;
  const cell = (c, actual) => h('td', { class: `cell ${c[0] > c[1] ? 'win' : c[0] < c[1] ? 'loss' : 'tie'} ${actual ? 'actual' : ''}` }, `${c[0]}-${c[1]}${c[2] ? '-' + c[2] : ''}`);
  return sec('matrix', 'Head-to-head', 'If every team had played every other team this week. Row team first; the outlined cell is the real opponent.', tbl(
    [{ t: 'Team', l: true }, ...m.teams, 'Beat'],
    m.teams.map((name, i) => [td(h('b', name), 'l'), ...m.teams.map((_, j) => (i === j ? h('td', { class: 'cell me' }) : cell(m.cells[i][j], m.actual[i] === j))),
      td(h('b', `${m.totals[i][0]}-${m.totals[i][1]}-${m.totals[i][2]}`))]), { cls: 'hm' }), true);
}

// Whole-number expected score: round a, b and the expected ties together so they still add up to the nine categories.
function wholeScore(m) {
  const raw = [m.expected[0], m.expected[1], Math.max(9 - m.expected[0] - m.expected[1], 0)];
  const out = raw.map(Math.floor); let left = 9 - out.reduce((x, y) => x + y, 0);
  const fav = m.p_a >= m.p_b ? 0 : 1; // equal remainders go to the favourite
  const order = [0, 1, 2].sort((i, j) => (raw[j] - out[j]) - (raw[i] - out[i]) || (i === fav ? -1 : j === fav ? 1 : i - j));
  for (const i of order) { if (left <= 0) break; out[i] += 1; left -= 1; }
  return out;
}

function forecast(d) {
  const f = d.forecast; if (!f || d.week < 3) return null;
  return sec('forecast', `Fearless Forecast: week ${f.week}`, 'Win chance for each matchup, from the weeks played so far. Tap the expected score (categories won, with ties if any) for each category. Schedules and injuries are not factored in.', matchTable(f.matchups.map((m) => ({
    a: { name: m.a, sub: pct(m.p_a), dim: m.p_a < m.p_b }, b: { name: m.b, sub: pct(m.p_b), dim: m.p_b < m.p_a },
    mid: wholeScore(m).filter((v, i) => i < 2 || v > 0).join('–'),
    detail: d.categories.map((c) => { const x = m.cats[c]; return catRow(fmt(c, x.a), c, fmt(c, x.b), x.p_a > 0.5, x.p_a < 0.5, `${pct(x.p_a)} · ${pct(1 - x.p_a)}`); }) }))));
}

function awards(d) {
  return sec('awards', 'Season awards: early favorites', 'Regular-season totals through this week.', tbl(
    [{ t: 'Award', l: true }, { t: 'Description', l: true }, 'Front runner', '2nd best'],
    d.awards.map((a) => [td(h('b', a.award), 'l'), td(a.description, 'l'), ...[0, 1].map((i) => td(a.leaders[i] ? [a.leaders[i].team, h('small', { class: 'muted' }, `  ${awardValue(a.award, a.leaders[i].value)}`)] : '–'))])), true);
}

function projections(d) {
  const p = d.projections; if (!p || d.week <= 10) return null;
  const body = h('div'); let mode = 'full';
  const draw = () => {
    const rows = (mode === 'recent' && p.recent) ? p.recent : p.full;
    body.replaceChildren(h('div', { style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;padding:18px 20px 6px' },
      h('span', { class: 'muted', style: 'font-size:13.5px' }, `${num(p.sims)} simulations of the remaining regular-season matchups; each category drawn from a normal distribution fitted to the team's weekly results. Probabilities, not predictions.`),
      p.recent ? h('div', { class: 'seg' }, ['full', 'recent'].map((k) => h('button', { class: k === mode ? 'sel' : '', onclick: () => { mode = k; draw(); } }, k === 'full' ? 'Full season' : 'Last 5 weeks'))) : null),
      tbl(['#', { t: 'Team', l: true }, 'Points', 'Projected', 'Playoffs', '#1 seed', ...(rows[0].p_title != null ? ['Title'] : [])],
        rows.map((r, i) => [td(rankBadge(i + 1)), td(team(r.manager, null, true), 'l'), td(num(r.points, 1)), td(num(r.projected, 1)), td(h('b', pct(r.p_playoffs, 1))), td(pct(r.p_first, 1)), ...(r.p_title != null ? [td(pct(r.p_title, 1))] : [])])));
  };
  draw();
  return sec('projections', 'Final standings projections', null, body, true);
}

function picture(d) {
  const p = d.picture; if (!p || (p.weeks_left > 6 && !p.final)) return null;
  const k = p.playoff_teams; const seeds = p.teams.slice(0, k); const chasing = p.teams.slice(k, k + 4);
  const row = (t) => h('div', { class: 'seed' }, rankBadge(t.seed), team(t.manager, null, true), h('span', { class: 'meta' }, t.record, h('small', `${num(t.points, 1)} pts`)),
    h('span', { class: `chip ${t.state}` }, { clinched: 'Clinched', in: 'In', bubble: 'Bubble', eliminated: 'Eliminated', out: 'Out' }[t.state]));
  const sd = (m) => { const t = p.teams.find((x) => x.manager === m); return h('span', { class: 'team' }, h('b', `(${t.seed})`), m); };
  return sec('picture', 'Playoff picture', p.final ? 'Final regular-season standings.' : `If the playoffs started now. ${p.weeks_left} regular-season week${p.weeks_left === 1 ? '' : 's'} left.`,
    h('div', { class: 'picture' }, h('div', h('h3', { style: 'font-size:16px;margin-bottom:6px' }, 'In'), seeds.map(row), chasing.length ? [h('h3', { style: 'font-size:16px;margin:18px 0 6px' }, 'Chasing'), chasing.map(row)] : null),
      h('div', h('h3', { style: 'font-size:16px;margin-bottom:10px' }, 'First round'), p.byes.length ? h('p', { class: 'muted', style: 'margin-bottom:10px' }, 'Byes: ', p.byes.join(', ')) : null,
        p.matchups.map(([a, b]) => h('div', { class: 'bracket' }, sd(a), h('span', { class: 'muted' }, 'vs'), h('div', { class: 'r' }, sd(b)))))));
}

// ---------- the opening page of a season
const money = (v) => (v == null ? '–' : `Php ${num(v)}`);
function members(d) {
  const elo = d.members.some((x) => x.elo);
  const row = (m) => [td(team(m.manager, m.team), 'l'), td(m.rookie ? h('span', { class: 'chip bubble' }, 'Rookie') : m.seasons), td(m.titles || '–'), td(m.best || '–'), td(m.last || '–'),
    ...(elo ? [td(m.elo ? [m.elo, h('small', { class: 'muted' }, ` ${(m.elo_tier || '').replace(/^./, (c) => c.toUpperCase())}`)] : '–')] : [])];
  const head = [{ t: 'Team', l: true }, 'Seasons played', 'Titles', 'Best finish', 'Last season', ...(elo ? ['ELO'] : [])];
  const rooks = d.members.filter((m) => m.rookie);
  return h('div', sec('members', 'The league', `${d.teams} teams. ${rooks.length} rookie${rooks.length === 1 ? '' : 's'} this season.`, tbl(head, d.members.map(row)), true),
    h('p', { class: 'note' }, 'Seasons played counts every year since a manager joined, including the cancelled 2019-20 season.'));
}
function champions(d) {
  const t = d.titles.map(([m, n]) => h('span', { class: 'chip win' }, `${m} ${n}`));
  return sec('champions', 'List of champions', `${d.titles.length} different managers have won it all.`, h('div', h('div', { class: 'chips', style: 'margin:0 0 14px' }, t),
    tbl(['Season', 'NBA season', { t: 'Champion', l: true }], d.champions.map((c) => [td(c.idx), td(c.season), td(c.champion && !c.champion.startsWith('-') ? h('b', c.champion) : h('span', { class: 'muted' }, c.champion ? 'Cancelled' : '???'), 'l')]))));
}
function format(d) {
  const f = d.format; const m = d.money;
  const tile = (k, v) => h('div', { class: 'tile' }, h('small', k), h('b', v));
  return sec('format', 'Format and prizes', null, h('div', h('div', { class: 'tiles' }, tile('Format', `${f.categories.length}-category head-to-head`), tile('Regular season', `Through week ${f.regular_season_end}`),
    tile('Playoffs', `From week ${f.playoff_start}, top ${f.playoff_teams}`), tile('Entry fee', money(m.entry_fee)), tile('Total pot', money(m.pot))),
    h('p', { class: 'muted', style: 'margin:14px 2px 18px' }, f.categories.join(', ')),
    tbl([{ t: 'Prize', l: true }, 'Amount'], [...m.season.map((x) => [td(x.place, 'l'), td(money(x.prize))]), [td('Special awards (total)', 'l'), td(money(m.special))]])));
}
function introAwards(d) {
  return sec('awards', 'Special awards', 'Decided on regular-season totals.', tbl([{ t: 'Award', l: true }, { t: 'Description', l: true }, 'Prize'], d.money.awards.map((a) => [td(h('b', a.award), 'l'), td(a.description, 'l'), td(money(a.prize))])), true);
}
async function showIntro(seasonEntry) {
  const app = $('#app');
  let d; let md = null;
  try { [d, md] = await Promise.all([get(`data/${state.season}/intro.json`), get(`content/${state.season}/intro.md`, false).catch(() => null)]); }
  catch (e) { app.replaceChildren(h('p', { class: 'center muted' }, "Couldn't load this page.")); return; }
  const [first, ...rest] = seasonEntry.intro.headline.split(/(?<=:)\s+/);
  const parts = [[md ? 'welcome' : null, 'Welcome'], ['members', 'The league'], ['champions', 'Champions'], ['format', 'Format and prizes'], ['awards', 'Awards']].filter((x) => x[0]);
  app.replaceChildren(h('div', { class: 'page' },
    h('div', { class: 'hero' }, h('p', { class: 'eyebrow' }, `${seasonEntry.label} · Season ${d.number}`), h('h1', first, rest.length ? [' ', h('span', rest.join(' '))] : null), chips(seasonEntry)),
    h('nav', { class: 'jump' }, parts.map(([id, label]) => h('a', { href: `#${id}`, onclick: (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView(); } }, label))),
    md ? h('section', { id: 'welcome' }, h('div', { class: 'card' }, h('div', { class: 'writeup' }, markdown(md)))) : null,
    members(d), champions(d), format(d), introAwards(d)));
  window.scrollTo({ top: 0 });
  $('#foot').textContent = seasonEntry.label;
  document.title = `${state.man.title} · ${seasonEntry.label} · The beginning`;
  syncControls();
}

const pages = (s) => (s.intro ? [{ week: 0, label: s.intro.label }] : []).concat(s.weeks);
const chips = (s) => h('div', { class: 'chips' }, pages(s).map((w) => h('a', { href: `#/${s.id}/${w.week}`, class: `${w.week === state.week ? 'sel' : ''} ${w.week > (s.regular_season_end || 99) ? 'po' : ''}` }, w.week === 0 ? 'Intro' : w.week)));

// ---------- page
async function show() {
  const app = $('#app');
  const seasonEntry = state.man.seasons.find((s) => s.id === state.season);
  if (state.week === 0) return showIntro(seasonEntry);
  let data; let md = null;
  try { [data, md] = await Promise.all([get(`data/${state.season}/week-${pad(state.week)}.json`), get(`content/${state.season}/week-${pad(state.week)}.md`, false).catch(() => null)]); }
  catch (e) { app.replaceChildren(h('p', { class: 'center muted' }, `Couldn't load week ${state.week}.`)); return; }
  state.data = data;
  const [first, ...rest] = (data.counter.headline || `Week ${state.week}`).split(/(?<=!)\s+/);
  const dates = data.dates.start ? `${new Date(data.dates.start + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(data.dates.end + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : null;
  const parts = [
    [md ? 'review' : null, 'Week in review'], [data.forecast && data.week >= 3 ? 'forecast' : null, 'Forecast'], ['standings', 'Standings'], [data.results.length ? 'results' : null, 'Results'], ['stats', 'Stats'], ['matrix', 'Head-to-head'], ['awards', 'Awards'],
    [data.projections && data.week > 10 ? 'projections' : null, 'Projections'], [data.picture && (data.picture.final || data.picture.weeks_left <= 6) ? 'picture' : null, 'Playoffs']].filter((x) => x[0]);
  const page = h('div', { class: 'page' },
    h('div', { class: 'hero' }, h('p', { class: 'eyebrow' }, `${seasonEntry.label} · Week ${state.week}${dates ? ' · ' + dates : ''}`),
      h('h1', first, rest.length ? [' ', h('span', rest.join(' '))] : null),
      h('p', { class: 'sub' }, `${data.standings[0].manager} leads the standings with ${num(data.standings[0].points, 1)} points.`),
      chips(seasonEntry)),
    h('nav', { class: 'jump' }, parts.map(([id, label]) => h('a', { href: `#${id}`, onclick: (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView(); } }, label))),
    md ? h('section', { id: 'review' }, h('div', { class: 'sec-head' }, h('h2', 'Week in review')), h('div', { class: 'card' }, h('div', { class: 'writeup' }, markdown(md)))) : h('section', { id: 'review' }, h('div', { class: 'card' }, h('p', { class: 'pending' }, 'The write-up for this week is coming soon. The numbers are below.'))),
    forecast(data), standings(data), results(data), stats(data), matrix(data), awards(data), projections(data), picture(data));
  app.replaceChildren(page);
  window.scrollTo({ top: 0 });
  $('#foot').textContent = `Numbers generated ${new Date(data.generated).toLocaleString()} · ${seasonEntry.label}`;
  document.title = `${state.man.title} · ${seasonEntry.label} week ${state.week}`;
  syncControls();
}

function syncControls() {
  const s = state.man.seasons.find((x) => x.id === state.season);
  $('#season').value = state.season;
  $('#week').replaceChildren(...pages(s).map((w) => h('option', { value: w.week }, w.label)));
  $('#week').value = state.week;
  const i = pages(s).findIndex((w) => w.week === state.week);
  $('#prev').disabled = i <= 0; $('#next').disabled = i >= pages(s).length - 1;
}

const go = (season, week) => { location.hash = `#/${season}/${week}`; };
function route() {
  const m = /^#\/([^/]+)\/(\d+)/.exec(location.hash);
  let season = m && state.man.seasons.find((s) => s.id === m[1]) ? m[1] : state.man.seasons[0].id;
  const s = state.man.seasons.find((x) => x.id === season);
  let week = m && pages(s).find((w) => w.week === +m[2]) ? +m[2] : pages(s)[pages(s).length - 1].week;
  if (!m || season !== m[1] || week !== +m[2]) { history.replaceState(null, '', `#/${season}/${week}`); }
  state.season = season; state.week = week;
  show();
}

function theme() {
  const dark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  const icon = () => { $('#theme').innerHTML = dark()
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z"/></svg>'; };
  $('#theme').onclick = () => { const next = dark() ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('theme', next); } catch (e) { /* ignore */ } icon(); };
  icon();
}

(async function init() {
  theme();
  try { state.man = await get('data/manifest.json'); } catch (e) { $('#app').replaceChildren(h('p', { class: 'center muted' }, 'No updates published yet.')); return; }
  if (!state.man.seasons.length) { $('#app').replaceChildren(h('p', { class: 'center muted' }, 'No updates published yet.')); return; }
  $('#site-title').textContent = state.man.title;
  $('#season').replaceChildren(...state.man.seasons.map((s) => h('option', { value: s.id }, s.label)));
  $('#season').onchange = (e) => { const s = state.man.seasons.find((x) => x.id === e.target.value); go(s.id, pages(s)[pages(s).length - 1].week); };
  $('#week').onchange = (e) => go(state.season, +e.target.value);
  const step = (d) => { const s = state.man.seasons.find((x) => x.id === state.season); const p = pages(s); const i = p.findIndex((w) => w.week === state.week) + d; if (p[i]) go(state.season, p[i].week); };
  $('#prev').onclick = () => step(-1); $('#next').onclick = () => step(1);
  window.addEventListener('hashchange', route);
  route();
})();
