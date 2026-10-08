export const EMOTIONS = ['neutral', 'delighted', 'concerned', 'surprised', 'thoughtful', 'excited'];
export const EMOTION_DESCRIPTIONS = {
  neutral: 'Calm, routine, friendly listening; no strong emotional cue.',
  delighted: 'Warm happiness, appreciation, affection, or a pleasant outcome.',
  concerned: 'Empathetic worry or sadness in response to difficulty, loss, or distress.',
  surprised: 'An unexpected revelation or astonishment, without strong celebration.',
  thoughtful: 'Reflective curiosity, uncertainty, or considering a question.',
  excited: 'High-energy enthusiasm, celebration, anticipation, or a major achievement.',
};
export const SCRIPTED_TRIALS = [
  ['Good morning. I am just sitting here with a cup of tea.', 'neutral'],
  ['My garden finally has its first flowers. They look lovely.', 'delighted'],
  ['I lost my job today and I am really worried about what comes next.', 'concerned'],
  ['Wait, the little seed grew into a tree overnight? I did not expect that!', 'surprised'],
  ['I wonder whether we should plant strawberries or tomatoes. Let me think.', 'thoughtful'],
  ['WE DID IT! Our project launched and everyone is cheering! I cannot wait!', 'excited'],
  ['Could you sit with me while I read quietly for a minute?', 'neutral'],
  ['Thank you for being so kind. That made my day a little brighter.', 'delighted'],
  ['My friend is in hospital and I am frightened for her.', 'concerned'],
  ['A raccoon just opened the garden gate. That was completely unexpected.', 'surprised'],
  ['There are two possible explanations. I would like to consider them carefully.', 'thoughtful'],
  ['I just won the national competition! This is the best day ever!', 'excited'],
  ['The path is clear. We can continue at the usual pace.', 'neutral'],
  ['The bunny curled up beside me. Such a sweet peaceful moment.', 'delighted'],
  ['It has been a crazy week. Everything has gone wrong and I feel exhausted.', 'concerned'],
  ['You are telling me the bunny can steer itself? Really? That is astonishing!', 'surprised'],
  ['I am not sure which design would work best. What are the tradeoffs?', 'thoughtful'],
  ['Actually, it was crazy in a GOOD way. We launched today and a ton of people are celebrating!', 'excited'],
].map(([text, expected], index) => ({ id: `expression-${index + 1}`, text, expected }));

export function quantile(values, fraction) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = Math.max(0, Math.min(1, fraction)) * (sorted.length - 1);
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}

export function summarize(samples) {
  const ok = samples.filter(s => s.ok);
  const times = ok.map(s => s.roundTripMs).filter(Number.isFinite);
  const processing = ok.map(s => s.processingMs).filter(Number.isFinite);
  const deadlineSamples = samples.filter(s => typeof s.onTime === 'boolean');
  const labeled = ok.filter(s => s.expected);
  return {
    count: samples.length, successes: ok.length, errors: samples.filter(s => !s.ok && !s.cancelled).length,
    cancelled: samples.filter(s => s.cancelled).length, expired: samples.filter(s => s.cancelled && ['frame expired','row passed'].includes(s.stale)).length,
    applied: ok.filter(s => s.applied).length,
    stale: samples.filter(s => s.stale).length,
    p50: quantile(times, 0.5), p95: quantile(times, 0.95), p99: quantile(times, 0.99),
    mean: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
    min: times.length ? Math.min(...times) : null, max: times.length ? Math.max(...times) : null,
    processingP50: quantile(processing, 0.5), processingCount: processing.length,
    onTimeRate: deadlineSamples.length ? deadlineSamples.filter(s => s.onTime).length / deadlineSamples.length : null,
    labeledCount: labeled.length, accuracy: labeled.length ? labeled.filter(s => typeof s.correct === 'boolean' ? s.correct : s.choice === s.expected).length / labeled.length : null,
    inputTokens: ok.reduce((n, s) => n + (s.inputTokens || 0), 0),
    estimatedUsd: ok.reduce((n, s) => n + (s.estimatedUsd || 0), 0),
  };
}

export function targetLane(lane, choice) {
  const offset = { left: -1, stay: 0, right: 1 }[choice];
  if (!Number.isInteger(lane) || lane < 0 || lane > 2 || offset === undefined) throw new Error('Invalid steering action');
  return Math.max(0, Math.min(2, lane + offset));
}

export function admissibleActions(lane, blocked) {
  return ['left', 'stay', 'right'].filter(action => {
    const target = targetLane(lane, action);
    return (action === 'stay' || target !== lane) && !blocked.includes(target);
  });
}

export function mulberry32(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function isFreshDecision({ running, runId, capturedRunId, currentLane, capturedLane, sequence, lastAppliedSequence, rowResolved }) {
  return running && runId === capturedRunId && currentLane === capturedLane && sequence > lastAppliedSequence && !rowResolved;
}

export function csvFor(samples) {
  const columns = ['demo', 'mode', 'sequence', 'capturedAt', 'choice', 'expected', 'correct', 'ok', 'status', 'roundTripMs', 'observedWaitMs', 'cancelled', 'censored', 'maxAgeMs', 'apiMs', 'processingMs', 'encodeMs', 'captureToPaintMs', 'deadlineMs', 'onTime', 'responseOnTime', 'actionBudgetMs', 'applied', 'stale', 'speed', 'imageWidth', 'inputTokens', 'estimatedUsd', 'controller', 'perceivedRabbitPath', 'perceivedLogPath', 'rabbitPathCorrect', 'logPathCorrect'];
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [columns.join(','), ...samples.map(s => columns.map(c => quote(s[c])).join(','))].join('\r\n');
}

export function frameLifetimeMs(deadlineMs, maxAgeMs = 1000) {
  return Math.max(0, Math.min(maxAgeMs, Number.isFinite(deadlineMs) ? deadlineMs : maxAgeMs));
}

export function visibleRows(rows) { return rows.filter(row => !row.resolved); }
