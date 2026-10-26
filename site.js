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
const ini = (n) => { const w = String(n).trim().split(/\s+/); return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase(); };
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
const team = (m, t, small = false) => h('span', { class: 'team' }, h('span', { class: 'av', style: small ? 'width:22px;height:22px;font-size:9px' : '' }, ini(m)), h('span', { class: 'nm' }, h('b', m), t && t !== m ? h('small', t) : null));
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

function results(d) {
  if (!d.results.length) return null;
  const card = (m) => {
    const aw = m.winner === 'a'; const bw = m.winner === 'b';
    return h('div', { class: 'match' },
      h('div', { class: 'row' }, h('div', { class: aw || !m.winner ? '' : 'loser' }, team(m.a.manager, m.a.team)),
        h('div', { class: 'score' }, h('b', m.a.cats, h('i', '–'), m.b.cats), m.ties ? h('small', `${m.ties} tied`) : null),
        h('div', { class: `r ${bw || !m.winner ? '' : 'loser'}` }, team(m.b.manager, m.b.team))),
      h('details', h('summary', 'Category breakdown'), h('table', h('tbody', m.cats.map((c) => h('tr',
        h('td', { class: c.w === 1 ? 'w' : '' }, fmt(c.cat, c.a)), h('td', { class: 'mid' }, c.cat), h('td', { class: c.w === -1 ? 'w' : '' }, fmt(c.cat, c.b))))))));
  };
  return sec('results', 'Match results', 'Each matchup is decided by categories won, out of nine.', h('div', { class: 'grid' }, d.results.map(card)));
}

function stats(d) {
  const n = d.stats.length; const cats = d.categories;
  return sec('stats', `Week ${d.week} stats`, 'Each stat with its rank among all teams in brackets (1 is best; fewer turnovers is better).', tbl(
    ['#', { t: 'Team', l: true }, 'GP', ...cats, 'Avg rank', { t: 'Opponent', l: true }, 'Result'],
    d.stats.map((r) => [td(h('b', r.overall_rank)), td(team(r.manager, null, true), 'l'), td(r.games), ...cats.map((c) => h('td', { style: heat(r.ranks[c], n) }, fmt(c, r.values[c]), h('small', `${r.ranks[c]}`))),
      td(h('b', r.avg_rank.toFixed(2))), td(r.opponent || '–', 'l'),
      td(r.score ? h('span', { class: `chip ${r.score[0] > r.score[1] ? 'win' : r.score[0] < r.score[1] ? 'loss' : 'tie'}` }, `${r.score[0]}-${r.score[1]}-${r.score[2]}`) : '–')]), { cls: 'dense' }), true);
}

function matrix(d) {
  const m = d.matrix;
  const cell = (c, actual) => h('td', { class: `cell ${c[0] > c[1] ? 'win' : c[0] < c[1] ? 'loss' : 'tie'} ${actual ? 'actual' : ''}` }, `${c[0]}-${c[1]}${c[2] ? '-' + c[2] : ''}`);
  return sec('matrix', 'Head-to-head', 'If every team had played every other team this week. Row team first; the outlined cell is the real opponent.', tbl(
    [{ t: 'Team', l: true }, ...m.teams, 'Beat'],
    m.teams.map((name, i) => [td(h('b', name), 'l'), ...m.teams.map((_, j) => (i === j ? h('td', { class: 'cell me' }) : cell(m.cells[i][j], m.actual[i] === j))),
      td(h('b', `${m.totals[i][0]}-${m.totals[i][1]}-${m.totals[i][2]}`))]), { cls: 'hm' }), true);
}

function forecast(d) {
  const f = d.forecast; if (!f) return null;
  const card = (m) => h('div', { class: 'match' },
    h('div', { class: 'row' }, h('div', team(m.a)), h('div', { class: 'score' }, h('b', m.expected[0].toFixed(1), h('i', '–'), m.expected[1].toFixed(1)), h('small', 'expected categories')), h('div', { class: 'r' }, team(m.b))),
    h('div', { class: 'prob' }, h('i', { class: 'pa', style: `width:${m.p_a * 100}%` }), h('i', { class: 'pt', style: `width:${m.p_tie * 100}%` }), h('i', { class: 'pb', style: `width:${m.p_b * 100}%` })),
    h('div', { class: 'plabels' }, h('b', pct(m.p_a)), h('small', m.p_tie >= 0.005 ? `tie ${pct(m.p_tie)}` : ''), h('b', pct(m.p_b))),
    h('details', h('summary', 'Category by category'), h('table', h('tbody', d.categories.map((c) => { const x = m.cats[c]; return h('tr',
      h('td', { class: x.p_a > 0.5 ? 'w' : '' }, fmt(c, x.a)), h('td', { class: 'mid' }, c, h('div', { style: 'font-size:11px' }, `${pct(x.p_a)} · ${pct(1 - x.p_a)}`)), h('td', { class: x.p_a < 0.5 ? 'w' : '' }, fmt(c, x.b))); })))));
  return sec('forecast', `Fearless Forecast: week ${f.week}`, 'Monte Carlo from the weeks played so far. Schedules, injuries and lineup changes are not factored in.', h('div', { class: 'grid' }, f.matchups.map(card)));
}

function awards(d) {
  return sec('awards', 'Season awards: early favorites', 'Regular-season totals through this week.', tbl(
    [{ t: 'Award', l: true }, { t: 'Description', l: true }, 'Front runner', '2nd best'],
    d.awards.map((a) => [td(h('b', a.award), 'l'), td(a.description, 'l'), ...[0, 1].map((i) => td(a.leaders[i] ? [a.leaders[i].team, h('small', { class: 'muted' }, `  ${awardValue(a.award, a.leaders[i].value)}`)] : '–'))])), true);
}

function projections(d) {
  const p = d.projections; if (!p || d.week < 4) return null;
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

// ---------- page
async function show() {
  const app = $('#app');
  const seasonEntry = state.man.seasons.find((s) => s.id === state.season);
  const sw = seasonEntry.weeks.find((w) => w.week === state.week);
  let data; let md = null;
  try { [data, md] = await Promise.all([get(`data/${state.season}/week-${pad(state.week)}.json`), get(`content/${state.season}/week-${pad(state.week)}.md`, false).catch(() => null)]); }
  catch (e) { app.replaceChildren(h('p', { class: 'center muted' }, `Couldn't load week ${state.week}.`)); return; }
  state.data = data;
  const [first, ...rest] = (data.counter.headline || `Week ${state.week}`).split(/(?<=!)\s+/);
  const dates = data.dates.start ? `${new Date(data.dates.start + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(data.dates.end + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : null;
  const parts = [
    [md ? 'review' : null, 'Week in review'], [data.forecast ? 'forecast' : null, 'Forecast'], ['standings', 'Standings'], [data.results.length ? 'results' : null, 'Results'], ['stats', 'Stats'], ['matrix', 'Head-to-head'], ['awards', 'Awards'],
    [data.projections && data.week >= 4 ? 'projections' : null, 'Projections'], [data.picture && (data.picture.final || data.picture.weeks_left <= 6) ? 'picture' : null, 'Playoffs']].filter((x) => x[0]);
  const page = h('div', { class: 'page' },
    h('div', { class: 'hero' }, h('p', { class: 'eyebrow' }, `${seasonEntry.label} · Week ${state.week}${dates ? ' · ' + dates : ''}`),
      h('h1', first, rest.length ? [' ', h('span', rest.join(' '))] : null),
      h('p', { class: 'sub' }, `${data.standings[0].manager} leads the standings with ${num(data.standings[0].points, 1)} points.`),
      h('div', { class: 'chips' }, seasonEntry.weeks.map((w) => h('a', { href: `#/${state.season}/${w.week}`, class: `${w.week === state.week ? 'sel' : ''} ${w.week > (seasonEntry.regular_season_end || 99) ? 'po' : ''}` }, w.week)))),
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
  $('#week').replaceChildren(...s.weeks.map((w) => h('option', { value: w.week }, w.label)));
  $('#week').value = state.week;
  const i = s.weeks.findIndex((w) => w.week === state.week);
  $('#prev').disabled = i <= 0; $('#next').disabled = i >= s.weeks.length - 1;
}

const go = (season, week) => { location.hash = `#/${season}/${week}`; };
function route() {
  const m = /^#\/([^/]+)\/(\d+)/.exec(location.hash);
  let season = m && state.man.seasons.find((s) => s.id === m[1]) ? m[1] : state.man.seasons[0].id;
  const s = state.man.seasons.find((x) => x.id === season);
  let week = m && s.weeks.find((w) => w.week === +m[2]) ? +m[2] : s.weeks[s.weeks.length - 1].week;
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
  $('#season').onchange = (e) => { const s = state.man.seasons.find((x) => x.id === e.target.value); go(s.id, s.weeks[s.weeks.length - 1].week); };
  $('#week').onchange = (e) => go(state.season, +e.target.value);
  const step = (d) => { const s = state.man.seasons.find((x) => x.id === state.season); const i = s.weeks.findIndex((w) => w.week === state.week) + d; if (s.weeks[i]) go(state.season, s.weeks[i].week); };
  $('#prev').onclick = () => step(-1); $('#next').onclick = () => step(1);
  window.addEventListener('hashchange', route);
  route();
})();
