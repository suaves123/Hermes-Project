/* Hermes general view: the whole crew at a glance. Body-system heatmaps, a health index,
   system scores, live vitals with 5-minute sparklines, and a crew comparison heatmap. */
(() => {
    'use strict';
    let dispose;
    function refreshView() {
        dispose?.();
        dispose = mount();
    }
    document.addEventListener('hermes:section', refreshView);
    refreshView();

function mount() {
    const host = document.getElementById('general-view');
    const section = document.getElementById('dashboard-general');
    const boot = document.getElementById('hermes-bootstrap');
    if (!host || !section || !boot) return;
    const lifetime = new AbortController();
    const options = {signal: lifetime.signal};
    const initial = JSON.parse(boot.textContent), S = window.HermesStats;
    const metrics = initial.metrics || {}, groups = initial.groups || {}, scenarios = initial.scenarios || {};
    const WINDOW_MS = 5 * 60 * 1000;
    const STATUS = {ok: 'Normal', warn: 'Attention', crit: 'Critical', none: 'No data'};
    const RANK = {none: -1, ok: 0, warn: 1, crit: 2};
    const BODY_SYSTEMS = ['cardiovascular', 'musculoskeletal', 'immune_stress', 'energy_sleep'];
    // Each body region takes the worst status of the measurements mapped to it.
    const REGIONS = {
        head:  {label: 'Head · stress & sleep',           keys: ['stress_level', 'cortisol', 'sleep_quality', 'sleep_hours']},
        lungs: {label: 'Lungs · oxygenation',             keys: ['spo2', 'respiratory_rate']},
        heart: {label: 'Heart · circulation',             keys: ['heart_rate', 'bp_systolic', 'bp_diastolic', 'hrv_rmssd']},
        core:  {label: 'Core · temperature & hydration',  keys: ['body_temp', 'hydration']},
        arms:  {label: 'Arms · strength & skin response', keys: ['grip_strength', 'emg_activity', 'eda']},
        legs:  {label: 'Legs · bone & activity',          keys: ['bone_loss_rate', 'exercise_minutes', 'steps']},
    };
    const VITALS = [
        {key: 'heart_rate', label: 'Heart rate'}, {key: 'spo2', label: 'SpO₂'}, {key: 'bp', label: 'Blood pressure'},
        {key: 'body_temp', label: 'Body temp.'}, {key: 'hydration', label: 'Hydration'}, {key: 'stress_level', label: 'Stress'},
    ];
    const SPARKS = [{key: 'heart_rate', label: 'Heart rate'}, {key: 'spo2', label: 'SpO₂'}];
    const state = {records: {}, astronauts: [], alerts: {}, online: initial.apiOnline !== false,
        selected: +initial.astroId || 1, trends: new Map(), trendsLoaded: false, frame: null};

    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
    const fmt = (v, d = 1) => S.numeric(v) ? v.toLocaleString('en-US', {maximumFractionDigits: d}) : '—';
    const pad = id => String(id).padStart(2, '0');
    const visible = () => !section.hidden && !document.hidden;
    const worst = list => list.reduce((w, s) => RANK[s] > RANK[w] ? s : w, 'none');
    const ranged = () => Object.keys(metrics).filter(k => metrics[k].range);

    function status(key, value) {
        const m = metrics[key];
        if (!m || !S.numeric(value)) return 'none';
        if (!m.range) return 'ok';
        const [okMin, okMax, critMin, critMax] = m.range;
        if (value < critMin || value > critMax) return 'crit';
        return value < okMin || value > okMax ? 'warn' : 'ok';
    }
    // 0 at the centre of the normal band, 1 at its edge: shades the heatmap within "Normal".
    function deviation(key, value) {
        const m = metrics[key];
        if (!m?.range || !S.numeric(value)) return 0;
        const [okMin, okMax] = m.range, half = (okMax - okMin) / 2;
        if (!(half > 0) || okMax >= 10000) return 0;
        return Math.min(1, Math.abs(value - (okMin + half)) / half);
    }
    // Share of measurements in range: normal = 1, attention = 0.5, critical = 0.
    function scoreOf(statuses) {
        const valid = statuses.filter(s => s !== 'none');
        if (!valid.length) return null;
        return Math.round(valid.reduce((n, s) => n + (s === 'ok' ? 1 : s === 'warn' ? 0.5 : 0), 0) / valid.length * 100);
    }
    const healthScore = r => r ? scoreOf(ranged().map(k => status(k, r[k]))) : null;
    const overall = r => r ? worst(ranged().map(k => status(k, r[k]))) : 'none';
    const scoreClass = score => score === null ? 'none' : score >= 85 ? 'ok' : score >= 60 ? 'warn' : 'crit';
    function scenarioInfo(value) {
        for (const [code, sc] of Object.entries(scenarios)) if (value === sc.name || String(value) === code) return sc;
        return null;
    }
    const activeAlerts = id => (state.alerts[id] || []).filter(a => a.type === 'warn' || a.type === 'crit');

    /* ---------- Data ---------- */
    function addTrend(id, record) {
        const t = S.timestamp(record?.recorded_at);
        if (!Number.isFinite(t)) return;
        let list = state.trends.get(id);
        if (!list) state.trends.set(id, list = []);
        const point = {t, heart_rate: record.heart_rate, spo2: record.spo2};
        if (!list.length || t > list[list.length - 1].t) { list.push(point); return; }
        let lo = 0, hi = list.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].t < t) lo = mid + 1; else hi = mid; }
        if (list[lo]?.t !== t) list.splice(lo, 0, point);
    }
    function pruneTrends() {
        const cutoff = Date.now() - WINDOW_MS;
        for (const list of state.trends.values()) {
            let i = 0;
            while (i < list.length && list[i].t < cutoff) i++;
            if (i) list.splice(0, i);
        }
    }
    function ingest(d) {
        if (Array.isArray(d.astronauts) && d.astronauts.length) state.astronauts = d.astronauts;
        if (Array.isArray(d.crewRecords)) {
            state.records = {};
            for (const r of d.crewRecords) {
                const id = +r.astronaut_id;
                if (id > 0) { state.records[id] = r; addTrend(id, r); }
            }
        }
        if (d.alertsByCrew && typeof d.alertsByCrew === 'object') state.alerts = d.alertsByCrew;
        if ('apiOnline' in d) state.online = d.apiOnline !== false;
    }
    // Seed the sparklines with the last five minutes of recorded history, once.
    async function loadTrends() {
        if (state.trendsLoaded || !state.astronauts.length) return;
        state.trendsLoaded = true;
        const start = new Date(Date.now() - WINDOW_MS).toISOString().slice(0, 19).replace('T', ' ');
        await Promise.all(state.astronauts.map(async a => {
            try {
                const response = await fetch('history.php?' + new URLSearchParams({astro: String(a.id), limit: '1000', start}), {cache: 'no-store', ...options});
                if (!response.ok) return;
                const data = await response.json();
                for (const record of Array.isArray(data.records) ? data.records : []) addTrend(a.id, record);
            } catch (_error) { /* Sparklines still fill from live readings. */ }
        }));
        if (!lifetime.signal.aborted) requestRender();
    }

    /* ---------- Rendering ---------- */
    function regionInfo(r, id) {
        const region = REGIONS[id], s = r ? worst(region.keys.map(k => status(k, r[k]))) : 'none';
        const lines = region.keys.map(k => {
            const m = metrics[k], ks = status(k, r?.[k]);
            return `${m.label}: ${fmt(r?.[k], m.digits)} ${m.unit}${ks === 'warn' || ks === 'crit' ? ' (' + STATUS[ks] + ')' : ''}`;
        });
        return {s, title: esc(`${region.label} — ${STATUS[s]}\n${lines.join('\n')}`)};
    }
    function bodySvg(r, name) {
        const g = id => regionInfo(r, id);
        const head = g('head'), lungs = g('lungs'), heart = g('heart'), core = g('core'), arms = g('arms'), legs = g('legs');
        return `<svg viewBox="0 0 140 300" role="img" aria-label="Body systems heatmap for ${esc(name)}">
<g class="bm-region ${arms.s}" data-tip="${arms.title}"><path d="M40 68 Q28 70 26 84 L18 158 Q17 168 24 169 Q31 170 32 160 L41 100 Z"/><path d="M100 68 Q112 70 114 84 L122 158 Q123 168 116 169 Q109 170 108 160 L99 100 Z"/></g>
<g class="bm-region ${legs.s}" data-tip="${legs.title}"><path d="M42 146 Q56 160 68 158 L66 276 Q66 288 56 288 Q47 288 47 278 Z"/><path d="M98 146 Q84 160 72 158 L74 276 Q74 288 84 288 Q93 288 93 278 Z"/></g>
<rect class="bm-base" x="63" y="46" width="14" height="16" rx="4"/>
<path class="bm-base" d="M44 64 Q70 56 96 64 Q104 68 104 80 L100 152 Q70 166 40 152 L36 80 Q36 68 44 64 Z"/>
<g class="bm-region ${head.s}" data-tip="${head.title}"><circle cx="70" cy="30" r="20"/></g>
<g class="bm-region ${lungs.s}" data-tip="${lungs.title}"><ellipse cx="56" cy="92" rx="12" ry="20"/><ellipse cx="84" cy="92" rx="12" ry="20"/></g>
<g class="bm-region ${core.s}" data-tip="${core.title}"><ellipse cx="70" cy="134" rx="22" ry="13"/></g>
<g class="bm-region ${heart.s}" data-tip="${heart.title}"><path d="M72 100 C69 95 61 96 62 103 C63 109 72 114 72 114 C72 114 81 109 82 103 C83 96 75 95 72 100 Z"/></g>
</svg>`;
    }
    function ringSvg(score) {
        const c = 2 * Math.PI * 30, pct = score ?? 0;
        return `<div class="score-ring ${scoreClass(score)}"><svg viewBox="0 0 80 80" aria-hidden="true"><circle class="ring-bg" cx="40" cy="40" r="30"/><circle class="ring-fg" cx="40" cy="40" r="30" stroke-dasharray="${(c * pct / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 40 40)"/></svg><div class="score-ring-text"><strong>${score === null ? '—' : score + '%'}</strong></div><span class="score-ring-label">Health index</span></div>`;
    }
    function systemBar(r, group) {
        const statuses = Object.keys(metrics).filter(k => metrics[k].group === group && metrics[k].range).map(k => status(k, r?.[k]));
        const valid = statuses.filter(s => s !== 'none'), score = scoreOf(valid), cls = valid.length ? worst(valid) : 'none';
        const crit = valid.filter(s => s === 'crit').length, warn = valid.filter(s => s === 'warn').length;
        const note = !valid.length ? 'No data' : crit ? `${crit} critical` : warn ? `${warn} attention` : 'In range';
        return `<li class="system-bar ${cls}"><div class="system-bar-top"><span>${esc(groups[group] || group)}</span><b>${note}</b></div><div class="system-bar-track"><span style="width:${score ?? 0}%"></span></div></li>`;
    }
    function vitalHtml(r, v) {
        if (v.key === 'bp') {
            const s = worst([status('bp_systolic', r?.bp_systolic), status('bp_diastolic', r?.bp_diastolic)]);
            const value = S.numeric(r?.bp_systolic) ? `${fmt(r.bp_systolic, 0)}/${fmt(r.bp_diastolic, 0)}` : '—';
            return `<div class="vital ${s}"><span>${v.label}</span><strong>${value}</strong><small>mmHg</small></div>`;
        }
        const m = metrics[v.key], value = r?.[v.key];
        return `<div class="vital ${status(v.key, value)}"><span>${v.label}</span><strong>${fmt(value, m.digits)}</strong><small>${esc(m.unit)}</small></div>`;
    }
    function sparkHtml(id, spark) {
        const m = metrics[spark.key], points = (state.trends.get(id) || []).filter(p => S.numeric(p[spark.key]));
        const head = extra => `<div class="spark-head"><span>${spark.label}</span><small>${extra}</small></div>`;
        if (points.length < 2) return `<div class="spark none">${head('Last 5 min')}<p class="spark-empty">Collecting trend…</p></div>`;
        const pts = points.length > 300 ? S.downsample(points.map(p => ({x: p.t, y: p[spark.key]})), 300).map(p => ({t: p.x, v: p.y}))
            : points.map(p => ({t: p.t, v: p[spark.key]}));
        const values = pts.map(p => p.v), min = Math.min(...values), max = Math.max(...values), last = values[values.length - 1];
        let lo = min, hi = max;
        if (m.range) { lo = Math.min(lo, m.range[0]); hi = Math.max(hi, m.range[1]); }
        if (hi === lo) { hi += 1; lo -= 1; }
        const W = 200, H = 46, t0 = pts[0].t, t1 = pts[pts.length - 1].t;
        const x = t => (t - t0) / Math.max(1, t1 - t0) * W, y = v => H - 3 - (v - lo) / (hi - lo) * (H - 6);
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
        const band = m.range ? `<rect class="spark-band" x="0" width="${W}" y="${y(m.range[1]).toFixed(1)}" height="${Math.max(0, y(m.range[0]) - y(m.range[1])).toFixed(1)}"/>` : '';
        return `<div class="spark ${status(spark.key, last)}">${head(`${fmt(min, m.digits)}–${fmt(max, m.digits)} ${esc(m.unit)} · 5 min`)}<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${band}<path class="spark-line" d="${d}"/><circle class="spark-dot" cx="${x(t1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3"/></svg></div>`;
    }
    function cardHtml(a) {
        const r = state.records[a.id] || null, ov = overall(r), sc = scenarioInfo(r?.scenario), alerts = activeAlerts(a.id);
        const critAlerts = alerts.filter(x => x.type === 'crit').length;
        const portrait = a.portrait ? `<img class="crew-portrait" src="portraits/${a.id}.jpg" width="48" height="48" alt="">`
            : `<span class="crew-portrait" aria-hidden="true">${pad(a.id)}</span>`;
        const alertText = alerts.length ? `${alerts.length} active alert${alerts.length > 1 ? 's' : ''}` : 'No active alerts';
        const alertTitle = alerts.map(x => `${x.category}: ${x.message}`).join('\n');
        return `<article class="crew-card ${ov}${a.id === state.selected ? ' selected' : ''}" data-crew="${a.id}">
<header class="crew-card-head">${portrait}<div class="crew-card-title"><h3>${esc(a.name)}</h3><p>Astronaut ${pad(a.id)}${sc ? ` <span class="chip ${esc(sc.chip)}">${esc(sc.label)}</span>` : ''}</p></div><span class="chip ${ov}">${STATUS[ov]}</span></header>
<div class="crew-card-body"><figure class="body-map">${bodySvg(r, a.name)}<figcaption>Hover a region for details</figcaption></figure>
<div class="crew-card-side">${ringSvg(healthScore(r))}<ul class="system-bars">${BODY_SYSTEMS.map(g => systemBar(r, g)).join('')}</ul></div></div>
<div class="vital-strip">${VITALS.map(v => vitalHtml(r, v)).join('')}</div>
<div class="spark-row">${SPARKS.map(s => sparkHtml(a.id, s)).join('')}</div>
<footer class="crew-card-foot"><span class="${critAlerts ? 'crit' : alerts.length ? 'warn' : 'muted'}"${alertTitle ? ` data-tip="${esc(alertTitle)}"` : ''}>${alertText}</span><button type="button" class="button secondary" data-open-crew="${a.id}">Open data view</button></footer>
</article>`;
    }
    function summaryHtml(crew) {
        const counts = {ok: 0, warn: 0, crit: 0, none: 0};
        crew.forEach(a => counts[overall(state.records[a.id])]++);
        const scores = crew.map(a => healthScore(state.records[a.id])).filter(s => s !== null);
        const avg = scores.length ? Math.round(scores.reduce((n, s) => n + s, 0) / scores.length) : null;
        const alerts = crew.flatMap(a => activeAlerts(a.id)), crit = alerts.filter(x => x.type === 'crit').length;
        const records = crew.map(a => state.records[a.id]).filter(Boolean);
        const mean = key => { const v = records.map(r => r[key]).filter(S.numeric); return v.length ? v.reduce((n, x) => n + x, 0) / v.length : null; };
        const seg = s => counts[s] ? `<span class="${s}" style="flex:${counts[s]}" data-tip="${counts[s]} · ${STATUS[s]}"></span>` : '';
        return `<div class="general-summary">
<article class="gs-card"><span class="gs-label">Crew status</span><div class="gs-stack">${seg('ok')}${seg('warn')}${seg('crit')}${seg('none')}</div><p class="gs-legend"><b class="ok">${counts.ok}</b> normal · <b class="warn">${counts.warn}</b> attention · <b class="crit">${counts.crit}</b> critical</p></article>
<article class="gs-card"><span class="gs-label">Crew health index</span><strong class="gs-big ${scoreClass(avg)}">${avg === null ? '—' : avg + '%'}</strong><p class="gs-note">Average share of measurements in range</p></article>
<article class="gs-card"><span class="gs-label">Active alerts</span><strong class="gs-big ${crit ? 'crit' : alerts.length ? 'warn' : 'ok'}">${alerts.length}</strong><p class="gs-note">${crit} critical · ${alerts.length - crit} warning · whole crew</p></article>
<article class="gs-card"><span class="gs-label">Cabin · crew average</span><dl class="gs-cabin"><div><dt>O₂</dt><dd>${fmt(mean('cabin_o2'), 1)} %</dd></div><div><dt>CO₂</dt><dd>${fmt(mean('cabin_co2'), 2)} mmHg</dd></div><div><dt>Pressure</dt><dd>${fmt(mean('cabin_pressure'), 1)} kPa</dd></div><div><dt>Radiation</dt><dd>${fmt(mean('radiation'), 2)} mSv/d</dd></div></dl></article>
</div>`;
    }
    function heatmapHtml(crew) {
        const head = crew.map(a => `<th scope="col"><button type="button" class="heat-crew" data-open-crew="${a.id}" data-tip="Open ${esc(a.name)} in data view">${esc(a.name)}</button></th>`).join('');
        let rows = '';
        for (const [group, label] of Object.entries(groups)) {
            const keys = Object.keys(metrics).filter(k => metrics[k].group === group);
            if (!keys.length) continue;
            rows += `<tr class="heat-group"><th scope="rowgroup" colspan="${crew.length + 1}">${esc(label)}</th></tr>`;
            for (const k of keys) {
                const m = metrics[k];
                const cells = crew.map(a => {
                    const v = state.records[a.id]?.[k], s = status(k, v);
                    const cls = !S.numeric(v) ? 'none' : m.range ? s : 'neutral';
                    const dev = cls === 'ok' ? deviation(k, v) : 0;
                    const tip = `${a.name} · ${m.label}: ${fmt(v, m.digits)} ${m.unit} (${m.range ? STATUS[s] : 'no reference range'})`;
                    return `<td class="heat ${cls}" style="--dev:${dev.toFixed(2)}" data-tip="${esc(tip)}">${fmt(v, m.digits)}</td>`;
                }).join('');
                rows += `<tr><th scope="row">${esc(m.label)} <small>${esc(m.unit)}</small></th>${cells}</tr>`;
            }
        }
        return `<section class="panel crew-heatmap-panel"><header class="panel-head"><span class="panel-icon bio">▦</span><h2>Crew comparison heatmap</h2><span class="panel-tag">All 26 measurements</span></header>
<div class="heat-legend"><span><i class="heat ok" style="--dev:0"></i>Centre of normal range</span><span><i class="heat ok" style="--dev:1"></i>Edge of normal range</span><span><i class="heat warn"></i>Attention</span><span><i class="heat crit"></i>Critical</span><span><i class="heat neutral"></i>No reference range</span></div>
<div class="table-scroll"><table class="crew-heatmap"><thead><tr><th scope="col">Measurement</th>${head}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }

    /* ---------- DOM update without losing hover state ---------- */
    function morph(from, to) {
        if (from.nodeType !== to.nodeType || from.nodeName !== to.nodeName) { from.replaceWith(to); return; }
        if (from.nodeType !== Node.ELEMENT_NODE) { if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue; return; }
        for (const a of [...from.attributes]) if (!to.hasAttribute(a.name)) from.removeAttribute(a.name);
        for (const a of [...to.attributes]) if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
        if (from.childNodes.length !== to.childNodes.length) { from.replaceChildren(...to.childNodes); return; }
        const old = [...from.childNodes], fresh = [...to.childNodes];
        old.forEach((node, i) => morph(node, fresh[i]));
    }
    let lastHtml = '';
    function update(html) {
        if (html === lastHtml) return;
        lastHtml = html;
        const box = document.createElement('div');
        box.innerHTML = html;
        if (host.childNodes.length !== box.childNodes.length) { host.replaceChildren(...box.childNodes); return; }
        const old = [...host.childNodes], fresh = [...box.childNodes];
        old.forEach((node, i) => morph(node, fresh[i]));
    }
    function render() {
        state.frame = null;
        if (!visible()) return;
        pruneTrends();
        const crew = state.astronauts.length ? state.astronauts
            : Object.keys(state.records).map(id => ({id: +id, name: `Astronaut ${id}`, portrait: false}));
        if (!crew.length) {
            update(`<p class="chart-empty">${state.online ? 'Waiting for crew telemetry…' : 'Telemetry is offline. The crew overview appears when readings arrive.'}</p>`);
            return;
        }
        update(summaryHtml(crew) + `<div class="crew-grid">${crew.map(cardHtml).join('')}</div>` + heatmapHtml(crew));
        refreshTip();
    }
    function requestRender() { if (state.frame === null) state.frame = requestAnimationFrame(render); }

    /* ---------- Steady tooltip ----------
       Native title tooltips close whenever their text changes (every second here),
       so one custom tooltip follows the pointer and only its text is refreshed. */
    const tip = document.createElement('div');
    tip.className = 'hermes-tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.append(tip);
    const pointer = {x: 0, y: 0, target: null};
    function placeTip() {
        const gap = 14, w = tip.offsetWidth, h = tip.offsetHeight;
        let x = pointer.x + gap, y = pointer.y + gap;
        if (x + w > innerWidth - 8) x = pointer.x - w - gap;
        if (y + h > innerHeight - 8) y = pointer.y - h - gap;
        tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
    }
    function refreshTip() {
        if (!pointer.target) return;
        // After a refresh the hovered node normally survives; if not, find what is under the pointer now.
        if (!pointer.target.isConnected) pointer.target = document.elementFromPoint(pointer.x, pointer.y)?.closest('#general-view [data-tip]') || null;
        const text = pointer.target?.getAttribute('data-tip');
        if (!text) { tip.hidden = true; return; }
        if (tip.textContent !== text) tip.textContent = text;
        tip.hidden = false;
        placeTip();
    }
    host.addEventListener('pointermove', ev => {
        pointer.x = ev.clientX; pointer.y = ev.clientY;
        pointer.target = ev.target.closest?.('[data-tip]') || null;
        refreshTip();
    });
    host.addEventListener('pointerleave', () => { pointer.target = null; tip.hidden = true; });
    // While scrolling, show the tooltip of whatever is now under the pointer.
    window.addEventListener('scroll', () => {
        if (tip.hidden && !pointer.target) return;
        pointer.target = document.elementFromPoint(pointer.x, pointer.y)?.closest('#general-view [data-tip]') || null;
        refreshTip();
    }, {passive: true, ...options});

    host.addEventListener('click', ev => {
        const button = ev.target.closest('[data-open-crew]');
        if (!button) return;
        const id = +button.dataset.openCrew;
        if (id !== state.selected) document.querySelector(`#crew-form .crew-button[value="${id}"]`)?.click();
        document.querySelector('[data-view="data"]')?.click();
        window.scrollTo({top: 0, behavior: 'smooth'});
    });
    document.addEventListener('hermes:telemetry', ev => { ingest(ev.detail || {}); if (visible()) { loadTrends(); requestRender(); } }, options);
    document.addEventListener('hermes:view', ev => {
        if (ev.detail?.view === 'general') { loadTrends(); requestRender(); }
        else { pointer.target = null; tip.hidden = true; }
    }, options);
    document.addEventListener('hermes:crew', ev => { state.selected = +ev.detail.astroId || state.selected; requestRender(); }, options);
    document.addEventListener('visibilitychange', () => { if (visible()) requestRender(); }, options);
    ingest(initial);
    if (visible()) { loadTrends(); requestRender(); }
    return () => {
        lifetime.abort();
        if (state.frame !== null) cancelAnimationFrame(state.frame);
        tip.remove();
    };
}
})();
