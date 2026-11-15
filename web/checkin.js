/* Hermes health check-in: crew and individual summaries, and the mental and ocular screening flow. */
(() => {
    let mounted = false;
    function openCheckin() {
        const root = document.getElementById('checkin-page');
        if (!root || mounted) return;
        mounted = true;
        mount(root);
    }
    document.addEventListener('DOMContentLoaded', openCheckin);
    document.addEventListener('hermes:section', openCheckin);

function mount(root) {
    'use strict';
    const $ = id => root.querySelector('#' + id);
    const boot = JSON.parse(document.getElementById('hermes-bootstrap').textContent);
    const API = 'checkin_api.php';
    const SLIDERS = [
        ['energy_level', 'Energy', 'Depleted', 'Peak'],
        ['stress_tension', 'Stress', 'Calm', 'High'],
        ['crew_cohesion', 'Crew sync', 'Isolated', 'Cohesive'],
        ['sleep_quality', 'Sleep quality', 'Restless', 'Restorative'],
    ];
    const SYMPTOMS = [['none', 'None'], ['headache', 'Headache'], ['eye_pressure', 'Eye pressure'],
        ['flashes_or_floaters', 'Flashes or floaters'], ['double_vision', 'Double vision']];
    const SYMPTOM_LABEL = Object.fromEntries(SYMPTOMS);
    const STATUS = { NOMINAL: ['ok', 'Nominal'], AMBER_REVIEW: ['warn', 'Amber review'], RED_ALERT: ['crit', 'Red alert'] };
    const RANK = { NOMINAL: 0, AMBER_REVIEW: 1, RED_ALERT: 2 };
    const EYES = [['left', 'left_eye'], ['right', 'right_eye']];
    const PVT_TRIALS = 5, GRID = 20, QUEUE = 'hermes-checkin-queue', CAL = 'hermes-screen-px-per-mm';
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const chip = status => { const [cls, label] = STATUS[status] || STATUS.NOMINAL; return `<span class="chip ${cls}">${label}</span>`; };
    const snellen = l => '20/' + Math.round(20 * Math.pow(10, l));
    const signed = (n, digits = 0) => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(digits);
    const mean = list => list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
    const crewList = () => boot.astronauts || [];
    const crewName = id => (crewList().find(a => a.id === id) || {}).name || 'Astronaut ' + id;

    let astro = +boot.astroId || 1, S, timer = null, store = { checkins: [], serverTime: null, missionDay: null, loaded: false }, view = 'summary';

    /* =====================================================================
       Data: load, queue, sample history, export
       ===================================================================== */
    async function request(action, body) {
        const response = await fetch(`${API}?action=${action}`, body === undefined ? { cache: 'no-store' }
            : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) { const error = new Error(data.error || `The server answered HTTP ${response.status}.`); error.status = response.status; throw error; }
        return data;
    }
    const queue = () => { try { return JSON.parse(localStorage.getItem(QUEUE)) || []; } catch (_e) { return []; } };
    function setQueue(items) {
        try { if (items.length) localStorage.setItem(QUEUE, JSON.stringify(items)); else localStorage.removeItem(QUEUE); return true; }
        catch (_e) { return false; }
    }
    function syncLabel(text) {
        const waiting = queue().length;
        $('ck-sync').textContent = text || (waiting ? `${waiting} check-in${waiting === 1 ? '' : 's'} waiting to be sent` : '');
    }
    async function flushQueue() {
        let items = queue(); if (!items.length) return;
        while (items.length) {
            try { await request('submit', items[0]); }
            catch (error) { if (!error.status || error.status === 503) break; }   // still offline: keep; rejected: drop
            items = items.slice(1); setQueue(items);
        }
        syncLabel();
    }
    async function loadStore() {
        try {
            await flushQueue();
            const data = await request('list');
            store = { checkins: data.checkins || [], serverTime: Date.parse(data.server_time) || Date.now(), missionDay: data.mission_day, loaded: true, error: null };
        } catch (error) { store.error = error.message; store.loaded = true; }
        $('ck-export').disabled = $('ck-clear').disabled = !store.checkins.length;
        renderSummary(); baselineInfo();
    }
    const historyOf = id => store.checkins.filter(c => c.astronaut_id === id);     // newest first
    const baselineOf = id => historyOf(id).find(c => c.is_baseline) || null;

    function sampleHistory() {
        const now = Date.now(), ids = crewList().map(a => a.id), out = [];
        const steady = [-0.06, 0.03, -0.02, 0.07, -0.02], lapse = [-0.1, -0.12, 0.5, -0.14, -0.14];
        ids.forEach((id, index) => {
            const profile = index % 3, rtBase = [265, 290, 250][profile];
            for (let day = 4; day >= 0; day--) {
                const step = 4 - day;                       // 0 (oldest, becomes the baseline) … 4 (latest)
                let sliders = { energy_level: 7 + (step % 2), stress_tension: 3 + (step % 2), crew_cohesion: 8, sleep_quality: 7 };
                let rt = rtBase * (1 + [0, 0.02, -0.01, 0.03, 0.01][step]), offsets = steady;
                const eye = (cells, blur, acuity) => ({ amsler_distorted_cells: cells, blur_or_scotoma_cells: blur, acuity_logmar: acuity });
                let left = eye([], [], profile === 2 ? 0.1 : 0), right = eye([], [], 0.1), symptoms = ['none'];
                if (profile === 1) {                         // mental load building up over the week
                    sliders = { energy_level: [7, 6, 6, 5, 4][step], stress_tension: [4, 5, 6, 7, 8][step], crew_cohesion: [8, 8, 7, 7, 6][step], sleep_quality: [7, 6, 5, 4, 4][step] };
                    rt = rtBase * (1 + [0, 0.04, 0.09, 0.13, 0.19][step]); if (step === 4) offsets = lapse;
                }
                if (profile === 2 && step >= 3) {            // a small area of grid distortion appears in the right eye
                    const cells = step === 3 ? ['8,12', '8,13'] : ['7,12', '8,12', '8,13', '9,13'];
                    right = eye(cells, step === 4 ? ['8,13'] : [], step === 4 ? 0.2 : 0.1);
                    if (step === 4) symptoms = ['eye_pressure'];
                }
                out.push({ astronaut_id: String(id), demo: true, timestamp_utc: new Date(now - day * 86400000 - 3600000 - index * 1500000).toISOString(),
                    psych_data: { sliders, pvt: { trials: offsets.map(o => Math.round(rt * (1 + o))), false_starts: step === 2 ? 1 : 0 } },
                    ocular_data: { left_eye: left, right_eye: right, symptoms, acuity_calibrated: false } });
            }
        });
        return out.sort((a, b) => a.timestamp_utc < b.timestamp_utc ? -1 : 1);
    }
    async function loadSample(button) {
        button.disabled = true; button.textContent = 'Loading sample history…';
        try { for (const record of sampleHistory()) await request('submit', record); }
        catch (error) { syncLabel('Sample history failed: ' + error.message); }
        await loadStore();
    }
    function exportCsv() {
        const head = ['id', 'astronaut_id', 'crew_member', 'timestamp_utc', 'mission_day', 'sample_data', 'is_baseline', 'flag_status', 'mental_status', 'ocular_status',
            'energy_level', 'stress_tension', 'crew_cohesion', 'sleep_quality', 'wellbeing_index', 'pvt_mean_rt_ms', 'pvt_median_rt_ms', 'pvt_false_starts', 'pvt_lapses',
            'pvt_change_pct', 'acuity_logmar_left', 'acuity_logmar_right', 'amsler_cells_left', 'amsler_cells_right', 'scotoma_cells_left', 'scotoma_cells_right',
            'symptoms', 'voice_note', 'findings'];
        const rows = store.checkins.map(c => {
            const p = c.psych_data, o = c.ocular_data, a = c.assessment, s = p.sliders, pvt = p.pvt || {};
            return [c.id, c.astronaut_id, crewName(c.astronaut_id), c.timestamp_utc, c.mission_day, c.demo ? 'yes' : 'no', c.is_baseline ? 'yes' : 'no',
                a.flag_status, a.mental.status, a.ocular.status, s.energy_level, s.stress_tension, s.crew_cohesion, s.sleep_quality, p.wellbeing_index,
                pvt.mean_rt_ms, pvt.median_rt_ms, pvt.false_starts, pvt.lapses, a.deltas.pvt_pct, o.left_eye.acuity_logmar, o.right_eye.acuity_logmar,
                o.left_eye.amsler_distorted_cells.length, o.right_eye.amsler_distorted_cells.length, o.left_eye.blur_or_scotoma_cells.length,
                o.right_eye.blur_or_scotoma_cells.length, o.symptoms.join(' '), p.audio_file ? 'yes' : 'no', [...a.mental.reasons, ...a.ocular.reasons].join(' ')];
        });
        const cell = v => { const t = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : /^[=+\-@]/.test(t) && isNaN(Number(t)) ? "'" + t : t; };
        const blob = new Blob(['﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'hermes-checkins.csv';
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
    $('ck-export').addEventListener('click', exportCsv);
    let clearArmed = null;
    $('ck-clear').addEventListener('click', async () => {
        const button = $('ck-clear');
        if (!clearArmed) {                                   // two clicks instead of a blocking browser dialog
            button.textContent = 'Click again to delete all check-ins';
            clearArmed = setTimeout(() => { clearArmed = null; button.textContent = 'Clear check-ins'; }, 4000); return;
        }
        clearTimeout(clearArmed); clearArmed = null; button.textContent = 'Clear check-ins';
        try { await request('clear', { confirm: true }); } catch (error) { syncLabel(error.message); }
        await loadStore();
    });

    /* =====================================================================
       Summary: crew overview, then one section per crew member
       ===================================================================== */
    function ago(iso) {
        const minutes = Math.max(0, Math.round(((store.serverTime || Date.now()) - Date.parse(iso)) / 60000));
        if (minutes < 1) return 'just now';
        if (minutes < 60) return minutes + ' min ago';
        const hours = Math.round(minutes / 60);
        return hours < 36 ? hours + ' h ago' : Math.round(hours / 24) + ' days ago';
    }
    function bar(label, value, bad, max = 10) {
        const shown = value === null ? '—' : Number.isInteger(value) ? value : value.toFixed(1);
        return `<div class="ck-bar${bad ? ' warn' : ''}"><span>${esc(label)}</span><div class="bar" role="img" aria-label="${esc(label)} ${shown} out of ${max}"><span style="width:${value === null ? 0 : value / max * 100}%"></span></div><strong>${shown}</strong></div>`;
    }
    const sliderBad = (key, v) => v !== null && (key === 'stress_tension' ? v >= 8 : v <= 3);
    function sparkline(values, label) {
        if (values.length < 2) return '';
        const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1, w = 160, h = 36;
        const pts = values.map((v, i) => [4 + i * (w - 8) / (values.length - 1), h - 5 - (v - lo) / span * (h - 10)]);
        return `<figure class="ck-spark"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}: ${values.map(v => Math.round(v)).join(', ')}">
            <polyline points="${pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}"/>${pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i === pts.length - 1 ? 3.2 : 1.8}"/>`).join('')}
            </svg><figcaption>${esc(label)} · ${Math.round(values[0])} → ${Math.round(values[values.length - 1])} ms</figcaption></figure>`;
    }
    function amslerSvg(eye, label) {
        const blur = new Set(eye.blur_or_scotoma_cells);
        const cells = eye.amsler_distorted_cells.map(key => { const [r, c] = key.split(',').map(Number); return `<rect x="${c}" y="${r}" width="1" height="1" class="${blur.has(key) ? 's' : 'd'}"/>`; }).join('');
        let lines = ''; for (let i = 1; i < GRID; i++) lines += `<path d="M${i} 0V20M0 ${i}H20"/>`;
        return `<svg class="ck-mini-grid" viewBox="0 0 20 20" role="img" aria-label="${esc(label)}: ${eye.amsler_distorted_cells.length} of 400 squares marked"><rect width="20" height="20" class="bg"/>${cells}<g>${lines}</g><circle cx="10" cy="10" r=".55"/><rect width="20" height="20" class="frame"/></svg>`;
    }
    const reasons = list => list.length ? `<ul class="ck-reasons">${list.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : '<p class="ck-clear-note">No findings.</p>';
    function mentalBlock(c, history) {
        const p = c.psych_data, a = c.assessment, pct = a.deltas.pvt_pct;
        const rts = history.slice(0, 7).filter(h => h.psych_data.pvt).map(h => h.psych_data.pvt.mean_rt_ms).reverse();
        return `<section class="ck-block mental" aria-label="Mental health"><header><h4>Mental</h4>${chip(a.mental.status)}</header>
            <div class="ck-score"><strong>${p.wellbeing_index}</strong><span>wellbeing index<br>out of 100</span></div>
            ${SLIDERS.map(([key, label]) => bar(label, p.sliders[key], sliderBad(key, p.sliders[key]))).join('')}
            ${p.pvt ? `<div class="ck-line"><span>Reaction time</span><strong>${Math.round(p.pvt.mean_rt_ms)} ms</strong>${pct === null ? '' : `<em class="${pct >= 15 ? 'bad' : ''}">${signed(pct)}% vs baseline</em>`}</div>
            <div class="ck-line"><span>False starts · lapses</span><strong>${p.pvt.false_starts} · ${p.pvt.lapses}</strong></div>` : '<div class="ck-line"><span>Reaction time</span><strong>Not done</strong></div>'}
            ${sparkline(rts, 'Reaction time, last ' + rts.length + ' check-ins')}
            ${reasons(a.mental.reasons)}</section>`;
    }
    function ocularBlock(c) {
        const o = c.ocular_data, a = c.assessment, symptoms = o.symptoms.filter(s => s !== 'none');
        const eyes = EYES.map(([side, key]) => {
            const e = o[key], d = a.deltas['acuity_' + side], fresh = a.deltas['new_cells_' + side], n = e.amsler_distorted_cells.length;
            return `<div class="ck-eyecard"><span>${side === 'left' ? 'Left' : 'Right'} eye</span>${amslerSvg(e, side + ' eye grid')}
                <strong>${e.acuity_logmar === null ? 'Not tested' : e.acuity_logmar.toFixed(1) + ' logMAR'}</strong>
                <small>${e.acuity_logmar === null ? 'Sharpness' : 'about ' + snellen(e.acuity_logmar) + (d === null ? '' : ` · <em class="${d >= 0.2 ? 'bad' : ''}">${signed(d, 1)}</em>`)}</small>
                <small>${n} square${n === 1 ? '' : 's'} marked${fresh ? ` · <em class="bad">${fresh} new</em>` : ''}</small></div>`;
        }).join('');
        return `<section class="ck-block ocular" aria-label="Ocular health"><header><h4>Ocular</h4>${chip(a.ocular.status)}</header>
            <div class="ck-eyes">${eyes}</div>
            <div class="ck-line"><span>Symptoms</span><strong>${symptoms.length ? symptoms.map(s => esc(SYMPTOM_LABEL[s] || s)).join(', ') : 'None'}</strong></div>
            <div class="ck-line"><span>Screen</span><strong>${o.acuity_calibrated ? 'Calibrated' : 'Not calibrated'} · ${o.viewing_distance_cm} cm</strong></div>
            ${reasons(a.ocular.reasons)}</section>`;
    }
    function personCard(member) {
        const history = historyOf(member.id), c = history[0];
        const portrait = member.portrait ? `<img class="crew-portrait" src="portraits/${member.id}.jpg" width="48" height="48" alt="">`
            : `<span class="crew-portrait" aria-hidden="true">${String(member.id).padStart(2, '0')}</span>`;
        const start = `<button type="button" class="button secondary" data-start="${member.id}">Start check-in</button>`;
        if (!c) return `<article class="panel ck-person" aria-label="${esc(member.name)}"><header class="ck-person-head">${portrait}<div><h3>${esc(member.name)}</h3><p>No check-in recorded yet</p></div><span class="chip">Pending</span></header>
            <footer class="ck-person-foot"><span></span>${start}</footer></article>`;
        const tags = [c.is_baseline ? 'Baseline' : '', c.demo ? 'Sample data' : ''].filter(Boolean).map(t => `<span class="panel-tag">${t}</span>`).join(' ');
        const audio = c.psych_data.audio_file ? `<audio controls preload="none" src="${API}?action=audio&id=${esc(c.id)}" aria-label="Voice note"></audio>` : '<span></span>';
        return `<article class="panel ck-person" aria-label="${esc(member.name)}"><header class="ck-person-head">${portrait}
            <div><h3>${esc(member.name)}</h3><p>Mission day ${c.mission_day} · ${esc(c.timestamp_utc.slice(0, 16).replace('T', ' '))} UTC · ${ago(c.timestamp_utc)} · ${history.length} check-in${history.length === 1 ? '' : 's'} ${tags}</p></div>
            ${chip(c.assessment.flag_status)}</header>
            <div class="ck-blocks">${mentalBlock(c, history)}${ocularBlock(c)}</div>
            <footer class="ck-person-foot">${audio}${start}</footer></article>`;
    }
    function crewOverview(latest) {
        const worst = domain => latest.reduce((w, c) => RANK[c.assessment[domain].status] > RANK[w] ? c.assessment[domain].status : w, 'NOMINAL');
        const flagged = domain => latest.filter(c => c.assessment[domain].status !== 'NOMINAL').length;
        const avg = pick => mean(latest.map(pick).filter(v => v !== null && v !== undefined));
        const rt = avg(c => c.psych_data.pvt ? c.psych_data.pvt.mean_rt_ms : null), wellbeing = avg(c => c.psych_data.wellbeing_index);
        const acuities = latest.flatMap(c => EYES.map(([, k]) => c.ocular_data[k].acuity_logmar)).filter(v => v !== null), acuity = mean(acuities);
        const eyes = latest.length * 2, distorted = latest.reduce((n, c) => n + EYES.filter(([, k]) => c.ocular_data[k].amsler_distorted_cells.length).length, 0);
        const counts = {}; latest.forEach(c => c.ocular_data.symptoms.filter(s => s !== 'none').forEach(s => { counts[s] = (counts[s] || 0) + 1; }));
        const symptomText = Object.keys(counts).length ? Object.entries(counts).map(([s, n]) => `${esc(SYMPTOM_LABEL[s] || s)} (${n})`).join(', ') : 'None reported';
        const kpi = (label, value, note, bad) => `<div class="ck-kpi${bad ? ' bad' : ''}"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`;
        return `<div class="ck-domains">
        <article class="panel ck-domain mental" aria-label="Crew mental health"><header class="panel-head"><span class="panel-icon bio" aria-hidden="true">◉</span><h2>Mental health</h2>${chip(worst('mental'))}</header>
            <div class="ck-kpis">${kpi('Wellbeing index', wellbeing === null ? '—' : Math.round(wellbeing), 'crew average, out of 100')}
                ${kpi('Reaction time', rt === null ? '—' : Math.round(rt) + ' ms', 'crew average')}
                ${kpi('Flagged', `${flagged('mental')} of ${latest.length}`, 'crew members', flagged('mental') > 0)}</div>
            ${SLIDERS.map(([key, label]) => { const v = avg(c => c.psych_data.sliders[key]); return bar(label, v === null ? null : Math.round(v * 10) / 10, sliderBad(key, v)); }).join('')}
        </article>
        <article class="panel ck-domain ocular" aria-label="Crew ocular health"><header class="panel-head"><span class="panel-icon env" aria-hidden="true">◎</span><h2>Ocular health</h2>${chip(worst('ocular'))}</header>
            <div class="ck-kpis">${kpi('Sharpness', acuity === null ? '—' : acuity.toFixed(2), acuity === null ? 'no eyes tested' : `logMAR average, about ${snellen(acuity)}`)}
                ${kpi('Grid distortion', `${distorted} of ${eyes}`, 'eyes with marked squares', distorted > 0)}
                ${kpi('Flagged', `${flagged('ocular')} of ${latest.length}`, 'crew members', flagged('ocular') > 0)}</div>
            <div class="ck-line"><span>Symptoms</span><strong>${symptomText}</strong></div>
            <div class="ck-line"><span>Eyes tested for sharpness</span><strong>${acuities.length} of ${eyes}</strong></div>
        </article></div>`;
    }
    function renderSummary() {
        const box = $('ck-summary');
        if (!store.loaded) return;
        if (store.error && !store.checkins.length) { box.innerHTML = `<p class="notice">${esc(store.error)}</p>`; return; }
        const crew = crewList(), latest = crew.map(a => historyOf(a.id)[0]).filter(Boolean);
        const recent = latest.filter(c => (store.serverTime - Date.parse(c.timestamp_utc)) < 86400000).length;
        const head = `<div class="section-heading"><h2>Crew overview</h2><p class="muted">Mission day ${store.missionDay ?? '—'} · ${recent} of ${crew.length} checked in during the last 24 hours</p></div>`;
        const empty = `<div class="chart-empty ck-empty"><p><strong>No check-ins have been recorded yet.</strong></p><p>Start a check-in, or load five days of sample history to explore the summary.</p>
            <div class="ck-actions"><button type="button" class="button" data-ck-view="checkin">Start a check-in</button><button type="button" class="button secondary" id="ck-sample">Load sample history</button></div></div>`;
        box.innerHTML = head + (latest.length ? crewOverview(latest) : empty)
            + `<div class="section-heading"><h2>Individual crew members</h2><p class="muted">Latest check-in of each person, compared with their own baseline</p></div>`
            + `<div class="ck-people">${crew.map(personCard).join('')}</div>`;
    }
    $('ck-summary').addEventListener('click', ev => {
        const start = ev.target.closest('[data-start]');
        if (start) {
            const id = +start.dataset.start;
            if (id !== astro) document.querySelector(`.crew-button[value="${id}"]`)?.click();
            setView('checkin'); return;
        }
        if (ev.target.id === 'ck-sample') loadSample(ev.target);
    });
    function setView(next) {
        view = next;
        $('ck-summary').hidden = next !== 'summary'; $('ck-flow').hidden = next !== 'checkin';
        document.querySelectorAll('.control-bar [data-ck-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ckView === next)));
        if (next === 'summary') loadStore(); else { restart(); }
        window.scrollTo({ top: 0 });
    }
    root.addEventListener('click', ev => { const b = ev.target.closest('[data-ck-view]'); if (b) setView(b.dataset.ckView); });
    setInterval(() => { if (root.isConnected && view === 'summary' && !document.hidden) loadStore(); }, 20000);
    window.addEventListener('online', flushQueue);

    /* =====================================================================
       Check-in flow
       ===================================================================== */
    const freshEye = () => ({ cells: new Map(), logmar: null });
    function fresh() {
        return { sliders: Object.fromEntries(SLIDERS.map(s => [s[0], 5])), pvt: null, audio: null, eye: 'left', brush: 'd',
            eyes: { left: freshEye(), right: freshEye() }, symptoms: new Set(['none']), started: null };
    }
    function go(step) {
        for (const n of [1, 2, 3]) $('ck-step-' + n).hidden = n !== step;
        document.querySelectorAll('[data-step]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.step === step)));
        if (step === 2) { drawAmsler(); drawE(); calSync(); }
        if (step === 3) review();
        window.scrollTo({ top: Math.max(0, $('ck-flow').getBoundingClientRect().top + window.scrollY - 90) });
    }
    document.querySelectorAll('[data-step],[data-go]').forEach(b => b.addEventListener('click', () => go(+(b.dataset.step || b.dataset.go))));
    function touch() {
        if (S.started) return;
        S.started = Date.now();
        timer = setInterval(() => {
            const s = Math.floor((Date.now() - S.started) / 1000);
            $('ck-elapsed').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        }, 500);
    }
    function baselineInfo() {
        const b = baselineOf(astro), box = $('ck-set-baseline');
        $('ck-baseline-info').textContent = `${crewName(astro)} · ` + (b ? `baseline from ${b.timestamp_utc.slice(0, 16).replace('T', ' ')} UTC` : 'no baseline yet: this check-in becomes the baseline');
        box.checked = !b; box.disabled = !b;
        $('ck-set-baseline-label').textContent = b ? 'Use this check-in as my new baseline' : 'This first check-in becomes the personal baseline';
    }

    /* ---------- Sliders ---------- */
    $('ck-sliders').innerHTML = SLIDERS.map(([key, label, lo, hi]) =>
        `<div class="ck-slider"><div class="ck-slider-top"><label for="ck-s-${key}">${label}</label><output id="ck-o-${key}" for="ck-s-${key}">5</output></div>
         <input type="range" id="ck-s-${key}" data-key="${key}" min="1" max="10" step="1" value="5">
         <div class="range"><span>1 · ${lo}</span><span>${hi} · 10</span></div></div>`).join('');
    $('ck-sliders').addEventListener('input', ev => {
        const key = ev.target.dataset.key; if (!key) return;
        S.sliders[key] = +ev.target.value; $('ck-o-' + key).textContent = ev.target.value; touch();
    });

    /* ---------- Canvas helper ---------- */
    function fit(canvas) {
        const dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        return { ctx: canvas.getContext('2d'), w, h, dpr };
    }

    /* ---------- Reaction test (psychomotor vigilance) ---------- */
    const pvt = { state: 'idle', trial: 0, rts: [], fs: 0, t0: 0, wait: null, raf: null };
    function pvtDraw(title, sub, target) {
        const canvas = $('ck-pvt'); if (!canvas.offsetWidth) return;
        const { ctx, w, h, dpr } = fit(canvas);
        ctx.fillStyle = '#0b1626'; ctx.fillRect(0, 0, w, h);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (target) { ctx.fillStyle = '#ffd60a'; ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.3, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = target ? '#0b1626' : '#ffffff';
        ctx.font = `700 ${22 * dpr}px ui-monospace, monospace`; ctx.fillText(title, w / 2, h / 2 - (sub ? 12 * dpr : 0));
        if (sub) { ctx.fillStyle = target ? '#0b1626' : '#c9d6e6'; ctx.font = `${13 * dpr}px system-ui, sans-serif`; ctx.fillText(sub, w / 2, h / 2 + 18 * dpr); }
    }
    function pvtStop() { clearTimeout(pvt.wait); cancelAnimationFrame(pvt.raf); }
    function pvtIdle() {
        pvtStop(); pvt.state = 'idle';
        pvtDraw(S.pvt ? 'Done' : 'Tap to start', S.pvt ? 'Tap to repeat the test' : `${PVT_TRIALS} quick trials`);
        const sorted = S.pvt ? [...S.pvt.trials].sort((a, b) => a - b) : [];
        $('ck-pvt-mean').textContent = S.pvt ? Math.round(mean(S.pvt.trials)) + ' ms' : '—';
        $('ck-pvt-median').textContent = S.pvt ? Math.round(sorted[Math.floor(sorted.length / 2)]) + ' ms' : '—';
        $('ck-pvt-fs').textContent = S.pvt ? S.pvt.false_starts : '—';
        $('ck-pvt-lapses').textContent = S.pvt ? S.pvt.trials.filter(x => x > 500).length : '—';
    }
    function pvtNext() {
        pvt.state = 'waiting';
        pvtDraw('Wait…', `Trial ${pvt.trial + 1} of ${PVT_TRIALS}`);
        pvt.wait = setTimeout(() => {
            pvt.raf = requestAnimationFrame(() => {
                pvt.state = 'stimulus'; pvt.t0 = performance.now();
                const tick = () => {
                    if (pvt.state !== 'stimulus') return;
                    pvtDraw(Math.round(performance.now() - pvt.t0) + ' ms', 'TAP!', true);
                    pvt.raf = requestAnimationFrame(tick);
                };
                tick();
            });
        }, 1000 + Math.random() * 3000);
    }
    function pvtFalseStart(text) {
        pvtStop(); pvt.fs++; pvt.state = 'pause';
        pvtDraw('Too early', text);
        pvt.wait = setTimeout(pvtNext, 1000);
    }
    function pvtPress() {
        const now = performance.now(); touch();
        if (pvt.state === 'idle') { pvt.trial = 0; pvt.rts = []; pvt.fs = 0; S.pvt = null; pvtIdle(); pvtNext(); return; }
        if (pvt.state === 'waiting') { pvtFalseStart('False start. Wait for the target.'); return; }
        if (pvt.state !== 'stimulus') return;
        const rt = now - pvt.t0;
        if (rt < 100) { pvtFalseStart('Faster than a real reaction. Trial repeated.'); return; }   // anticipation
        pvtStop(); pvt.rts.push(Math.round(rt * 10) / 10); pvt.trial++; pvt.state = 'pause';
        pvtDraw(Math.round(rt) + ' ms', rt > 500 ? 'Lapse (over 500 ms)' : 'Good');
        pvt.wait = setTimeout(() => {
            if (pvt.trial < PVT_TRIALS) { pvtNext(); return; }
            S.pvt = { trials: pvt.rts.slice(), false_starts: pvt.fs };
            pvtIdle();
        }, 700);
    }
    $('ck-pvt').addEventListener('pointerdown', ev => { ev.preventDefault(); pvtPress(); });
    $('ck-pvt').addEventListener('keydown', ev => { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); if (!ev.repeat) pvtPress(); } });

    /* ---------- Voice note ---------- */
    const rec = { recorder: null, chunks: [], stream: null, stop: null, tick: null };
    $('ck-audio-toggle').addEventListener('click', () => {
        const open = $('ck-audio').hidden; $('ck-audio').hidden = !open;
        $('ck-audio-toggle').setAttribute('aria-expanded', String(open));
    });
    function recEnd() {
        clearTimeout(rec.stop); clearInterval(rec.tick);
        if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop();
    }
    function recReset() {
        recEnd(); S.audio = null; $('ck-rec').textContent = '● Record'; $('ck-rec-status').textContent = '';
        $('ck-rec-play').hidden = true; $('ck-rec-play').removeAttribute('src'); $('ck-rec-clear').hidden = true;
    }
    $('ck-rec-clear').addEventListener('click', recReset);
    $('ck-rec').addEventListener('click', async () => {
        if (rec.recorder && rec.recorder.state === 'recording') { recEnd(); return; }
        if (!navigator.mediaDevices || !window.MediaRecorder) {
            $('ck-rec-status').textContent = 'The microphone is not available here. Open Hermes on localhost or over HTTPS to record.'; return;
        }
        try { rec.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
        catch (_e) { $('ck-rec-status').textContent = 'Microphone access was not allowed.'; return; }
        if (!root.isConnected) {
            rec.stream.getTracks().forEach(track => track.stop());
            return;
        }
        touch();
        const type = ['audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '';
        const recorder = rec.recorder = new MediaRecorder(rec.stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
        rec.chunks = [];
        recorder.ondataavailable = ev => { if (ev.data.size) rec.chunks.push(ev.data); };
        recorder.onstop = () => {
            rec.stream.getTracks().forEach(t => t.stop());
            S.audio = new Blob(rec.chunks, { type: recorder.mimeType || type || 'audio/webm' });
            $('ck-rec-play').src = URL.createObjectURL(S.audio); $('ck-rec-play').hidden = false; $('ck-rec-clear').hidden = false;
            $('ck-rec').textContent = '● Record again';
            $('ck-rec-status').textContent = `Voice note ready (${Math.round(S.audio.size / 1024)} KB).`;
        };
        recorder.start();
        const began = Date.now(); $('ck-rec').textContent = '■ Stop';
        const show = () => { $('ck-rec-status').textContent = `Recording… ${Math.max(0, 30 - Math.floor((Date.now() - began) / 1000))} s left`; };
        show(); rec.tick = setInterval(show, 500); rec.stop = setTimeout(recEnd, 30000);
    });

    /* ---------- Eye selection ---------- */
    function setEye(eye) {
        eTest.active = false; S.eye = eye;
        document.querySelectorAll('[data-eye]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.eye === eye)));
        $('ck-eye-hint').textContent = `Cover your ${eye === 'left' ? 'right' : 'left'} eye and look with your ${eye} eye only.`;
        drawAmsler(); eIdle();
    }
    document.querySelectorAll('[data-eye]').forEach(b => b.addEventListener('click', () => setEye(b.dataset.eye)));

    /* ---------- Amsler grid ---------- */
    let paint = null;
    document.querySelectorAll('[data-brush]').forEach(b => b.addEventListener('click', () => {
        S.brush = b.dataset.brush;
        document.querySelectorAll('[data-brush]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    }));
    function drawAmsler() {
        const canvas = $('ck-amsler'); if (!canvas.offsetWidth) return;
        const { ctx, w, h, dpr } = fit(canvas), cell = w / GRID, cells = S.eyes[S.eye].cells;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        for (const [key, kind] of cells) {
            const [r, c] = key.split(',').map(Number);
            ctx.fillStyle = kind === 's' ? css('--crit') : '#e08a00'; ctx.fillRect(c * cell, r * cell, cell, cell);
        }
        ctx.strokeStyle = '#0b1626'; ctx.lineWidth = Math.max(1, dpr); ctx.beginPath();
        for (let i = 0; i <= GRID; i++) {
            const p = Math.min(w - ctx.lineWidth / 2, Math.max(ctx.lineWidth / 2, i * cell));
            ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.moveTo(0, p); ctx.lineTo(w, p);
        }
        ctx.stroke();
        ctx.fillStyle = '#0b1626'; ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.max(4 * dpr, cell * 0.28), 0, Math.PI * 2); ctx.fill();
        const n = cells.size, missing = [...cells.values()].filter(k => k === 's').length;
        $('ck-amsler-count').textContent = `${S.eye === 'left' ? 'Left' : 'Right'} eye: ${n} square${n === 1 ? '' : 's'} marked` + (n ? ` (${n - missing} wavy, ${missing} blurred or missing)` : '');
    }
    function amslerMark(ev) {
        const r = $('ck-amsler').getBoundingClientRect();
        const c = Math.floor((ev.clientX - r.left) / r.width * GRID), row = Math.floor((ev.clientY - r.top) / r.height * GRID);
        if (c < 0 || row < 0 || c >= GRID || row >= GRID) return;
        const key = row + ',' + c, cells = S.eyes[S.eye].cells;
        if (paint === null) paint = cells.get(key) !== S.brush;      // first square decides: mark, or erase the same kind
        if (paint) cells.set(key, S.brush); else cells.delete(key);
        drawAmsler();
    }
    $('ck-amsler').addEventListener('pointerdown', ev => { ev.preventDefault(); touch(); paint = null; $('ck-amsler').setPointerCapture(ev.pointerId); amslerMark(ev); });
    $('ck-amsler').addEventListener('pointermove', ev => { if (paint !== null) amslerMark(ev); });
    for (const type of ['pointerup', 'pointercancel']) $('ck-amsler').addEventListener(type, () => { paint = null; });
    $('ck-amsler-clear').addEventListener('click', () => { S.eyes[S.eye].cells.clear(); drawAmsler(); });

    /* ---------- Screen calibration ---------- */
    const CARD_SHORT_MM = 53.98, DEFAULT_PX_MM = 96 / 25.4;
    function pxPerMm() { let v = NaN; try { v = parseFloat(localStorage.getItem(CAL)); } catch (_e) {} return v > 1 && v < 40 ? v : null; }
    function calSync() {
        const saved = pxPerMm(), range = $('ck-cal-range');
        range.max = String(Math.max(200, Math.min(620, Math.floor(range.parentElement.clientWidth || 620))));
        if (saved && document.activeElement !== range) range.value = String(Math.round(saved * CARD_SHORT_MM));
        $('ck-cal-bar').style.width = range.value + 'px';
        $('ck-cal-status').textContent = saved ? `Calibrated: ${saved.toFixed(2)} pixels per millimetre.` : 'Not calibrated: a typical screen density is assumed.';
    }
    $('ck-cal-range').addEventListener('input', () => { $('ck-cal-bar').style.width = $('ck-cal-range').value + 'px'; });
    $('ck-cal-save').addEventListener('click', () => {
        try { localStorage.setItem(CAL, String(+$('ck-cal-range').value / CARD_SHORT_MM)); } catch (_e) {}
        calSync(); eIdle();
    });

    /* ---------- Tumbling E (sharpness) ----------
       Letter height follows the logMAR definition for a 40 cm viewing distance. Each size passes with two
       correct answers and fails with two wrong ones; sizes shrink by 0.2 logMAR until the first failure,
       then the size in between is tested once. */
    const DIRS = ['right', 'down', 'left', 'up'];
    const eTest = { active: false, level: 1, right: 0, wrong: 0, failed: false, best: null, dir: 'right', swipe: null, floor: 0, shown: 0 };
    const round1 = v => Math.round(v * 10) / 10;
    const eUnit = (level, dpr) => 5 * Math.pow(10, level) * 400 * Math.tan(Math.PI / 180 / 60) * (pxPerMm() || DEFAULT_PX_MM) * dpr / 5;
    function eFloor() {                                      // smallest size this screen can draw: one device pixel per stroke
        const dpr = window.devicePixelRatio || 1;
        for (let level = 0; level < 1; level = round1(level + 0.1)) if (eUnit(level, dpr) >= 0.95) return level;
        return 1;
    }
    const fmtLog = l => l === null ? '—' : `${l.toFixed(1)} logMAR (about ${snellen(l)})`;
    function drawE() {
        const canvas = $('ck-e'); if (!canvas.offsetWidth) return;
        const { ctx, w, h, dpr } = fit(canvas);
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        if (!eTest.active) return;
        const unit = Math.max(1, Math.round(eUnit(eTest.level, dpr)));
        ctx.save(); ctx.translate(Math.round(w / 2), Math.round(h / 2)); ctx.rotate(DIRS.indexOf(eTest.dir) * Math.PI / 2);
        ctx.fillStyle = '#000'; const o = -Math.round(2.5 * unit);
        ctx.fillRect(o, o, unit, 5 * unit);
        for (const row of [0, 2, 4]) ctx.fillRect(o, o + row * unit, 5 * unit, unit);
        ctx.restore();
    }
    function eButtons(on) { document.querySelectorAll('.ck-dpad button').forEach(b => { b.disabled = !on; }); }
    function eIdle() {
        eTest.active = false; eButtons(false); drawE();
        const score = S.eyes[S.eye].logmar, name = S.eye === 'left' ? 'Left' : 'Right', floor = eFloor();
        $('ck-e-status').textContent = score === null ? `${name} eye: not tested yet`
            : `${name} eye: ${fmtLog(score)}` + (score <= floor + 1e-9 && floor > 0 ? ' · smallest size this screen can show' : '');
        $('ck-e-start').textContent = score === null ? 'Start sharpness test' : 'Repeat sharpness test';
    }
    function eTrial() {
        let dir; do { dir = DIRS[Math.floor(Math.random() * 4)]; } while (dir === eTest.dir && Math.random() < 0.75);
        eTest.dir = dir; eTest.shown++; drawE();
        $('ck-e-status').textContent = `Which way does the E point? (letter ${eTest.shown})`;
    }
    function eFinish() { S.eyes[S.eye].logmar = eTest.best === null ? 1.1 : eTest.best; eIdle(); }
    function eAnswer(dir) {
        if (!eTest.active) return;
        if (dir === eTest.dir) eTest.right++; else eTest.wrong++;
        if (eTest.right < 2 && eTest.wrong < 2) { eTrial(); return; }
        const passed = eTest.right >= 2; eTest.right = eTest.wrong = 0;
        if (passed) {
            eTest.best = eTest.best === null ? eTest.level : Math.min(eTest.best, eTest.level);
            if (eTest.failed || eTest.level <= eTest.floor + 1e-9) { eFinish(); return; }
            eTest.level = Math.max(eTest.floor, round1(eTest.level - 0.2));
        } else {
            if (eTest.failed || eTest.best === null) { eFinish(); return; }
            eTest.failed = true; eTest.level = round1(eTest.level + 0.1);
            if (eTest.level >= eTest.best - 1e-9) { eFinish(); return; }
        }
        eTrial();
    }
    $('ck-e-start').addEventListener('click', () => {
        touch(); Object.assign(eTest, { active: true, level: 1, right: 0, wrong: 0, failed: false, best: null, floor: eFloor(), shown: 0 });
        S.eyes[S.eye].logmar = null; eButtons(true); $('ck-e-start').textContent = 'Restart sharpness test'; eTrial();
    });
    document.querySelectorAll('.ck-dpad button').forEach(b => b.addEventListener('click', () => eAnswer(b.dataset.dir)));
    document.addEventListener('keydown', ev => {
        const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[ev.key];
        if (root.isConnected && !ev.target.closest('#ai-dock') && dir && eTest.active && !$('ck-flow').hidden && !$('ck-step-2').hidden && ev.target.tagName !== 'INPUT') { ev.preventDefault(); eAnswer(dir); }
    });
    $('ck-e').addEventListener('pointerdown', ev => { eTest.swipe = [ev.clientX, ev.clientY]; });
    $('ck-e').addEventListener('pointerup', ev => {
        if (!eTest.swipe) return;
        const dx = ev.clientX - eTest.swipe[0], dy = ev.clientY - eTest.swipe[1]; eTest.swipe = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
        eAnswer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    });

    /* ---------- Symptoms ---------- */
    function drawSymptoms() {
        $('ck-symptoms').innerHTML = SYMPTOMS.map(([key, label]) =>
            `<button type="button" class="ck-pill" data-symptom="${key}" aria-pressed="${S.symptoms.has(key)}">${label}</button>`).join('');
    }
    $('ck-symptoms').addEventListener('click', ev => {
        const key = ev.target.dataset.symptom; if (!key) return; touch();
        if (key === 'none') S.symptoms = new Set(['none']);
        else {
            S.symptoms.delete('none');
            if (S.symptoms.has(key)) S.symptoms.delete(key); else S.symptoms.add(key);
            if (!S.symptoms.size) S.symptoms.add('none');
        }
        drawSymptoms();
    });

    /* ---------- Review and submit ---------- */
    const row = cells => '<tr>' + cells.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('') + '</tr>';
    function review() {
        const skipped = '<span class="chip warn">Not done</span>';
        const rows = SLIDERS.map(([key, label]) => [label, S.sliders[key] + ' / 10']);
        rows.push(['Reaction test', S.pvt ? `${Math.round(mean(S.pvt.trials))} ms mean · ${S.pvt.false_starts} false starts · ${S.pvt.trials.filter(x => x > 500).length} lapses` : skipped]);
        rows.push(['Voice note', S.audio ? `${Math.round(S.audio.size / 1024)} KB` : 'None']);
        for (const [eye] of EYES) {
            rows.push([`Grid, ${eye} eye`, S.eyes[eye].cells.size + ' squares marked']);
            rows.push([`Sharpness, ${eye} eye`, S.eyes[eye].logmar === null ? skipped : fmtLog(S.eyes[eye].logmar)]);
        }
        rows.push(['Eye symptoms', SYMPTOMS.filter(([k]) => S.symptoms.has(k)).map(([, l]) => l).join(', ')]);
        $('ck-review-rows').innerHTML = rows.map(row).join('');
        $('ck-review').hidden = false; $('ck-result').hidden = true; $('ck-submit-error').hidden = true; baselineInfo();
    }
    const toBase64 = blob => new Promise(resolve => {
        const reader = new FileReader(); reader.onloadend = () => resolve(String(reader.result).split(',')[1] || null); reader.readAsDataURL(blob);
    });
    async function buildPayload() {
        const eye = name => {
            const cells = S.eyes[name].cells;
            return { amsler_distorted_cells: [...cells.keys()], blur_or_scotoma_cells: [...cells].filter(([, k]) => k === 's').map(([key]) => key), acuity_logmar: S.eyes[name].logmar };
        };
        return {
            astronaut_id: String(astro), set_baseline: $('ck-set-baseline').checked,
            psych_data: { sliders: { ...S.sliders }, pvt: S.pvt ? { trials: S.pvt.trials, false_starts: S.pvt.false_starts } : null,
                audio_blob_base64: S.audio ? await toBase64(S.audio) : null, audio_mime: S.audio ? S.audio.type : null },
            ocular_data: { left_eye: eye('left'), right_eye: eye('right'), symptoms: [...S.symptoms], acuity_calibrated: pxPerMm() !== null },
        };
    }
    function showResult(c, base) {
        const a = c.assessment, [level, label] = STATUS[a.flag_status];
        $('ck-flag').className = 'ck-flag ' + level;
        $('ck-flag-text').textContent = label.toUpperCase();
        $('ck-flag-note').textContent = c.is_baseline ? 'Saved as the personal baseline. Later check-ins are compared with it.'
            : a.flag_status === 'NOMINAL' ? 'No change beyond the alert limits.'
            : a.flag_status === 'AMBER_REVIEW' ? 'Flagged for review by the flight surgeon and added to mission alerts.' : 'Flagged for immediate medical review and added to mission alerts.';
        $('ck-result-blocks').innerHTML = [['mental', 'Mental'], ['ocular', 'Ocular']].map(([key, name]) =>
            `<section class="ck-block ${key}" aria-label="${name} result"><header><h4>${name}</h4>${chip(a[key].status)}</header>${reasons(a[key].reasons)}</section>`).join('');
        const rows = [], p = c.psych_data, bp = base ? base.psych_data : null;
        rows.push(['Wellbeing index', bp ? bp.wellbeing_index : '—', p.wellbeing_index, bp ? signed(p.wellbeing_index - bp.wellbeing_index) : '—']);
        if (p.pvt) rows.push(['Reaction time', bp && bp.pvt ? Math.round(bp.pvt.mean_rt_ms) + ' ms' : '—', Math.round(p.pvt.mean_rt_ms) + ' ms', a.deltas.pvt_pct === null ? '—' : signed(a.deltas.pvt_pct) + '%']);
        for (const [side, key] of EYES) {
            const e = c.ocular_data[key], b = base ? base.ocular_data[key] : null;
            rows.push([`Grid, ${side} eye`, b ? b.amsler_distorted_cells.length + ' squares' : '—', e.amsler_distorted_cells.length + ' squares', a.deltas['new_cells_' + side] === null ? '—' : a.deltas['new_cells_' + side] + ' new']);
            if (e.acuity_logmar !== null) rows.push([`Sharpness, ${side} eye`, b && b.acuity_logmar !== null ? b.acuity_logmar.toFixed(1) : '—', e.acuity_logmar.toFixed(1), a.deltas['acuity_' + side] === null ? '—' : signed(a.deltas['acuity_' + side], 1) + ' logMAR']);
        }
        $('ck-compare').innerHTML = rows.map(row).join('');
        $('ck-result-time').textContent = `Mission day ${c.mission_day} · ${c.timestamp_utc.slice(11, 19)} UTC`;
        $('ck-payload').textContent = JSON.stringify(c, null, 2);
        $('ck-review').hidden = true; $('ck-result').hidden = false;
    }
    $('ck-submit').addEventListener('click', async () => {
        const button = $('ck-submit'), error = $('ck-submit-error');
        pvtStop(); pvt.state = 'idle'; recEnd(); clearInterval(timer);
        button.disabled = true; button.textContent = 'Sending…'; error.hidden = true;
        await new Promise(resolve => setTimeout(resolve, 60));      // lets a recording that was just stopped finish
        const payload = await buildPayload();
        try {
            const data = await request('submit', payload);
            showResult(data.checkin, data.baseline);
            loadStore();
        } catch (failure) {
            if (!failure.status || failure.status === 503) {        // no connection: keep it on this device and send later
                const queued = { ...payload, queued: true, timestamp_utc: new Date().toISOString() };
                if (!setQueue([...queue(), queued])) { queued.psych_data = { ...queued.psych_data, audio_blob_base64: null, audio_mime: null }; setQueue([...queue(), queued]); }
                error.textContent = 'No connection to the server. The check-in is saved on this device and will be sent automatically when the connection returns.';
                syncLabel();
            } else error.textContent = failure.message;
            error.hidden = false;
        } finally { button.disabled = false; button.textContent = 'Submit check-in'; }
    });

    /* ---------- Reset ---------- */
    function restart() {
        clearInterval(timer); pvtStop(); recEnd(); eTest.active = false;
        S = fresh(); $('ck-elapsed').textContent = '0:00';
        for (const [key] of SLIDERS) { $('ck-s-' + key).value = 5; $('ck-o-' + key).textContent = '5'; }
        document.querySelectorAll('[data-brush]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.brush === 'd')));
        recReset(); drawSymptoms(); setEye('left'); baselineInfo(); go(1); pvtIdle();
    }
    $('ck-new').addEventListener('click', restart);
    function syncCrew(id) {
        if (astro === id) return;
        astro = id;
        if (view === 'checkin') restart();
        else baselineInfo();
    }
    document.addEventListener('hermes:crew', ev => {
        if (root.isConnected) syncCrew(+ev.detail.astroId || astro);
    });
    document.addEventListener('hermes:section', () => {
        if (!root.isConnected) {
            recEnd();
            pvtStop();
            if (['waiting', 'stimulus', 'pause'].includes(pvt.state)) pvt.state = 'idle';
            return;
        }
        syncCrew(+document.getElementById('main').dataset.liveAstro || astro);
        if (view === 'summary') loadStore();
        else refreshCanvases();
    });
    function refreshCanvases() {
        if (!root.isConnected || view !== 'checkin') return;
        if (pvt.state === 'idle') pvtIdle();
        drawAmsler();
        drawE();
    }
    window.addEventListener('resize', refreshCanvases);

    S = fresh(); drawSymptoms(); syncLabel(); loadStore();
}
})();
