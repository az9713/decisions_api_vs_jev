import { EMOTIONS, SCRIPTED_TRIALS, summarize, targetLane, admissibleActions, mulberry32, isFreshDecision, frameLifetimeMs, visibleRows, csvFor } from './core.mjs';

const $ = id => document.getElementById(id);
const samples = { rabbit: [], raccoon: [] };
const voiceRuns = [];
const assets = {};
const rabbitRequests = new Map();
const W = 640, H = 960, rabbitY = 790, hitY = 740, laneX = [160, 333, 512];
let ready = false, apiStatus, sequence = 0, lastFrame = performance.now(), sweepToken = 0, benchmarkToken = 0;
let random = mulberry32(4037), rowSequence = 0;
const game = { running: false, runId: 0, lane: 1, visualX: laneX[1], rows: [], cleared: 0, bumps: 0, lastApplied: 0, pending: 0, skipped: 0, nextCapture: 0, flashUntil: 0, benchmark: false, distance: 0, jump: null, hop: 0, latestCapture: 0, lastAppliedAt: null, lastAppliedChoice: null, expiredStreak: 0 };
const expression = { value: 'neutral', pending: false, lastDispatch: 0, version: 0, benchmark: false };
let voice = null;
const ms = value => Number.isFinite(value) ? `${Math.round(value)} ms` : '—';
const pct = value => Number.isFinite(value) ? `${(value * 100).toFixed(0)}%` : '—';
const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const sleep = duration => new Promise(resolve => setTimeout(resolve, duration));
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 6500); }
function budgetDisplay(budget) {
  if (!budget) return;
  $('budget-mini').textContent = `$${budget.estimatedSpentUsd.toFixed(4)} / $${budget.capUsd.toFixed(2)}`;
  $('budget-mini').title = `Conservative reservations: $${budget.reservedUsd.toFixed(2)}. Available: $${budget.availableUsd.toFixed(2)}. Estimated cost, not an invoice.`;
}
async function post(path, body, { signal } = {}) {
  const start = performance.now();
  let response;
  try { response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }); }
  catch (error) { error.observedWaitMs = performance.now() - start; throw error; }
  const result = await response.json();
  budgetDisplay(result.budget);
  if (!response.ok) throw Object.assign(new Error(result.error || `HTTP ${response.status}`), { status: response.status, roundTripMs: performance.now() - start });
  return { ...result, roundTripMs: performance.now() - start };
}
async function refreshStatus() {
  try {
    apiStatus = await (await fetch('/api/status')).json(); budgetDisplay(apiStatus.budget);
    $('key-status').textContent = apiStatus.keyConfigured ? 'Server key configured' : 'API key missing';
    $('key-dot').classList.toggle('offline', !apiStatus.keyConfigured);
  } catch { $('key-status').textContent = 'Server disconnected'; }
}
function addSample(demo, sample) {
  samples[demo].push({ demo, ...sample }); updateStats(demo);
  $('api-badge').textContent = sample.cancelled ? 'Frame discarded' : sample.ok ? 'Live Decisions API' : 'Request failed';
}
function updateStats(demo) {
  const s = summarize(samples[demo]);
  const labeled = samples[demo].filter(x => x.ok && typeof x.correct === 'boolean');
  const items = [['Calls', `${s.successes} / ${s.count}`, `${s.errors} errors · ${s.cancelled} cancelled`], ['Median', ms(s.p50), 'API round trip'], ['p95', ms(s.p95), `p99 ${ms(s.p99)}`], ['Processing', ms(s.processingP50), `${s.processingCount} reported samples`], [demo === 'rabbit' ? 'In time' : 'Label agreement', demo === 'rabbit' ? pct(s.onTimeRate) : pct(s.accuracy), demo === 'rabbit' ? `${s.applied} applied · ${s.stale} discarded` : `${s.labeledCount} scripted samples`], ['Decisions cost', `$${s.estimatedUsd.toFixed(5)}`, `${s.inputTokens.toLocaleString()} input tokens`]];
  if (demo === 'rabbit') items.push(['Vision agreement', pct(s.accuracy), `${s.labeledCount} fixed frames`], ['Safe action', pct(labeled.length ? labeled.filter(x => x.correct).length / labeled.length : null), `${labeled.length} graded captures`]);
  const stats = $(demo + '-stats'); stats.replaceChildren();
  for (const [label, value, detail] of items) { const box = document.createElement('div'); box.className = 'stat'; for (const [tag, content] of [['span', label], ['b', value], ['small', detail]]) { const el = document.createElement(tag); el.textContent = content; box.append(el); } stats.append(box); }
  if (demo === 'rabbit' && labeled.length) stats.title = `Safe-action agreement: ${pct(labeled.filter(x => x.correct).length / labeled.length)} across ${labeled.length} labeled frames. Live safety and static exact-label accuracy are distinct.`;
  const log = $(demo + '-log'); log.replaceChildren();
  for (const sample of samples[demo].slice(-8).reverse()) {
    const tr = document.createElement('tr');
    const outcome = sample.cancelled ? `Cancelled: ${sample.stale}` : !sample.ok ? `Error ${sample.status || ''}` : sample.stale ? `Discarded: ${sample.stale}` : sample.expected ? (sample.correct ? 'Label matched' : `Expected ${sample.expected}`) : sample.applied ? (sample.onTime === false ? 'Late' : 'Applied') : 'Recorded';
    for (const text of [sample.sequence, sample.choice || '—', sample.censored ? `wait ${ms(sample.observedWaitMs)}*` : ms(sample.roundTripMs), ms(sample.processingMs), outcome]) { const td = document.createElement('td'); td.textContent = text; tr.append(td); }
    log.append(tr);
  }
  const canvas = $(demo + '-chart'), ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
  const recent = samples[demo].slice(-60), max = Math.max(1000, ...recent.map(s => s.roundTripMs ?? s.observedWaitMs ?? 0));
  ctx.font = '12px system-ui'; ctx.fillStyle = '#89968f'; ctx.fillText(`RTT / cancelled wait* · last ${recent.length} calls · scale ${Math.ceil(max)} ms`, 12, 17);
  ctx.strokeStyle = '#526458'; ctx.beginPath(); ctx.moveTo(12, 100); ctx.lineTo(988, 100); ctx.stroke();
  recent.forEach((s, i) => { const x = 20 + i * 960 / Math.max(1, recent.length), y = 98 - Math.min(max, s.roundTripMs ?? s.observedWaitMs ?? 0) / max * 65; ctx.fillStyle = s.cancelled ? '#d3b878' : !s.ok ? '#e3968e' : s.stale ? '#d3b878' : '#82c1a0'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); if (Number.isFinite(s.processingMs)) { ctx.fillStyle = '#a6b4ba'; ctx.fillRect(x - 1, 98 - s.processingMs / max * 65, 2, 3); } });
}
function exportData(demo) {
  const data = { exportedAt: new Date().toISOString(), model: 'gpt-6-luna', demo, summary: summarize(samples[demo]), samples: samples[demo], voiceRuns: demo === 'raccoon' ? voiceRuns : [], notes: 'Times are measured, costs estimated. Expected labels never go to the API. Processing time is an optional provider header. No audio or transcript is included in this export.' };
  for (const [extension, content, type] of [['json', JSON.stringify(data, null, 2), 'application/json'], ['csv', csvFor(samples[demo]), 'text/csv']]) { const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a'); link.href = url; link.download = `${demo}-decisions-${Date.now()}.${extension}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
}
function makeRow(y, blocked) {
  // Every row has exactly one log. Either adjacent lane is a legal escape from the center.
  return { id: ++rowSequence, y, blocked: blocked || [Math.floor(random() * 3)], types: [1, 1, 1], resolved: false };
}
function resetGarden() {
  stopGarden(); random = mulberry32(4037); game.runId++; game.lane = 1; game.visualX = laneX[1]; game.rows = [makeRow(300, [1]), makeRow(-120, [2])]; game.cleared = 0; game.bumps = 0; game.skipped = 0; game.lastApplied = 0; game.distance = 0; game.jump = null; game.hop = 0; game.latestCapture = 0; game.lastAppliedAt = null; game.lastAppliedChoice = null; game.expiredStreak = 0; $('cleared').textContent = '0'; $('bumps').textContent = '0'; $('last-action').textContent = '—'; drawGarden();
}
function sprite(ctx, index, x, y, width, height = width) { const size = assets.sprites.width / 2; ctx.drawImage(assets.sprites, index % 2 * size, Math.floor(index / 2) * size, size, size, x - width / 2, y - height / 2, width, height); }
function drawGarden() {
  if (!ready) return;
  const ctx = $('garden').getContext('2d'), offset = game.distance % H;
  // Moving the complete trail down gives the same forward-motion cue as the racing demo.
  ctx.drawImage(assets.gardenTile, 0, offset - H); ctx.drawImage(assets.gardenTile, 0, offset);
  // Lane markers and the game objects are part of the actual image the model sees.
  ctx.font = 'bold 25px system-ui'; ctx.textAlign = 'center';
  laneX.forEach((x, lane) => { ctx.fillStyle = '#fff6db'; ctx.beginPath(); ctx.arc(x, 55, 22, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#54765e'; ctx.fillText(lane + 1, x, 64); });
  for (const row of visibleRows(game.rows)) for (const lane of row.blocked) sprite(ctx, row.types[lane], laneX[lane], row.y, row.types[lane] === 1 ? 210 : 160, row.types[lane] === 1 ? 150 : 160);
  if (performance.now() < game.flashUntil) { ctx.strokeStyle = '#d67062'; ctx.lineWidth = 8; ctx.beginPath(); ctx.ellipse(game.visualX, rabbitY + 35, 60, 18, 0, 0, Math.PI * 2); ctx.stroke(); }
  const phase = game.jump ? Math.min(1, (performance.now() - game.jump.started) / game.jump.duration) : 0;
  const jumpHeight = game.jump ? Math.sin(phase * Math.PI) * 66 : 0;
  ctx.fillStyle = '#58462b28'; ctx.beginPath(); ctx.ellipse(game.visualX, rabbitY + 55, 38 - jumpHeight * .14, 10, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.translate(game.visualX, rabbitY - game.hop - jumpHeight); ctx.rotate(game.jump ? Math.sin(phase * Math.PI) * Math.sign(game.jump.to - game.jump.from) * .13 : 0); sprite(ctx, 0, 0, 0, 184, 184); ctx.restore();
  ctx.textAlign = 'center'; ctx.font = 'bold 21px system-ui'; ctx.fillStyle = '#fff8eae8'; ctx.fillRect(game.visualX - 66, rabbitY + 82, 132, 31); ctx.fillStyle = '#315946'; ctx.fillText(`Path ${game.lane + 1}`, game.visualX, rabbitY + 105);
  ctx.textAlign = 'left'; ctx.font = 'bold 18px system-ui'; ctx.fillStyle = '#fff8eae8'; ctx.fillRect(15, H - 42, 165, 30); ctx.fillStyle = '#315946'; ctx.fillText(`Trail ${Math.floor(game.distance)} px`, 25, H - 20);
}
function drawRaccoon(value) {
  if (!ready) return;
  expression.value = EMOTIONS.includes(value) ? value : 'neutral';
  const index = EMOTIONS.indexOf(expression.value), ctx = $('raccoon').getContext('2d'), width = assets.raccoon.width / 3, height = assets.raccoon.height / 2;
  ctx.clearRect(0, 0, 512, 512); ctx.drawImage(assets.raccoon, index % 3 * width, Math.floor(index / 3) * height, width, height, 0, 0, 512, 512);
  $('expression-label').textContent = expression.value[0].toUpperCase() + expression.value.slice(1);
}
function controls() {
  $('rabbit-start').disabled = !ready || game.running || game.benchmark;
  $('rabbit-stop').disabled = !game.running && !game.benchmark;
  $('vision-benchmark').disabled = !ready || game.running || game.benchmark;
  $('stress-sweep').disabled = !ready || game.running || game.benchmark;
  $('rabbit-reset').disabled = game.benchmark;
  $('garden-overlay').hidden = game.running || game.benchmark;
}
function startGarden() {
  if (!ready || game.benchmark) return;
  game.running = true; game.expiredStreak = 0; game.runId++; game.nextCapture = performance.now(); $('rabbit-state').textContent = 'Exploring with Decisions'; controls();
}
function steer(choice, animate = true) {
  const next = targetLane(game.lane, choice);
  if (next !== game.lane) game.jump = animate ? { from: game.visualX, to: laneX[next], started: performance.now(), duration: 280 } : null;
  game.lane = next;
  if (!animate) game.visualX = laneX[next];
}
function cancelRabbitRequest(entry, reason) {
  if (entry.cancelReason || entry.finished) return;
  entry.cancelReason = reason; clearTimeout(entry.timer); entry.controller.abort(new DOMException(reason, 'AbortError'));
  if (game.running) game.nextCapture = performance.now();
}
function stopGarden() {
  for (const entry of rabbitRequests.values()) cancelRabbitRequest(entry, 'run ended');
  game.running = false; game.runId++; sweepToken++; benchmarkToken++; game.benchmark = false; $('rabbit-state').textContent = 'Paused'; controls();
}
function captureFrame() {
  const started = performance.now(), width = Number($('image-width').value), canvas = document.createElement('canvas'); canvas.width = width; canvas.height = Math.round(width * H / W); canvas.getContext('2d').drawImage($('garden'), 0, 0, canvas.width, canvas.height);
  const image = canvas.toDataURL('image/jpeg', 0.85); $('captured-frame').src = image; $('captured-frame').hidden = false; $('capture-placeholder').hidden = true;
  return { image, imageWidth: width, encodeMs: performance.now() - started, captured: started, capturedAt: new Date().toISOString() };
}
async function rabbitDecision(mode = 'trail', fixture = null) {
  const row = fixture?.row || game.rows.filter(r => !r.resolved && r.y < hitY).sort((a, b) => b.y - a.y)[0];
  if (!row) return;
  const capturedRunId = game.runId, lane = game.lane, speed = Number($('speed').value), seq = ++sequence;
  const deadlineMs = mode === 'trail' ? Math.max(0, (hitY - row.y) / speed * 1000) : null;
  const maxAgeMs = fixture ? 20000 : frameLifetimeMs(deadlineMs);
  if (maxAgeMs < 100) { game.skipped++; return; }
  const frame = captureFrame(); game.latestCapture = seq;
  $('rabbit-reply-status').textContent = `Frame #${seq} awaiting API · expires within ${ms(maxAgeMs)}.`;
  $('rabbit-confidence').textContent = 'Pending'; $('rabbit-last-rtt').textContent = 'Awaiting reply'; $('rabbit-last-processing').textContent = '—'; $('rabbit-last-paint').textContent = '—'; $('rabbit-last-deadline').textContent = ms(deadlineMs);
  const entry = { sequence: seq, capturedRunId, lane, row, mode, controller: new AbortController(), cancelReason: null, timer: null };
  entry.timer = setTimeout(() => cancelRabbitRequest(entry, 'frame expired'), Math.max(1, maxAgeMs - (performance.now() - frame.captured)));
  rabbitRequests.set(seq, entry);
  const sample = { mode, sequence: seq, capturedAt: frame.capturedAt, encodeMs: frame.encodeMs, imageWidth: frame.imageWidth, speed, deadlineMs, maxAgeMs, expected: fixture?.expected, capturedLane: lane, blockedLanes: row.blocked.slice(), rowId: row.id, intervalMs: Number($('interval').value), concurrency: Number($('concurrency').value) };
  game.pending++;
  try {
    const result = await post('/api/decision', { demo: 'rabbit', image: frame.image, maxAgeMs: Math.max(50, Math.ceil(maxAgeMs - (performance.now() - frame.captured))) }, { signal: entry.controller.signal }); entry.finished = true; clearTimeout(entry.timer); Object.assign(sample, result, { ok: true }); delete sample.budget;
    sample.correct = admissibleActions(lane, row.blocked).includes(result.choice);
    sample.rabbitPathCorrect = result.perceivedRabbitPath === String(lane + 1); sample.logPathCorrect = result.perceivedLogPath === String(row.blocked[0] + 1);
    if (fixture) {
      sample.correct = fixture.allowed.includes(result.choice);
      sample.expected = fixture.allowed.join('|');
      if (game.benchmark && capturedRunId === game.runId) { steer(result.choice, false); drawGarden(); sample.applied = true; }
    } else {
      const elapsed = performance.now() - frame.captured;
      sample.responseOnTime = elapsed < deadlineMs;
      sample.actionBudgetMs = result.choice === 'stay' ? 0 : 280; sample.onTime = elapsed + sample.actionBudgetMs < deadlineMs && elapsed < maxAgeMs && !entry.cancelReason;
      const fresh = isFreshDecision({ running: game.running, runId: game.runId, capturedRunId, currentLane: game.lane, capturedLane: lane, sequence: seq, lastAppliedSequence: game.lastApplied, rowResolved: row.resolved });
      if (fresh && sample.onTime && !game.jump) { steer(result.choice); game.lastApplied = seq; sample.applied = true; }
      else sample.stale = entry.cancelReason || (!game.running || capturedRunId !== game.runId ? 'run ended' : !sample.onTime || row.resolved ? 'deadline' : game.lane !== lane ? 'lane changed' : 'out of order');
    }
    if (sample.applied && game.runId === capturedRunId) { game.expiredStreak = 0; game.lastAppliedAt = performance.now(); game.lastAppliedChoice = result.choice; $('last-action').textContent = `${result.choice} · #${seq}`; }
    if (seq === game.latestCapture) { $('rabbit-reply-status').textContent = `Frame #${seq}: ${result.choice} · ${sample.applied ? 'APPLIED' : 'DISCARDED: ' + sample.stale} · ${ms(sample.roundTripMs)}.`; $('rabbit-confidence').textContent = sample.applied ? (Number.isFinite(result.confidence) ? pct(result.confidence) : 'Choice returned') : 'Discarded'; }
    if (sample.applied) { await paint(); sample.captureToPaintMs = performance.now() - frame.captured; }
    if (seq === game.latestCapture) { $('rabbit-last-rtt').textContent = ms(sample.roundTripMs); $('rabbit-last-processing').textContent = ms(sample.processingMs); $('rabbit-last-paint').textContent = ms(sample.captureToPaintMs); $('rabbit-last-deadline').textContent = ms(deadlineMs); }
  } catch (error) {
    const reason = entry.cancelReason || (error.status === 408 ? 'frame expired' : null);
    if (reason) {
      Object.assign(sample, { ok: false, cancelled: true, censored: true, stale: reason, observedWaitMs: performance.now() - frame.captured });
      if (['frame expired','row passed'].includes(reason)) {
        sample.onTime = false; sample.responseOnTime = false;
        if (game.running && game.runId === capturedRunId && ++game.expiredStreak >= 3) { stopGarden(); $('rabbit-state').textContent = 'Paused: API too slow'; toast('Three consecutive frames expired. The trail paused because no timely API decision arrived. Check the measured API response time before restarting.'); }
      }
      if (seq === game.latestCapture) { $('rabbit-reply-status').textContent = `Frame #${seq}: DISCARDED (${reason}) · waited ${ms(sample.observedWaitMs)}; no usable reply.`; $('rabbit-confidence').textContent = 'Discarded'; $('rabbit-last-rtt').textContent = 'No completed reply'; $('rabbit-last-paint').textContent = 'Not applied'; }
    } else { Object.assign(sample, { ok: false, status: error.status, roundTripMs: error.roundTripMs, observedWaitMs: error.observedWaitMs, error: error.message }); if ([401,402,403].includes(error.status)) stopGarden(); toast(error.message); }
  } finally { clearTimeout(entry.timer); rabbitRequests.delete(seq); game.pending--; addSample('rabbit', sample); }
  return sample;
}
async function visionBenchmark() {
  if (game.running || game.benchmark) return;
  game.benchmark = true; const token = ++benchmarkToken; game.runId++; controls(); $('rabbit-state').textContent = 'Benchmarking frozen frames';
  const oldWidth = $('image-width').value, fixtures = [[1,[1],['left','right']],[1,[0],['stay']],[1,[2],['stay']],[0,[0],['right']],[2,[2],['left']],[0,[2],['stay']]];
  let count = 0;
  for (const width of [240,384,640]) for (const [lane, blocked, allowed] of fixtures) {
    if (token !== benchmarkToken) break;
    $('image-width').value = width; game.lane = lane; game.visualX = laneX[lane]; game.jump = null; const row = makeRow(530, blocked); game.rows = [row]; drawGarden(); await paint();
    await rabbitDecision('vision-benchmark', { row, allowed }); count++; $('rabbit-progress').textContent = `Frozen-frame benchmark: ${count}/18 · ${width} px. Either safe adjacent jump is accepted.`;
  }
  $('image-width').value = oldWidth; game.benchmark = false; resetGarden(); $('rabbit-progress').textContent = `Benchmark finished: ${count} measured frames. Export data for per-resolution results.`; controls();
}
async function speedSweep() {
  if (game.running || game.benchmark) return;
  const token = ++sweepToken, original = $('speed').value;
  for (const speed of [80,160,320,640]) {
    if (token !== sweepToken) break;
    $('speed').value = speed; updateDials(); startGarden(); $('rabbit-progress').textContent = `Speed sweep: ${speed} px/s for 15 seconds. Pause ends the sweep.`;
    const end = performance.now() + 15000;
    while (performance.now() < end && token === sweepToken && game.running) await sleep(200);
    game.running = false; game.runId++;
  }
  if (token === sweepToken) { $('speed').value = original; updateDials(); $('rabbit-progress').textContent = 'Speed sweep finished. Export samples to compare deadlines and latency by speed.'; }
  controls(); $('rabbit-state').textContent = 'Paused';
}
async function emotionDecision(text, { mode = 'typed', expected, transcriptAt = performance.now(), voiceId = null } = {}) {
  const version = ++expression.version, seq = ++sequence; expression.pending = true; expression.lastDispatch = performance.now();
  const sample = { mode, sequence: seq, expected, capturedAt: new Date().toISOString(), inputCharacters: text.length };
  try {
    const result = await post('/api/decision', { demo: 'raccoon', text }); Object.assign(sample, result, { ok: true }); delete sample.budget;
    sample.correct = expected ? result.choice === expected : undefined;
    if (version === expression.version && (!voiceId || voice?.id === voiceId && !voice.ending)) { drawRaccoon(result.choice); sample.applied = true; await paint(); sample.captureToPaintMs = performance.now() - transcriptAt; }
    else sample.stale = 'superseded';
    $('emotion-confidence').textContent = Number.isFinite(result.confidence) ? pct(result.confidence) : 'Choice returned'; $('emotion-last-rtt').textContent = ms(sample.roundTripMs); $('emotion-last-paint').textContent = ms(sample.captureToPaintMs);
  } catch (error) { Object.assign(sample, { ok: false, status: error.status, roundTripMs: error.roundTripMs, error: error.message }); toast(error.message); if (voice && [401,402,403].includes(error.status)) endVoice(); }
  finally { if (version === expression.version) expression.pending = false; addSample('raccoon', sample); }
  return sample;
}
async function emotionBenchmark() {
  if (expression.benchmark) { expression.benchmark = false; return; }
  if (voice || expression.pending) return toast('End the conversation or wait for the current expression first.');
  expression.benchmark = true; $('emotion-benchmark').textContent = 'Stop benchmark'; $('emotion-send').disabled = true;
  let count = 0;
  for (const trial of SCRIPTED_TRIALS) {
    if (!expression.benchmark) break;
    $('emotion-text').value = trial.text; $('user-caption').textContent = trial.text; await emotionDecision(trial.text, { mode: 'expression-benchmark', expected: trial.expected }); count++; $('emotion-progress').textContent = `Scripted benchmark: ${count}/18 measured sentences.`;
  }
  expression.benchmark = false; $('emotion-benchmark').textContent = '18-sentence benchmark'; $('emotion-send').disabled = false; $('emotion-progress').textContent = `Benchmark finished: ${count} sentences. Export includes labels and measured timings.`;
}
function updateDials() {
  $('speed-value').textContent = `${$('speed').value} px/s · ${($('speed').value / 120).toFixed(1)}×`; $('spacing-value').textContent = `${$('spacing').value} px`; $('interval-value').textContent = `${$('interval').value} ms`; $('emotion-interval-value').textContent = `${$('emotion-interval').value} ms`;
}
function voiceEvent(v, event) {
  v.events.push({ type: event.type, atMs: performance.now() - v.started });
  if (event.type === 'session.started') {
    v.ready = true; v.readyResolve?.(); $('voice-state').textContent = 'Listening'; $('voice-startup').textContent = ms(performance.now() - v.started);
    v.channel.send(JSON.stringify({ type: 'session.instructions.append', event_id: crypto.randomUUID(), delegation_id: null, content: 'Greet the user briefly now, then listen.' }));
  }
  if (['session.input_transcript.delta','session.output_transcript.delta'].includes(event.type)) {
    const speaker = event.type.includes('input_') ? 'user' : 'assistant', delta = event.delta || '';
    v[speaker] += delta; v[speaker] = v[speaker].slice(-1800); $(speaker === 'user' ? 'user-caption' : 'assistant-caption').textContent = v[speaker];
    if (v.fragments.at(-1)?.speaker === speaker) v.fragments.at(-1).text += delta;
    else v.fragments.push({ speaker, text: delta });
    if (v.fragments.length > 70) v.fragments.shift(); v.dirty = true; v.transcriptAt = performance.now();
  }
  if (event.type === 'session.usage.updated') v.seconds = event.usage?.seconds || v.seconds;
  if (event.type === 'session.closed') { v.finalized = true; v.seconds = event.usage?.seconds ?? v.seconds; v.reason = event.reason; finishVoice(v); }
  if (event.type === 'error' || event.type === 'session.error') { toast(event.error?.message || 'Voice session error'); endVoice(); }
}
function finishVoice(v) {
  if (v.finished) return; v.finished = true; clearTimeout(v.closeTimer); clearTimeout(v.serverCloseTimer); clearInterval(v.tick);
  voiceRuns.push({ startedAt: v.startedAt, startupMs: v.ready ? v.events.find(x => x.type === 'session.started')?.atMs : null, seconds: v.seconds, finalized: !!v.finalized, reason: v.reason || 'unconfirmed', inputTranscriptCharacters: v.user.length, outputTranscriptCharacters: v.assistant.length, events: v.events });
  v.stream?.getTracks().forEach(track => track.stop()); v.channel?.close(); v.peer?.close(); $('voice-audio').srcObject = null;
  if (voice === v) voice = null; expression.version++; expression.pending = false;
  $('voice-start').disabled = false; $('voice-stop').disabled = true; $('voice-state').textContent = v.finalized ? 'Conversation ended' : 'Connection ended';
  $('voice-note').textContent = v.finalized ? `Session finalized · ${v.seconds.toFixed(1)} seconds · estimated voice cost $${(v.seconds * 0.05 / 60).toFixed(4)}.` : 'Final billed duration was not confirmed. The server retains a conservative reservation.'; refreshStatus();
}
async function endVoice() {
  const v = voice; if (!v || v.ending) return; v.ending = true; expression.version++; $('voice-state').textContent = 'Ending conversation…'; $('voice-stop').disabled = true;
  if (v.channel?.readyState === 'open') v.channel.send(JSON.stringify({ type: 'session.close' }));
  // Let the primary data channel receive final usage before falling back to forced hangup.
  if (v.id) v.serverCloseTimer = setTimeout(() => { if (!v.finished) post('/api/voice/end', { sessionId: v.id }).catch(error => { if (error.status !== 404) toast(error.message); }); }, 4000);
  v.closeTimer = setTimeout(() => finishVoice(v), 15000);
  if (!v.id) finishVoice(v);
}
async function startVoice() {
  if (voice || expression.benchmark) return;
  $('voice-start').disabled = true; $('voice-state').textContent = 'Connecting…';
  const v = { started: performance.now(), startedAt: new Date().toISOString(), id: null, events: [], fragments: [], user: '', assistant: '', seconds: 0, dirty: false, ending: false }; voice = v;
  try {
    v.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    if (v.ending) { finishVoice(v); return; }
    v.peer = new RTCPeerConnection(); v.stream.getTracks().forEach(track => v.peer.addTrack(track, v.stream));
    v.peer.ontrack = event => { $('voice-audio').srcObject = event.streams[0] || new MediaStream([event.track]); $('voice-audio').play().catch(() => toast('Use the audio play control to hear Maple.')); };
    v.channel = v.peer.createDataChannel('oai-events'); v.channel.onmessage = event => { try { voiceEvent(v, JSON.parse(event.data)); } catch { /* Unrecognized event data is not a transcript. */ } };
    v.channel.onclose = () => { if (!v.finished && !v.ending) endVoice(); };
    const readyPromise = new Promise((resolve, reject) => { v.readyResolve = resolve; v.readyReject = reject; });
    await v.peer.setLocalDescription(await v.peer.createOffer());
    if (v.peer.iceGatheringState !== 'complete') await new Promise((resolve, reject) => { const timeout = setTimeout(() => { v.peer.removeEventListener('icegatheringstatechange', changed); reject(new Error('WebRTC connection preparation timed out.')); }, 10000); function changed() { if (v.peer.iceGatheringState === 'complete') { clearTimeout(timeout); v.peer.removeEventListener('icegatheringstatechange', changed); resolve(); } } v.peer.addEventListener('icegatheringstatechange', changed); });
    const result = await post('/api/voice/session', { sdp: v.peer.localDescription.sdp }); v.id = result.session.id; v.maxSeconds = result.maxSeconds;
    await v.peer.setRemoteDescription({ type: 'answer', sdp: result.transport.sdp });
    let readyTimeout; await Promise.race([readyPromise, new Promise((_, reject) => readyTimeout = setTimeout(() => reject(new Error('Voice connection did not become ready.')), 15000))]).finally(() => clearTimeout(readyTimeout));
    $('voice-stop').disabled = false; $('voice-note').textContent = 'Speak naturally. Your microphone audio is sent to OpenAI. Maximum session length: two minutes.';
    v.tick = setInterval(() => { const seconds = (performance.now() - v.started) / 1000; $('voice-duration').textContent = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2,'0')}`; if (seconds >= v.maxSeconds) endVoice(); }, 250);
  } catch (error) { toast(error.message); if (v.id) post('/api/voice/end', { sessionId: v.id }).catch(() => {}); finishVoice(v); }
}
function animation(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
  if (game.running) {
    const speed = Number($('speed').value), spacing = Number($('spacing').value);
    game.distance += speed * dt; game.hop = Math.abs(Math.sin(game.distance / 24)) * 17;
    if (game.jump) { const progress = Math.min(1, (now - game.jump.started) / game.jump.duration), eased = progress * progress * (3 - 2 * progress); game.visualX = game.jump.from + (game.jump.to - game.jump.from) * eased; if (progress >= 1) game.jump = null; }
    for (const row of game.rows) { row.y += speed * dt; if (!row.resolved && row.y >= hitY) { row.resolved = true; const landedLane = game.jump ? laneX.reduce((best,x,lane)=>Math.abs(x-game.visualX)<Math.abs(laneX[best]-game.visualX)?lane:best,0) : game.lane; if (row.blocked.includes(landedLane)) { game.bumps++; game.flashUntil = now + 400; } else game.cleared++; } }
    game.rows = game.rows.filter(row => row.y < H + 150); const top = Math.min(...game.rows.map(row => row.y)); if (top > spacing - 120) game.rows.push(makeRow(top - spacing));
    for (const entry of rabbitRequests.values()) if (entry.mode === 'trail' && !entry.cancelReason && !entry.finished) { if (entry.row.resolved) cancelRabbitRequest(entry, 'row passed'); else if (entry.lane !== game.lane) cancelRabbitRequest(entry, 'lane changed'); }
    if (game.lastAppliedChoice && game.lastAppliedAt !== null) $('last-action').textContent = `${game.lastAppliedChoice} · ${((now - game.lastAppliedAt) / 1000).toFixed(1)}s ago`;
    $('cleared').textContent = game.cleared; $('bumps').textContent = game.bumps; drawGarden();
    if (now >= game.nextCapture) { game.nextCapture = now + Number($('interval').value); if (game.pending < Number($('concurrency').value) && !game.jump) rabbitDecision(); else game.skipped++; }
  }
  if (voice?.ready && !voice.ending && voice.dirty && !expression.pending && !expression.benchmark && now - expression.lastDispatch >= Number($('emotion-interval').value)) {
    voice.dirty = false;
    const text = voice.fragments.map(f => `${f.speaker === 'user' ? 'User' : 'Maple'}: ${f.text}`).join('\n').slice(-5500);
    emotionDecision(`Conversation fragments in chronological order. Choose a reaction to the latest words:\n${text}`, { mode: 'live-voice', transcriptAt: voice.transcriptAt, voiceId: voice.id });
  }
  requestAnimationFrame(animation);
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
  const tab = button.dataset.tab; document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === button)); document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === tab + '-pane'));
  $('page-title').textContent = tab === 'rabbit' ? 'A little hop. A fast decision.' : 'A soft face. A real reaction.'; $('page-subtitle').textContent = tab === 'rabbit' ? 'A cuddly rabbit finds its way through the garden, one screenshot at a time.' : 'Meet Maple, the raccoon who listens and wears a little emotion on its face.';
}));
for (const id of ['speed','spacing','interval','emotion-interval']) $(id).addEventListener('input', updateDials);
$('rabbit-start').addEventListener('click', startGarden); $('rabbit-stop').addEventListener('click', stopGarden); $('rabbit-reset').addEventListener('click', resetGarden); $('vision-benchmark').addEventListener('click', visionBenchmark); $('stress-sweep').addEventListener('click', speedSweep);
$('emotion-send').addEventListener('click', async () => { if (voice || expression.benchmark || expression.pending) return toast('End the conversation or wait for the current test first.'); const text = $('emotion-text').value.trim(); if (!text) return toast('Give Maple a sentence first.'); $('user-caption').textContent = text; $('emotion-send').disabled = true; await emotionDecision(text); $('emotion-send').disabled = false; });
$('emotion-benchmark').addEventListener('click', emotionBenchmark); $('voice-start').addEventListener('click', startVoice); $('voice-stop').addEventListener('click', endVoice);
document.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => exportData(b.dataset.export)));
document.addEventListener('visibilitychange', () => { if (document.hidden && game.running) { stopGarden(); $('rabbit-state').textContent = 'Paused while tab hidden'; } });
window.addEventListener('pagehide', () => { if (voice?.id) { const data = new Blob([JSON.stringify({ sessionId: voice.id })], { type: 'application/json' }); navigator.sendBeacon('/api/voice/end', data); } });
window.__lab = { samples, voiceRuns, game, expression, get voice() { return voice; }, summarize, visionBenchmark, emotionBenchmark, rabbitDecision, drawGarden, startGarden, stopGarden, resetGarden, startVoice, endVoice, get ready() { return ready; } };
if (location.pathname === "/maple.html") document.querySelector("[data-tab=raccoon]").click();
await refreshStatus();
try {
  await Promise.all([['garden','garden-background.png'],['sprites','garden-sprites.png'],['raccoon','raccoon-emotions.png']].map(([key,file]) => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => { assets[key] = image; resolve(); }; image.onerror = () => reject(new Error(`Artwork failed to load: ${file}`)); image.src = '/assets/' + file; })));
  assets.gardenTile = document.createElement('canvas'); assets.gardenTile.width = W; assets.gardenTile.height = H + 120; const tileContext = assets.gardenTile.getContext('2d'); tileContext.drawImage(assets.garden, 0, 0, W, H + 120); tileContext.globalCompositeOperation = 'destination-in'; const fade = tileContext.createLinearGradient(0, 0, 0, 120); fade.addColorStop(0, 'transparent'); fade.addColorStop(1, '#000'); tileContext.fillStyle = fade; tileContext.fillRect(0, 0, W, H + 120);
  ready = true; resetGarden(); drawRaccoon('neutral'); updateStats('rabbit'); updateStats('raccoon'); updateDials(); $('global-status').textContent = 'Artwork ready · calls are measured live'; controls();
} catch (error) { $('global-status').textContent = error.message; toast(error.message); }
requestAnimationFrame(animation);
