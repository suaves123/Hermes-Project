/* Hermes offline SVG charts and complete, paginated telemetry history. No CDN is required. */
(() => {
    'use strict';
    let disposeCharts;
    function activateCharts() {
        disposeCharts?.();
        disposeCharts = mountCharts();
    }
    document.addEventListener('hermes:section', activateCharts);
    activateCharts();

function mountCharts() {
    'use strict';
    const bootstrap = document.getElementById('hermes-bootstrap');
    if (!bootstrap || !document.querySelector('#page-content [data-chart]')) return;
    const lifecycle = new AbortController();
    const listeners = {signal: lifecycle.signal};
    const initial = JSON.parse(bootstrap.textContent), S = window.HermesStats;
    const metrics = initial.metrics, groups = initial.groups, main = document.querySelector('main[data-live-section]');
    const isStatistics = main.dataset.liveSection === 'statistics';
    const state = {crew: initial.astroId, records: new Map(), cursor: 0, loading: false, controller: null,
        range: document.getElementById('history-range')?.value || '5', start: null, end: null,
        page: 0, follow: true, frozenRows: null, selected: 'heart_rate', source: initial.source, error: '', ready: false, partial: false};
    const NS = 'http://www.w3.org/2000/svg';
    const number = (v, digits = 2) => S.numeric(v) ? v.toLocaleString('en-US', {maximumFractionDigits: digits}) : '—';
    const utc = ms => Number.isFinite(ms) ? new Date(ms).toISOString().slice(0,19).replace('T',' ') : '—';
    const timeLabel = (ms, date = false) => new Date(ms).toLocaleString('en-GB', date
        ? {timeZone:'UTC', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false}
        : {timeZone:'UTC', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false});
    const setText = (id, text) => { const el = document.getElementById(id); if (el && el.textContent !== String(text)) el.textContent = text; };
    function svgNode(name, attrs = {}, content) {
        const el = document.createElementNS(NS, name);
        for (const [key,value] of Object.entries(attrs)) el.setAttribute(key, String(value));
        if (content !== undefined) el.textContent = content; return el;
    }
    function emptyChart(host, message) {
        host.replaceChildren(); const p = document.createElement('p'); p.className = 'chart-empty'; p.textContent = message; host.append(p);
    }
    function baseChart(host, label, xMin, xMax, yMin, yMax, xFormat, yFormat, unit) {
        const width = Math.max(280, Math.round(host.getBoundingClientRect().width || 500));
        const height = host.classList.contains('large-chart') ? 280 : 225;
        const pad = {left:60, right:16, top:28, bottom:43}, pw = width - pad.left - pad.right, ph = height - pad.top - pad.bottom;
        const x = value => pad.left + (value - xMin) / (xMax - xMin) * pw;
        const y = value => pad.top + (yMax - value) / (yMax - yMin) * ph;
        const svg = svgNode('svg', {viewBox:`0 0 ${width} ${height}`, role:'img', 'aria-label':label});
        svg.append(svgNode('title', {}, label));
        svg.append(svgNode('text', {x:pad.left,y:13,class:'axis-label'},unit));
        for (let i = 0; i <= 4; i++) {
            const value = yMin + (yMax - yMin) * i / 4, yy = y(value);
            svg.append(svgNode('line', {x1:pad.left,x2:width-pad.right,y1:yy,y2:yy,class:'chart-gridline'}));
            svg.append(svgNode('text', {x:pad.left-9,y:yy+4,'text-anchor':'end',class:'axis-label'},yFormat(value)));
        }
        for (let i = 0; i <= 2; i++) {
            const value = xMin + (xMax - xMin) * i / 2;
            svg.append(svgNode('text', {x:x(value),y:height-15,'text-anchor':i===0?'start':i===2?'end':'middle',class:'axis-label'},xFormat(value)));
        }
        host.replaceChildren(svg);
        return {svg,x,y,width,height,pad,pw,ph};
    }
    function plotTrend(host, records, metric) {
        const all = records.filter(r=>S.numeric(r[metric.key])).map(r=>({x:S.timestamp(r.recorded_at),y:r[metric.key]}));
        if (!all.length) { emptyChart(host, 'No measurements in this time range.'); return; }
        const stats = S.summary(all.map(p=>p.y));
        let xMin = all[0].x, xMax = all[all.length-1].x;
        if (xMin===xMax) { xMin-=1000; xMax+=1000; }
        const margin = stats.max===stats.min ? Math.max(Math.abs(stats.mean)*0.025, 10**(-metric.digits)) : (stats.max-stats.min)*0.12;
        const label = `${metric.label}: ${all.length} samples; minimum ${number(stats.min)} and maximum ${number(stats.max)} ${metric.unit}. Times are UTC.`;
        const chart = baseChart(host,label,xMin,xMax,stats.min-margin,stats.max+margin,
            ms=>timeLabel(ms,xMax-xMin>3600000), v=>number(v, metric.digits+1), metric.unit);
        const times = all.slice(1).map((p,i)=>p.x-all[i].x).filter(t=>t>0).sort((a,b)=>a-b);
        const typical = times.length ? times[Math.floor(times.length/2)] : 1000;
        const gap = Math.max(10000, typical*4);
        const segments=[]; let segment=[];
        // Split before simplification, so missing samples and collection gaps remain visible.
        for (const record of records) {
            if (!S.numeric(record[metric.key])) { if(segment.length) segments.push(segment); segment=[]; continue; }
            const p={x:S.timestamp(record.recorded_at),y:record[metric.key]};
            if (segment.length && p.x-segment[segment.length-1].x>gap) { segments.push(segment); segment=[]; }
            segment.push(p);
        }
        if (segment.length) segments.push(segment);
        const budget=Math.max(4,Math.floor(500/Math.max(1,segments.length)));
        const simplified=segments.map(part=>S.downsample(part,budget));
        const points=simplified.flat();
        for (const part of simplified) {
            chart.svg.append(svgNode('path', {d:part.map((p,i)=>`${i?'L':'M'}${chart.x(p.x).toFixed(2)},${chart.y(p.y).toFixed(2)}`).join(' '),class:'trend-path'}));
        }
        const dotted=points.length<=60?points:simplified.filter(part=>part.length===1).flat();
        for (const p of dotted) {
            const circle=svgNode('circle',{cx:chart.x(p.x),cy:chart.y(p.y),r:points.length===1?4:2.2,class:'trend-dot'});
            circle.append(svgNode('title',{},`${utc(p.x)} UTC · ${number(p.y,metric.digits)} ${metric.unit}`)); chart.svg.append(circle);
        }
        const hoverLine=svgNode('line',{y1:chart.pad.top,y2:chart.height-chart.pad.bottom,class:'hover-line',visibility:'hidden'});
        const hoverDot=svgNode('circle',{r:4,class:'hover-dot',visibility:'hidden'});
        chart.svg.append(hoverLine,hoverDot);
        const tip=document.createElement('div'); tip.className='chart-tooltip'; tip.hidden=true; host.append(tip);
        function highlight(p) {
            const px=chart.x(p.x); hoverLine.setAttribute('x1',px); hoverLine.setAttribute('x2',px); hoverLine.setAttribute('visibility','visible');
            hoverDot.setAttribute('cx',px); hoverDot.setAttribute('cy',chart.y(p.y)); hoverDot.setAttribute('visibility','visible');
            tip.textContent=`${utc(p.x)} UTC · ${number(p.y,metric.digits)} ${metric.unit}`; tip.hidden=false;
        }
        chart.svg.addEventListener('pointermove',ev=>{
            const rect=chart.svg.getBoundingClientRect(), target=xMin+((ev.clientX-rect.left)*chart.width/rect.width-chart.pad.left)/chart.pw*(xMax-xMin);
            let lo=0,hi=all.length-1;
            while(lo<hi){const mid=Math.floor((lo+hi)/2); if(all[mid].x<target)lo=mid+1;else hi=mid;}
            const i=lo>0 && Math.abs(all[lo-1].x-target)<Math.abs(all[lo].x-target)?lo-1:lo;
            highlight(all[i]);
        });
        const clear=()=>{tip.hidden=true;hoverLine.setAttribute('visibility','hidden');hoverDot.setAttribute('visibility','hidden');};
        host.onmouseleave=clear; host.onblur=clear;
        let keyboardIndex=all.length-1;
        host.onkeydown=ev=>{
            if (!['ArrowLeft','ArrowRight'].includes(ev.key)) return;
            ev.preventDefault();keyboardIndex=Math.max(0,Math.min(all.length-1,keyboardIndex+(ev.key==='ArrowLeft'?-1:1)));highlight(all[keyboardIndex]);
        };
    }
    function plotDistribution(host, values, metric) {
        const d=S.distribution(values), st=d.stats;
        if (d.reason) {
            const messages={empty:'No numeric samples in this time range.',single:'At least two numeric samples are needed to fit a normal distribution.',
                constant:`All ${st.n} samples equal ${number(st.mean,metric.digits)} ${metric.unit}. σ = 0; a normal density curve is undefined.`};
            emptyChart(host,messages[d.reason]);
        } else {
            const maxY=Math.max(...d.bins.map(b=>b.density),...d.curve.map(p=>p.y))*1.12;
            const chart=baseChart(host,`${metric.label}: observed histogram and fitted normal density; mean ${number(st.mean)}, sample standard deviation ${number(st.sd)}.`,
                d.lo,d.hi,0,maxY,v=>number(v,metric.digits+1),v=>number(v,3),'Probability density');
            for (const bin of d.bins) {
                const bar=svgNode('rect',{x:chart.x(bin.x)+1,y:chart.y(bin.density),width:Math.max(0,chart.x(bin.x+bin.width)-chart.x(bin.x)-2),
                    height:chart.y(0)-chart.y(bin.density),class:'histogram-bar'});
                bar.append(svgNode('title',{},`${number(bin.x,3)}–${number(bin.x+bin.width,3)} ${metric.unit}: ${bin.count} samples`));chart.svg.append(bar);
            }
            chart.svg.append(svgNode('path',{d:d.curve.map((p,i)=>`${i?'L':'M'}${chart.x(p.x)},${chart.y(p.y)}`).join(' '),class:'normal-path'}));
            chart.svg.append(svgNode('line',{x1:chart.x(st.mean),x2:chart.x(st.mean),y1:chart.pad.top,y2:chart.height-chart.pad.bottom,class:'mean-line'}));
        }
        setText('distribution-caption',`n = ${number(st.n,0)} · μ = ${number(st.mean,3)} ${metric.unit} · σ = ${number(st.sd,3)} ${metric.unit}`);
    }
    function merge(records) {
        for (const row of records) {
            if (+row.astronaut_id!==+state.crew || !Number.isFinite(S.timestamp(row.recorded_at))) continue;
            state.records.set(String(row.id??row.recorded_at), row);
        }
    }
    function visibleRows() {
        if(!['all','custom'].includes(state.range)){
            const cutoff=Date.now()-Number(state.range)*60000;
            for(const [id,row] of state.records)if(S.timestamp(row.recorded_at)<cutoff)state.records.delete(id);
        }
        const start=state.range==='custom'?state.start:state.range==='all'?null:Date.now()-Number(state.range)*60000;
        const end=state.range==='custom'?state.end:null;
        return S.rows([...state.records.values()]).filter(r=>{
            const t=S.timestamp(r.recorded_at);return(start===null||t>=start)&&(end===null||t<=end);
        });
    }
    function addCell(row,text,className='') {
        const td=document.createElement('td');td.textContent=text;if(className)td.className=className;row.append(td);return td;
    }
    function renderTable(records) {
        const body=document.getElementById('history-rows');if(!body)return;
        const tableRecords=state.follow?records:(state.frozenRows??records), newest=[...tableRecords].reverse();
        const count=newest.length,pageSize=25,pages=Math.max(1,Math.ceil(count/pageSize));
        state.page=Math.min(state.page,pages-1);
        const fragment=document.createDocumentFragment();
        for(const record of newest.slice(state.page*pageSize,(state.page+1)*pageSize)){
            const tr=document.createElement('tr');addCell(tr,utc(S.timestamp(record.recorded_at)),'timestamp');addCell(tr,scenarioName(record.scenario));
            for(const metric of Object.values(metrics))addCell(tr,number(record[metric.key],metric.digits),'num');fragment.append(tr);
        }
        if(!count){const tr=document.createElement('tr'),td=addCell(tr,'No historical samples in this time range.');td.colSpan=28;fragment.append(tr);}
        body.replaceChildren(fragment);
        setText('history-page',count?`Rows ${state.page*pageSize+1}–${Math.min(count,(state.page+1)*pageSize)} of ${number(count,0)} · Page ${state.page+1} of ${pages}`:'No records');
        document.getElementById('history-prev').disabled=state.page===0;
        document.getElementById('history-next').disabled=state.page>=pages-1;
        document.getElementById('export-history').disabled=!records.length||state.loading||state.partial;
    }
    function scenarioName(value) {
        return ({nominal:'Nominal',eva_exertion:'EVA / Exertion',eclss_hypoxia:'ECLSS Hypoxia',immune_radiation:'Fever / Radiation'})[value]||String(value??'Unknown');
    }
    function renderStatistics(records) {
        if(!isStatistics)return;
        setText('sample-count',number(records.length,0));setText('first-sample',records.length?utc(S.timestamp(records[0].recorded_at)):'—');
        setText('latest-sample',records.length?utc(S.timestamp(records[records.length-1].recorded_at)):'—');
        const metric=metrics[state.selected],values=records.map(r=>r[metric.key]),st=S.summary(values);
        setText('selected-trend-title',metric.label);plotTrend(document.getElementById('selected-trend'),records,metric);
        setText('selected-trend-caption',`${number(st.n,0)} samples · Mean ${number(st.mean,3)} ${metric.unit} · All timestamps in UTC`);
        plotDistribution(document.getElementById('distribution-chart'),values,metric);
        const fragment=document.createDocumentFragment();
        for(const m of Object.values(metrics)){
            const s=S.summary(records.map(r=>r[m.key])),tr=document.createElement('tr'),td=document.createElement('td'),button=document.createElement('button');
            button.type='button';button.className='metric-link';button.dataset.selectMetric=m.key;button.textContent=m.label;td.append(button);tr.append(td);
            if(m.key===state.selected)tr.className='selected-metric';
            addCell(tr,m.unit);for(const value of [s.n,s.latest,s.mean,s.sd,s.min,s.max])addCell(tr,number(value,3),'num');fragment.append(tr);
        }
        const focused=document.activeElement?.dataset?.selectMetric;
        document.getElementById('statistics-rows').replaceChildren(fragment);
        if(focused)document.querySelector(`[data-select-metric="${focused}"]`)?.focus({preventScroll:true});
        renderTable(records);
    }
    let renderFrame=null;
    function render() {
        if(document.hidden||!chartsActive())return;
        const records=visibleRows();
        for(const host of document.querySelectorAll('[data-chart]')){
            if(host.closest('[hidden]'))continue;
            const metric=metrics[host.dataset.chart],values=records.map(r=>r[metric.key]),s=S.summary(values);
            plotTrend(host,records,metric);
            const card=host.closest('.chart-card');card.querySelector('[data-current]').textContent=number(s.latest,metric.digits);
            card.querySelector('[data-caption]').textContent=`${number(s.n,0)} samples · ${s.n?'Range '+number(s.min,metric.digits)+'–'+number(s.max,metric.digits)+' '+metric.unit:'Waiting for measurements'} · UTC`;
        }
        renderStatistics(records);
        if(!state.loading&&!state.error)setText('history-feedback',`${number(records.length,0)} recorded samples · ${state.source} · UTC`);
    }
    function requestRender(){if(renderFrame!==null)return;renderFrame=requestAnimationFrame(()=>{renderFrame=null;render();});}
    function chartsActive(){return main.dataset.liveSection!=='index'||!document.getElementById('dashboard-graphs').hidden;}
    async function loadHistory(reset=false) {
        if(!chartsActive())return;
        if(state.loading&&!reset)return;
        state.controller?.abort();const controller=new AbortController();state.controller=controller;
        if(reset){state.records.clear();state.cursor=0;state.page=0;state.frozenRows=null;state.follow=true;const cb=document.getElementById('follow-latest');if(cb)cb.checked=true;}
        state.loading=true;state.partial=true;state.error='';setText('history-feedback','Loading all recorded samples in this range…');requestRender();
        const params=new URLSearchParams({astro:String(state.crew),limit:'1000'});
        if(state.range==='custom'){
            if(state.start!==null)params.set('start',utc(state.start));if(state.end!==null)params.set('end',utc(state.end));
        } else if(state.range!=='all')params.set('start',utc(Date.now()-Number(state.range)*60000));
        const previousCursor=state.cursor;let maxId=previousCursor,before=null;
        if(previousCursor)params.set('after_id',String(previousCursor));
        try{
            while(true){
                if(before!==null)params.set('before_id',String(before));
                const response=await fetch('history.php?'+params,{cache:'no-store',signal:controller.signal});
                const data=await response.json();if(!response.ok)throw new Error(data.error||`History request failed (HTTP ${response.status}).`);
                if(controller.signal.aborted)return;
                if(!Array.isArray(data.records))throw new Error('The history response has no records array.');
                merge(data.records);for(const row of data.records)if(S.numeric(row.id))maxId=Math.max(maxId,row.id);
                setText('history-feedback',`Loading history… ${number(state.records.size,0)} samples`);
                if(!data.has_more)break;
                const next=Number(data.next_before_id);
                if(!Number.isSafeInteger(next)||next<=0||(before!==null&&next>=before))throw new Error('The history server returned an invalid page cursor.');
                before=next;
            }
            state.cursor=maxId;state.ready=true;state.partial=false;
        }catch(error){
            if(controller.signal.aborted)return;
            state.error=`History unavailable: ${error.message} ${state.records.size?'Showing partial or previously loaded data.':''}`;
            setText('history-feedback',state.error);
        }finally{
            if(state.controller===controller){state.loading=false;state.controller=null;requestRender();}
        }
    }
    document.getElementById('history-range')?.addEventListener('change',ev=>{
        state.range=ev.target.value;document.getElementById('custom-range').hidden=state.range!=='custom';
        if(state.range==='custom'){
            const end=utc(Date.now()).replace(' ','T'),start=utc(Date.now()-3600000).replace(' ','T');
            const a=document.getElementById('history-start'),b=document.getElementById('history-end');a.value=a.value||start;b.value=b.value||end;
            applyCustom();
        }else{state.start=null;state.end=null;loadHistory(true);}
    }, listeners);
    function applyCustom(){
        const start=document.getElementById('history-start').value,end=document.getElementById('history-end').value;
        const a=S.timestamp(start),b=S.timestamp(end);
        if(!Number.isFinite(a)||!Number.isFinite(b)||a>b){setText('history-feedback','Choose valid UTC dates with the start before the end.');return;}
        state.start=a;state.end=b;loadHistory(true);
    }
    document.getElementById('apply-range')?.addEventListener('click',applyCustom);
    document.getElementById('refresh-history')?.addEventListener('click',()=>loadHistory(!state.ready));
    document.getElementById('graph-group')?.addEventListener('change',ev=>{
        document.querySelectorAll('.chart-card[data-group]').forEach(card=>card.hidden=ev.target.value!=='all'&&card.dataset.group!==ev.target.value);requestRender();
    }, listeners);
    document.getElementById('metric-select')?.addEventListener('change',ev=>{state.selected=ev.target.value;requestRender();});
    document.getElementById('statistics-rows')?.addEventListener('click',ev=>{
        const button=ev.target.closest('[data-select-metric]');if(!button)return;state.selected=button.dataset.selectMetric;
        document.getElementById('metric-select').value=state.selected;requestRender();document.getElementById('metric-select').focus();
    });
    function freezeTable(){if(state.follow){state.frozenRows=visibleRows();state.follow=false;document.getElementById('follow-latest').checked=false;}}
    document.getElementById('history-prev')?.addEventListener('click',()=>{freezeTable();state.page=Math.max(0,state.page-1);renderTable(visibleRows());});
    document.getElementById('history-next')?.addEventListener('click',()=>{freezeTable();state.page++;renderTable(visibleRows());});
    document.getElementById('follow-latest')?.addEventListener('change',ev=>{if(ev.target.checked){state.follow=true;state.frozenRows=null;state.page=0;}else freezeTable();renderTable(visibleRows());});
    document.getElementById('export-history')?.addEventListener('click',()=>{
        if(state.loading||state.partial)return;
        const records=visibleRows(),columns=['id','astronaut_id','recorded_at','scenario',...Object.keys(metrics)];
        const lines=[columns.map(S.csvCell).join(','),...records.map(row=>columns.map(key=>S.csvCell(row[key])).join(','))];
        const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8;'}));
        const link=document.createElement('a');link.href=url;link.download=`hermes-crew-${state.crew}-${new Date().toISOString().slice(0,10)}.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    document.addEventListener('hermes:crew',ev=>{
        state.crew=ev.detail.astroId;state.ready=false;state.records.clear();state.cursor=0;state.controller?.abort();state.loading=false;
        state.page=0;state.frozenRows=null;requestRender();loadHistory(true);
    }, listeners);
    document.addEventListener('hermes:telemetry',ev=>{
        const d=ev.detail;if(+d.astroId!==+state.crew)return;state.source=d.source||state.source;
        if(d.record)merge([d.record]);requestRender();
    }, listeners);
    document.addEventListener('hermes:view',()=>{if(chartsActive()){requestRender();loadHistory(!state.ready);}}, listeners);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){loadHistory(!state.ready);requestRender();}}, listeners);
    let resizeTimer;
    window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(requestRender,120);}, listeners);
    const reconcile = setInterval(()=>{if(!document.hidden&&chartsActive())loadHistory(!state.ready);},10000);
    merge(initial.record?[initial.record]:[]);requestRender();loadHistory(true);
    return () => {
        lifecycle.abort();
        clearInterval(reconcile);
        clearTimeout(resizeTimer);
        if (renderFrame !== null) cancelAnimationFrame(renderFrame);
        const pending = state.controller;
        state.controller = null;
        pending?.abort();
    };
}
})();
