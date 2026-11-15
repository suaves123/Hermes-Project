/* Hermes crew AI assistant: a floating button on every page; summaries and answers are requested by the visitor. */
(() => {
    'use strict';
    const box = document.getElementById('ai-llm');
    const main = document.querySelector('main[data-live-section]');
    if (!box || !main) return;
    const body = document.getElementById('ai-llm-text');
    const meta = document.getElementById('ai-llm-meta');
    const summaryButton = document.getElementById('ai-summary-request');
    let summaryRequest = null, summaryScope = null;
    const astro = () => +main.dataset.liveAstro || 1;
    const form = document.getElementById('ai-ask');
    const input = document.getElementById('ai-ask-input');
    const send = document.getElementById('ai-ask-send');
    const chat = document.getElementById('ai-chat');
    const conversation = chat.closest('.ai-window-body');
    let history = [], asking = null;

    function show(state, text, metaText) {
        box.hidden = false;
        box.dataset.state = state;
        body.textContent = text;       // textContent only: model output is never treated as HTML
        meta.textContent = metaText;
    }
    function resetSummary() {
        summaryRequest?.abort();
        summaryRequest = null;
        summaryScope = null;
        summaryButton.disabled = false;
        box.hidden = true;
    }
    async function requestSummary() {
        if (summaryRequest) return;
        const ctrl = new AbortController();
        const { signal } = ctrl;
        summaryRequest = ctrl;
        summaryButton.disabled = true;
        summaryScope = null;
        show('loading', 'Generating crew summary…', '');
        const url = 'ollama.php';
        const timeout = setTimeout(() => ctrl.abort(), 180000);
        try {
            const response = await fetch(url, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'summarize' }), cache: 'no-store', signal,
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            let result = await response.json();
            signal.throwIfAborted();
            summaryScope = result.scope ?? null;
            const pollUrl = url + '?scope=' + encodeURIComponent(summaryScope ?? '');
            while (result.status === 'pending') {
                await sleep(1500, signal);
                const poll = await fetch(pollUrl, { cache: 'no-store', signal });
                if (!poll.ok) throw new Error('HTTP ' + poll.status);
                result = await poll.json();
            }
            if (summaryRequest !== ctrl) return;
            signal.throwIfAborted();
            if (result.status === 'ok' && result.text) {
                const when = result.generated ? ' · ' + new Date(result.generated * 1000).toLocaleTimeString() : '';
                const note = 'Informational only. Simulated data, not medical advice.';
                show('ok', result.text, `Written by ${result.model}${when} · ${note}`);
            } else {
                show('error', 'Crew summary unavailable.', result.error || 'Request a summary to try again.');
            }
        } catch (error) {
            if (summaryRequest === ctrl) {
                const message = signal.aborted ? 'The model took too long to answer.' : 'Could not reach the server.';
                show('error', 'Crew summary unavailable.', message);
            }
        } finally {
            clearTimeout(timeout);
            if (summaryRequest === ctrl) {
                summaryRequest = null;
                summaryButton.disabled = false;
            }
        }
    }
    function sleep(ms, signal) {
        return new Promise((resolve, reject) => {
            signal.throwIfAborted();
            const timeout = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
            function abort() { clearTimeout(timeout); reject(signal.reason); }
            signal.addEventListener('abort', abort, { once: true });
        });
    }

    // ----- Free-text questions
    function bubble(kind, text) {
        const el = document.createElement('div');
        el.className = 'ai-bubble ' + kind;
        el.textContent = text;           // textContent only: never insert model output as HTML
        chat.appendChild(el);
        while (chat.children.length > 8) chat.firstChild.remove();
        conversation.scrollTop = conversation.scrollHeight;
        return el;
    }
    function setBusy(busy) { if (send) send.disabled = busy; }
    async function ask(question) {
        const crew = astro(), ctrl = new AbortController();
        asking = ctrl;
        bubble('user', question);
        const reply = bubble('bot loading', 'Thinking…');
        setBusy(true);
        const fail = message => { reply.className = 'ai-bubble bot error'; reply.textContent = message; };
        try {
            const response = await fetch('ask.php?astro=' + crew, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: ctrl.signal,
                body: JSON.stringify({ question, history }),
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            let result = await response.json();
            if (result.status === 'pending') {
                const id = result.id, deadline = Date.now() + 180000;
                for (;;) {
                    await sleep(1500, ctrl.signal);
                    if (Date.now() > deadline) { result = { status: 'error', error: 'The model took too long to answer.' }; break; }
                    const poll = await fetch('ask.php?id=' + encodeURIComponent(id), { cache: 'no-store', signal: ctrl.signal });
                    if (!poll.ok) throw new Error('HTTP ' + poll.status);
                    const next = await poll.json();
                    if (next.status !== 'pending') { result = next; break; }
                }
            }
            if (ctrl.signal.aborted) return;
            if (result.status === 'ok' && result.text) {
                reply.className = 'ai-bubble bot';
                reply.textContent = result.text;
                history = [...history, { q: question, a: result.text }].slice(-2);
                conversation.scrollTop = conversation.scrollHeight;
            } else fail(result.error || 'No answer. Check that Ollama is running.');
        } catch (error) {
            if (error.name === 'AbortError') return;
            fail('Could not reach the server.');
        } finally {
            if (asking === ctrl) { asking = null; setBusy(false); }
        }
    }
    form?.addEventListener('submit', event => {
        event.preventDefault();
        if (asking) return;
        const question = input.value.trim();
        if (!question) return;
        input.value = '';
        ask(question);
    });

    // ----- Floating assistant button: opens and closes the assistant window on every page
    const blob = document.getElementById('ai-blob'), win = document.getElementById('ai-window');
    function setOpen(open) {
        win.hidden = !open;
        blob.setAttribute('aria-expanded', String(open));
        blob.classList.toggle('open', open);
        (open ? input : blob).focus({preventScroll: true});
    }
    document.getElementById('ai-dock').hidden = false;
    blob?.addEventListener('click', () => setOpen(win.hidden));
    document.getElementById('ai-close')?.addEventListener('click', () => setOpen(false));
    win.addEventListener('keydown', event => { if (event.key === 'Escape' && win && !win.hidden) setOpen(false); });

    summaryButton.addEventListener('click', requestSummary);
    document.addEventListener('hermes:telemetry', ev => {
        const scope = ev.detail?.crewScope;
        if (scope && summaryScope && scope !== summaryScope) resetSummary();
    });
})();
