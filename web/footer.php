</div>
<script id="hermes-bootstrap" type="application/json"><?= json_encode(['astroId'=>$astroId,'metrics'=>$metrics,'groups'=>$groups,
    'record'=>$t,'source'=>$sourceLabel,'apiOnline'=>$apiOnline,
    'crewRecords'=>array_values($crewRecords??[]),'astronauts'=>array_values($astronauts??[]),'alertsByCrew'=>(object)($alertsByCrew??[]),
    'scenarios'=>HERMES_SCENARIOS,'scenarioLabels'=>array_map(fn($s)=>$s['label'],$scenarios)],
    JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT|JSON_INVALID_UTF8_SUBSTITUTE) ?></script>
</main>
<?php if (HERMES_AI_ENABLED): ?>
<div class="ai-dock" id="ai-dock" hidden>
    <section class="ai-window" id="ai-window" role="dialog" aria-labelledby="ai-window-title" hidden>
        <header class="ai-window-head"><span class="panel-icon ai" aria-hidden="true">✦</span><h2 id="ai-window-title">HERMES Crew AI Assistant</h2>
            <button type="button" class="ai-close" id="ai-close" aria-label="Close HERMES Crew AI Assistant">×</button></header>
        <div class="ai-window-body">
            <p class="ai-window-note">Runs on this computer. Answers describe simulated data and are not medical advice.</p>
            <button type="button" class="ai-summary-request" id="ai-summary-request" aria-controls="ai-llm">Request crew summary</button>
            <div class="ai-llm" id="ai-llm" aria-live="polite" hidden><p class="ai-llm-text" id="ai-llm-text"></p><p class="ai-llm-meta" id="ai-llm-meta"></p></div>
            <div class="ai-chat" id="ai-chat" aria-live="polite"></div>
        </div>
        <form class="ai-ask" id="ai-ask" autocomplete="off">
            <label class="sr-only" for="ai-ask-input">Ask about any crew member</label>
            <input type="text" id="ai-ask-input" maxlength="500" placeholder="Ask about the crew…">
            <button type="submit" id="ai-ask-send">Ask</button>
        </form>
    </section>
    <button type="button" class="ai-blob" id="ai-blob" aria-expanded="false" aria-controls="ai-window" aria-label="HERMES Crew AI Assistant" title="HERMES Crew AI Assistant"><span aria-hidden="true">✦</span></button>
</div>
<script src="ai.js" defer></script>
<?php endif; ?>
<footer class="footer">Hermes · Crew Health Monitoring · <span id="data-source"><?= htmlspecialchars($sourceLabel) ?></span> · <?= date('Y') ?></footer>
</body>
</html>
