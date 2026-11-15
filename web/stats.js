/* Hermes statistics: pure functions shared by the charts and regression checks. */
(function (root) {
    'use strict';
    const numeric = value => typeof value === 'number' && Number.isFinite(value);
    function summary(values) {
        let n = 0, mean = 0, m2 = 0, min = Infinity, max = -Infinity, latest = null;
        for (const value of values) {
            if (!numeric(value)) continue;
            n++; const delta = value - mean; mean += delta / n; m2 += delta * (value - mean);
            min = Math.min(min, value); max = Math.max(max, value); latest = value;
        }
        return {n, mean: n ? mean : null, sd: n > 1 ? Math.sqrt(Math.max(0, m2 / (n - 1))) : null,
            min: n ? min : null, max: n ? max : null, latest};
    }
    function distribution(values) {
        const valid = values.filter(numeric), stats = summary(valid);
        if (!stats.n) return {stats, bins: [], curve: [], reason: 'empty'};
        if (stats.n < 2) return {stats, bins: [], curve: [], reason: 'single'};
        if (!stats.sd || stats.min === stats.max) return {stats, bins: [], curve: [], reason: 'constant'};
        const count = Math.max(5, Math.min(30, Math.ceil(Math.sqrt(stats.n))));
        const lo = Math.min(stats.min, stats.mean - 3.5 * stats.sd);
        const hi = Math.max(stats.max, stats.mean + 3.5 * stats.sd);
        const width = (hi - lo) / count;
        const bins = Array.from({length: count}, (_, i) => ({x: lo + i * width, width, count: 0, density: 0}));
        for (const v of valid) bins[Math.min(count - 1, Math.max(0, Math.floor((v - lo) / width)))].count++;
        for (const bin of bins) bin.density = bin.count / (stats.n * width);
        const curve = Array.from({length: 161}, (_, i) => {
            const x = lo + (hi - lo) * i / 160, z = (x - stats.mean) / stats.sd;
            return {x, y: Math.exp(-0.5 * z * z) / (stats.sd * Math.sqrt(2 * Math.PI))};
        });
        return {stats, bins, curve, lo, hi, reason: null};
    }
    function timestamp(value) {
        if (typeof value !== 'string' || !value) return NaN;
        const iso = value.replace(' ', 'T');
        return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : iso + 'Z');
    }
    function rows(records) {
        const map = new Map();
        for (const row of records) {
            if (!row || !Number.isFinite(timestamp(row.recorded_at))) continue;
            map.set(String(row.id ?? row.astronaut_id + ':' + row.recorded_at), row);
        }
        return [...map.values()].sort((a,b) => timestamp(a.recorded_at) - timestamp(b.recorded_at) || (a.id ?? 0) - (b.id ?? 0));
    }
    // Keep each bucket's extrema rather than discarding short peaks in large histories.
    function downsample(points, limit = 500) {
        if (points.length <= limit) return points;
        const buckets = Math.max(1, Math.floor((limit - 2) / 2));
        const stride = (points.length - 2) / buckets;
        const out = [points[0]];
        for (let i = 0; i < buckets; i++) {
            const start = 1 + Math.floor(i * stride), end = Math.min(points.length - 1, 1 + Math.floor((i + 1) * stride));
            let low = start, high = start;
            for (let j = start; j < end; j++) {
                if (points[j].y < points[low].y) low = j;
                if (points[j].y > points[high].y) high = j;
            }
            for (const index of [...new Set([low,high])].sort((a,b)=>a-b)) out.push(points[index]);
        }
        out.push(points[points.length-1]); return out;
    }
    function csvCell(value) {
        let s = value === null || value === undefined ? '' : String(value);
        if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return '"' + s.replaceAll('"','""') + '"';
    }
    const api = {numeric, summary, distribution, timestamp, rows, downsample, csvCell};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.HermesStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
