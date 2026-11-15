/* Hermes live readings, crew and scenario controls, and in-page section navigation. */
(() => {
    'use strict';
    const main=document.querySelector('main[data-live-section]');if(!main)return;
    const content = document.getElementById('page-content');
    const bootstrapElement = document.getElementById('hermes-bootstrap');
    const bootstrap=JSON.parse(bootstrapElement.textContent);
    const VIEWS = ['general', 'data', 'graphs'];
    let checkinPage = null;
    const state={section:main.dataset.liveSection,astro:+main.dataset.liveAstro||1,timer:null,controller:null,pending:null,labels:bootstrap.scenarioLabels||{}};
    const text=(id,value)=>{const el=document.getElementById(id);if(el&&el.textContent!==String(value))el.textContent=value;};
    const url=new URL(location.href);url.searchParams.delete('sim');history.replaceState(null,'',url);
    let currentUrl = location.href;
    let navigation = null;
    function morph(from,to){
        if(from.nodeType!==to.nodeType||from.nodeName!==to.nodeName){from.replaceWith(to);return;}
        if(from.nodeType!==Node.ELEMENT_NODE){if(from.nodeValue!==to.nodeValue)from.nodeValue=to.nodeValue;return;}
        for(const a of [...from.attributes])if(!to.hasAttribute(a.name))from.removeAttribute(a.name);
        for(const a of [...to.attributes])if(from.getAttribute(a.name)!==a.value)from.setAttribute(a.name,a.value);
        if(from.childNodes.length!==to.childNodes.length){from.replaceChildren(...to.childNodes);return;}
        const old=[...from.childNodes],fresh=[...to.childNodes];old.forEach((node,i)=>morph(node,fresh[i]));
    }
    const lastHtml={};
    function update(id,html){
        const el=document.getElementById(id);if(!el||typeof html!=='string'||lastHtml[id]===html)return;lastHtml[id]=html;
        let container;
        if(el.tagName==='TBODY'){const table=document.createElement('table');table.innerHTML='<tbody>'+html+'</tbody>';container=table.tBodies[0];}
        else{container=document.createElement(el.tagName);container.innerHTML=html;}
        if(el.childNodes.length!==container.childNodes.length)el.replaceChildren(...container.childNodes);
        else{const old=[...el.childNodes],fresh=[...container.childNodes];old.forEach((node,i)=>morph(node,fresh[i]));}
    }
    function pill(online){document.getElementById('api-pill')?.classList.toggle('offline',!online);text('api-state',online?'ONLINE':'OFFLINE');}
    function message(value,error=false){text('scenario-msg',value);document.getElementById('scenario-msg')?.classList.toggle('error',error);}
    function markPending(){document.querySelectorAll('#scenario-form button').forEach(b=>b.classList.toggle('pending',!!state.pending&&b.value===state.pending.code));}
    function stamp(record,online){
        const ms=window.HermesStats.timestamp(record?.recorded_at),age=(Date.now()-ms)/1000;
        text('last-updated',Number.isFinite(ms)?`Last reading: ${new Date(ms).toISOString().slice(0,19).replace('T',' ')} UTC${!online?' · Offline':age>10?' · No recent telemetry':''}`:'Waiting for a reading…');
        document.getElementById('last-updated')?.classList.toggle('stale',!online||age>10);
    }
    function apply(d){
        state.labels=d.scenarioLabels||state.labels;text('crew-label',d.crew);pill(d.apiOnline);stamp(d.record,d.apiOnline);
        const h=d.html||{};
        for(const [id,key] of Object.entries({'live-physiology':'physiology','live-biometric':'biometric','live-environment':'environment','mission-alerts':'missionAlerts','notice-slot':'notice','live-readings':'readings','scenario-form':'scenarioButtons'}))update(id,h[key]);
        if(d.scenarioResult&&!d.scenarioResult.ok){state.pending=null;message('Could not change the scenario: '+d.scenarioResult.error,true);}
        if(state.pending){
            if(d.scenario===state.pending.code){state.pending=null;message('');}
            else if(Date.now()-state.pending.since>15000){state.pending=null;message('Scenario requested, but no new matching telemetry has arrived.',true);}
            else message(`Switching to ${state.pending.label}…`);
        }
        markPending();document.dispatchEvent(new CustomEvent('hermes:telemetry',{detail:d}));
    }
    function schedule(ms){clearTimeout(state.timer);if(!document.hidden)state.timer=setTimeout(()=>refresh(),ms);}
    async function refresh(body){
        clearTimeout(state.timer);state.controller?.abort();const ctrl=new AbortController();state.controller=ctrl;
        let next=1000,timedOut=false;const crew=state.astro;
        const timeout=setTimeout(()=>{timedOut=true;ctrl.abort();},15000);
        try{
            const q=new URLSearchParams({astro:String(crew),section:state.section});
            const response=await fetch('data.php?'+q,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:ctrl.signal});
            if(!response.ok)throw new Error(`HTTP ${response.status}`);
            const data=await response.json();if(state.controller!==ctrl||crew!==state.astro)return;
            apply(data);if(!data.apiOnline)next=3000;
        }catch(error){
            if(state.controller!==ctrl)return;
            if(error.name!=='AbortError'||timedOut){
                pill(false);text('last-updated','Connection lost. Retrying…');next=3000;
                const missionAlerts = document.getElementById('mission-alerts');
                const alertStatus = missionAlerts?.querySelector('.mission-alerts-status');
                if (alertStatus) alertStatus.textContent = 'Alert feed offline';
                delete lastHtml['mission-alerts'];
                if(body){state.pending=null;markPending();message('Could not reach the telemetry server.',true);}
            }
        }finally{
            clearTimeout(timeout);
            if(state.controller===ctrl){state.controller=null;schedule(next);}
        }
    }
    document.addEventListener('submit',ev=>{
        if(ev.target.id==='crew-form'){
            ev.preventDefault();
            const crew = Number(ev.submitter?.value);
            if (!Number.isSafeInteger(crew) || crew < 1 || crew === state.astro) return;
            state.astro = crew;
            state.pending = null;
            message('');
            main.dataset.liveAstro = String(crew);
            syncCrewButtons();
            syncLinks();
            text('crew-label', 'Loading selected crew member…');
            document.dispatchEvent(new CustomEvent('hermes:crew', {detail:{astroId:crew}}));
            refresh();
            return;
        }
        if(ev.target.id!=='scenario-form')return;ev.preventDefault();const button=ev.submitter;if(!button||button.disabled)return;
        state.pending={code:button.value,label:state.labels[button.value]||button.textContent.trim(),since:Date.now()};
        markPending();message(`Switching to ${state.pending.label}…`);refresh({scenario:button.value});
    });
    function syncCrewButtons() {
        document.querySelectorAll('.crew-button').forEach(button => {
            button.setAttribute('aria-pressed', String(Number(button.value) === state.astro));
        });
    }
    function syncLinks(){
        const u=new URL(location.href);u.searchParams.set('astro',state.astro);history.replaceState(null,'',u);
        currentUrl = u.href;
        document.querySelectorAll('.nav a,.brand').forEach(a=>{const href=new URL(a.href);href.searchParams.set('astro',state.astro);a.href=href.pathname.split('/').pop()+href.search;});
        const form=document.getElementById('scenario-form'),view=u.searchParams.get('view');if(form)form.action='?astro='+state.astro+(VIEWS.includes(view)?'&view='+view:'');
    }
    function setView(view,save=true){
        if (!VIEWS.includes(view)) view = 'general';
        for (const name of VIEWS) document.getElementById('dashboard-' + name).hidden = name !== view;
        document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
        const u=new URL(location.href);u.searchParams.set('view',view);history.replaceState(null,'',u);syncLinks();
        if(save){
            try{localStorage.setItem('hermes-dashboard-view',view);}catch(_error){}
            document.dispatchEvent(new CustomEvent('hermes:view',{detail:{view}}));
        }
    }
    function restoreView() {
        if(state.section!=='index') return;
        let view=new URL(location.href).searchParams.get('view');
        if(!VIEWS.includes(view))try{view=localStorage.getItem('hermes-dashboard-view');}catch(_error){}
        setView(VIEWS.includes(view) ? view : 'general', false);
    }
    async function openSection(url, push) {
        navigation?.abort();
        const controller = new AbortController();
        navigation = controller;
        const status = document.getElementById('navigation-status');
        status.hidden = true;
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(url, {cache: 'no-store', signal: controller.signal});
            if (!response.ok) throw new Error('Section unavailable');
            const documentText = await response.text();
            if (controller.signal.aborted) throw controller.signal.reason;
            const page = new DOMParser().parseFromString(documentText, 'text/html');
            const nextMain = page.querySelector('main[data-live-section]');
            const nextContent = page.getElementById('page-content');
            const nextBootstrap = page.getElementById('hermes-bootstrap');
            if (!nextMain || !nextContent || !nextBootstrap) throw new Error('Invalid section');
            const initial = JSON.parse(nextBootstrap.textContent);

            // A crew selection made while the request was in flight wins over its snapshot.
            const crewChanged = push && state.astro !== initial.astroId;
            if (!crewChanged && state.astro !== initial.astroId) {
                state.pending = null;
                message('');
                update('scenario-form', page.getElementById('scenario-form')?.innerHTML);
            }
            state.astro = crewChanged ? state.astro : initial.astroId;
            if (crewChanged) {
                initial.astroId = state.astro;
                initial.record = null;
                nextContent.querySelector('#crew-label').textContent = 'Loading selected crew member…';
            }
            state.section = nextMain.dataset.liveSection;
            state.labels = initial.scenarioLabels || {};
            clearTimeout(state.timer);
            state.controller?.abort();
            state.controller = null;
            for (const id of Object.keys(lastHtml)) {
                if (content.contains(document.getElementById(id))) delete lastHtml[id];
            }
            main.dataset.liveSection = state.section;
            main.dataset.liveAstro = String(state.astro);
            const incomingCheckin = nextContent.querySelector('#checkin-page');
            const selectedLabel = incomingCheckin?.querySelector('#crew-label')?.textContent;
            checkinPage = content.querySelector('#checkin-page') ?? checkinPage;
            if (incomingCheckin && checkinPage) {
                incomingCheckin.replaceWith(checkinPage);
                checkinPage.querySelector('#crew-label').textContent = selectedLabel;
            }
            content.replaceChildren(...nextContent.childNodes);
            document.getElementById('mission-scenario').hidden = state.section === 'checkin';
            bootstrapElement.textContent = JSON.stringify(initial);
            update('crew-selector', page.getElementById('crew-selector')?.innerHTML);
            syncCrewButtons();
            markPending();
            document.title = page.title;
            if (push) history.pushState(null, '', url);
            syncLinks();
            restoreView();
            const activePage = page.querySelector('.nav a[aria-current="page"]')?.getAttribute('href')?.split('?')[0];
            document.querySelectorAll('.nav a').forEach(link => {
                const active = link.getAttribute('href').split('?')[0] === activePage;
                link.classList.toggle('active', active);
                if (active) link.setAttribute('aria-current', 'page');
                else link.removeAttribute('aria-current');
            });
            document.getElementById('nav-toggle').checked = false;
            pill(initial.apiOnline);
            stamp(initial.record, initial.apiOnline);
            text('data-source', initial.source);
            document.dispatchEvent(new Event('hermes:section'));
            window.scrollTo(0, 0);
            const heading = content.querySelector('h1');
            if (heading && !document.activeElement?.closest('#ai-dock')) {
                heading.tabIndex = -1;
                heading.focus({preventScroll: true});
            }
            refresh();
        } catch (error) {
            if (navigation !== controller) return;
            if (!push) history.replaceState(null, '', currentUrl);
            status.textContent = 'Could not load this section. Try again.';
            status.hidden = false;
        } finally {
            clearTimeout(timeout);
            if (navigation === controller) navigation = null;
        }
    }
    document.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const view = event.target.closest('[data-view]');
        if (view && state.section === 'index') {
            setView(view.dataset.view);
            return;
        }
        const link = event.target.closest('.nav a, .brand');
        if (!link || (link.target && link.target !== '_self') || link.origin !== location.origin) return;
        event.preventDefault();
        const destination = new URL(link.href);
        if (destination.pathname === new URL(currentUrl).pathname && !navigation) {
            document.getElementById('nav-toggle').checked = false;
            return;
        }
        openSection(destination, true);
    });
    window.addEventListener('popstate', () => {
        if (location.href !== currentUrl) openSection(new URL(location.href), false);
    });
    document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(state.timer);state.controller?.abort();}else refresh();});
    restoreView();
    stamp(bootstrap.record,bootstrap.apiOnline);refresh();
})();
