import http from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import { postPayload, ENGINES } from './public/postoffice-core.mjs';
import { Budget } from './lib/budget.mjs';
import { EMOTIONS, EMOTION_DESCRIPTIONS } from './public/core.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(ROOT, 'public');
export const DECISION_RATE = 0.10 / 1_000_000;
export const VOICE_RATE = 0.05 / 60;
const MAX_VOICE_SECONDS = 120;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

function json(response, status, body) {
  if (response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
async function readJson(request, limit = 1_500_000) {
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}
function providerError(status, body) {
  const code = body?.error?.code || body?.error?.type || 'provider_error';
  return Object.assign(new Error(`OpenAI returned HTTP ${status} (${String(code).replace(/[^a-z0-9_-]/gi, '').slice(0,80)}).`), { status: status >= 400 && status < 600 ? status : 502, providerCode: code });
}

export function decisionPayload(body) {
  if (body.demo === 'postoffice') return postPayload(body);
  if (body.demo === 'raccoon') {
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 6000) throw Object.assign(new Error('A conversation excerpt of 1–6000 characters is required.'), { status: 400 });
    return { model: 'gpt-6-luna', input: body.text, questions: [{ type: 'choice', name: 'expression', instructions: 'Choose the most appropriate visible reaction for a warm, friendly raccoon companion to the latest words in this conversation. Respect corrections such as "crazy in a good way". Select a reaction, not a diagnosis of the speaker. Use neutral for routine conversation; reserve excited for strong celebration or enthusiasm.', choices: EMOTIONS.map(value => ({ value, description: EMOTION_DESCRIPTIONS[value] })) }] };
  }
  if (body.demo === 'rabbit') {
    if (typeof body.image !== 'string' || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(body.image) || body.image.length > 1_400_000) throw Object.assign(new Error('An inline PNG or JPEG game frame is required.'), { status: 400 });
    return { model: 'gpt-6-luna', input: [{ role: 'user', content: [{ type: 'input_text', text: 'Three parallel garden paths: 1 is LEFT, 2 is CENTER, 3 is RIGHT. A white rabbit is near the bottom. Brown logs approach from above.' }, { type: 'input_image', image_url: body.image }] }], questions: [
      { type: 'choice', name: 'rabbit_path', instructions: 'Which path is the WHITE RABBIT on? Use its horizontal position and visible Path badge.', choices: [{ value: '1', description: 'The rabbit is on the LEFT path.' }, { value: '2', description: 'The rabbit is on the CENTER path.' }, { value: '3', description: 'The rabbit is on the RIGHT path.' }] },
      { type: 'choice', name: 'log_path', instructions: 'Which path contains the closest BROWN LOG ABOVE the white rabbit? Ignore logs below the rabbit.', choices: [{ value: '1', description: 'The nearest approaching brown log is on the LEFT path.' }, { value: '2', description: 'The nearest approaching brown log is on the CENTER path.' }, { value: '3', description: 'The nearest approaching brown log is on the RIGHT path.' }, { value: 'none', description: 'There is no brown log above the rabbit.' }] }
    ] };
  }
  throw Object.assign(new Error('Unknown demo'), { status: 400 });
}

export function steeringFromPerception(answers) {
  const rabbit = answers.find(a => a.name === 'rabbit_path');
  const log = answers.find(a => a.name === 'log_path');
  if (rabbit?.type !== 'choice' || log?.type !== 'choice' || !['1','2','3'].includes(rabbit.choice) || !['1','2','3','none'].includes(log.choice)) throw Object.assign(new Error('The API did not return valid visual path choices.'), { status: 422 });
  // This fixed policy has no access to game lane/obstacle state. Both positions come from the API image answers.
  const choice = rabbit.choice !== log.choice ? 'stay' : rabbit.choice === '1' ? 'right' : 'left';
  return { choice, perceivedRabbitPath: rabbit.choice, perceivedLogPath: log.choice, confidence: Math.min(rabbit.confidence ?? 0, log.confidence ?? 0), probabilities: { rabbit: rabbit.probabilities || [], log: log.probabilities || [] } };
}

export async function createDemoServer({ key, gatewayKey, port = 3087, fetchImpl = fetch, dataDir = resolve(ROOT, 'data'), attachVoice = true, budgetCap = 5 } = {}) {
  let probeCost = 0;
  try { probeCost = JSON.parse(await readFile(resolve(ROOT, 'evidence/access-probe.json'), 'utf8')).decisions.usage.input_tokens * DECISION_RATE; } catch {}
  const budget = await new Budget(resolve(dataDir, 'budget.jsonl'), budgetCap, probeCost).load();
  let inFlight = 0; let requests = 0; let errors = 0; let cancelledRequests = 0; let voiceStarting = false; const sessions = new Map();
  const origins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  const log = async entry => { await mkdir(dataDir, { recursive: true }); await appendFile(resolve(dataDir, 'requests.jsonl'), JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n'); };
  async function hangup(id) {
    const session = sessions.get(id);
    if (!session || session.ending) return;
    session.ending = true;
    if (session.socket?.readyState === WebSocket.OPEN) {
      session.socket.send(JSON.stringify({ type: 'session.close' }));
      await new Promise(resolveDrain => setTimeout(resolveDrain, 3000));
      if (!sessions.has(id)) return;
    }
    try {
      const r = await fetchImpl(`https://api.openai.com/v1/live/sessions/${encodeURIComponent(id)}/hangup`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
      await log({ kind: 'voice-hangup', status: r.status });
    } catch { await log({ kind: 'voice-hangup', status: 'transport_error' }); }
    // Only session.closed establishes final billed duration. Retain the reservation if finalization is unknown.
    setTimeout(() => { session.socket?.close(); clearTimeout(session.timer); sessions.delete(id); }, 12000).unref();
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const host = request.headers.host;
      if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) return json(response, 403, { error: 'Unexpected host' });
      const url = new URL(request.url, `http://${host}`);
      if (request.method === 'GET' && url.pathname === '/api/status') return json(response, 200, { keyConfigured: !!key, gatewayConfigured: !!gatewayKey, comparisonModels: ENGINES, model: 'gpt-6-luna', voiceModel: 'gpt-live-1', budget: budget.summary(), inFlight, requests, errors, cancelledRequests, maxVoiceSeconds: MAX_VOICE_SECONDS, pricing: { decisionsPerMillionInputTokens: 0.10, voicePerMinute: 0.05 }, retries: 0 });
      if (request.method === 'GET') {
        const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        const target = resolve(PUBLIC, '.' + relative);
        if (!target.startsWith(PUBLIC + sep) || !MIME[extname(target)] || relative.split('/').some(part => part.startsWith('.'))) return json(response, 404, { error: 'Not found' });
        try { const content = await readFile(target); response.writeHead(200, { 'Content-Type': MIME[extname(target)], 'Cache-Control': 'no-cache' }); return response.end(content); }
        catch { return json(response, 404, { error: 'Not found' }); }
      }
      if (request.method !== 'POST' || !origins.has(request.headers.origin)) return json(response, 403, { error: 'Unexpected request origin' });
      if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: 'JSON required' });
      if (url.pathname === '/api/decision') {
        const body = await readJson(request);
        const payload = decisionPayload(body);
        const isPost = body.demo === 'postoffice';
        const credential = isPost ? gatewayKey : key;
        if (!credential) return json(response, 503, { error: isPost ? 'No Vercel AI Gateway key is configured.' : 'No OpenAI API key is configured.' });
        const requestLimitMs = body.demo === 'rabbit' && body.maxAgeMs !== undefined ? body.maxAgeMs : 20000;
        if (!Number.isFinite(requestLimitMs) || requestLimitMs < 50 || requestLimitMs > 20000) return json(response, 400, { error: 'Frame lifetime must be between 50 and 20000 ms.' });
        if (inFlight >= 6) return json(response, 429, { error: 'Six requests are already in flight. Reduce concurrency.' });
        inFlight++;
        let reservation;
        try { reservation = await budget.reserve(0.02, body.demo); } catch (error) { inFlight--; throw error; }
        requests++; const start = performance.now();
        const disconnected = new AbortController();
        const onDisconnect = () => { if (!response.writableFinished) disconnected.abort(new DOMException('Client disconnected', 'AbortError')); };
        response.on('close', onDisconnect);
        if (response.destroyed) onDisconnect();
        const providerSignal = AbortSignal.any([disconnected.signal, AbortSignal.timeout(Math.ceil(requestLimitMs))]);
        try {
          const r = await fetchImpl(isPost ? 'https://ai-gateway.vercel.sh/v1/decisions' : 'https://api.openai.com/v1/decisions', { method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, body: JSON.stringify(isPost ? { ...payload, providerOptions: { gateway: { only: [body.engine === 'jev' ? 'typesafe-ai' : 'openai'] } } } : payload), signal: providerSignal });
          const result = await r.json();
          const apiMs = performance.now() - start;
          if (!r.ok) { await budget.settle(reservation, 0, body.demo); throw providerError(r.status, result); }
          const inputTokens = result.usage?.input_tokens;
          const gateway = result.provider_metadata?.gateway;
          const reportedCost = gateway?.cost;
          const gatewayCost = reportedCost !== undefined && reportedCost !== null && Number.isFinite(Number(reportedCost)) && Number(reportedCost) >= 0 ? Number(reportedCost) : null;
          const knownUsage = Number.isFinite(inputTokens) && inputTokens >= 0;
          const rate = isPost && body.engine === 'jev' ? 0.042 / 1_000_000 : DECISION_RATE;
          const estimatedUsd = gatewayCost ?? (knownUsage ? inputTokens * rate : null);
          if (estimatedUsd !== null) await budget.settle(reservation, estimatedUsd, body.demo);
          const answer = body.demo === 'rabbit' ? { type: 'choice', ...steeringFromPerception(result.answers || []) } : result.answers?.find(a => a.name === payload.questions[0].name);
          const allowed = body.demo === 'rabbit' ? ['left','stay','right'] : payload.questions[0].choices.map(c => c.value);
          const header = r.headers.get('openai-processing-ms');
          const processingMs = header !== null && Number.isFinite(Number(header)) ? Number(header) : null;
          const record = { kind: body.demo, status: r.status, apiMs, processingMs, model: result.model || payload.model, inputTokens, estimatedUsd, choice: answer?.choice, answerType: answer?.type, perceivedRabbitPath: answer?.perceivedRabbitPath, perceivedLogPath: answer?.perceivedLogPath, engine: isPost ? body.engine : undefined, gateway: isPost ? gateway : undefined, costSource: gatewayCost !== null ? 'gateway' : knownUsage ? 'token-estimate' : 'unknown', controller: body.demo === 'rabbit' ? 'image-path-classification-v1' : isPost ? 'mailbox-choice-v1' : 'expression-choice-v1', requestId: r.headers.get('x-request-id'), usageKnown: knownUsage };
          await log(record);
          if (answer?.type !== 'choice' || !allowed.includes(answer.choice)) throw Object.assign(new Error(answer?.type === 'refusal' ? 'The model refused this decision.' : 'The API did not return a valid choice.'), { status: 422 });
          return json(response, 200, { ...record, choice: answer.choice, confidence: answer.confidence ?? null, probabilities: answer.probabilities ?? [], budget: budget.summary() });
        } catch (error) {
          const cancelled = providerSignal.aborted;
          if (cancelled) cancelledRequests++; else errors++;
          const status = cancelled ? (disconnected.signal.aborted ? 499 : 408) : error.status || 502;
          await log({ kind: body.demo, status, observedWaitMs: performance.now() - start, cancelled, censored: true, error: error.providerCode || error.name });
          // A timed-out request may have been billed: its reservation stays charged against the cap.
          return json(response, status, { error: cancelled ? 'Frame expired or its client disconnected.' : error.status ? error.message : 'The API request failed or timed out.', budget: budget.summary() });
        } finally { response.removeListener('close', onDisconnect); inFlight--; }
      }
      if (url.pathname === '/api/voice/session') {
        if (!key) return json(response, 503, { error: 'No OpenAI API key is configured.' });
        if (sessions.size || voiceStarting) return json(response, 409, { error: 'A voice session is already active or connecting. End it first.' });
        const body = await readJson(request, 65536);
        if (typeof body.sdp !== 'string' || !body.sdp.startsWith('v=0') || body.sdp.length > 60000) return json(response, 400, { error: 'A valid WebRTC SDP offer is required.' });
        if (sessions.size || voiceStarting) return json(response, 409, { error: 'A voice session is already active or connecting.' });
        voiceStarting = true;
        let reservation;
        try { reservation = await budget.reserve(0.15, 'voice'); } catch (error) { voiceStarting = false; throw error; }
        const start = performance.now();
        try {
          const r = await fetchImpl('https://api.openai.com/v1/live/sessions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000), body: JSON.stringify({ session: { model: 'gpt-live-1', instructions: 'You are Maple, a warm, playful, cuddly raccoon companion. Have a natural friendly conversation. Respond briefly, usually one or two sentences. React with empathy to hard news and enthusiasm to good news. Listen for corrections and changes of mood. Do not say stage directions or expression names. Do not delegate ordinary friendly conversation. Do not use external tools.', delegation: { type: 'client' }, store: false }, transport: { type: 'webrtc', sdp: body.sdp } }) });
          const result = await r.json();
          if (!r.ok) { await budget.settle(reservation, 0, 'voice'); throw providerError(r.status, result); }
          if (!result.session?.id || !result.transport?.sdp) throw new Error('Invalid voice session response');
          const id = result.session.id;
          const session = { reservation, seconds: 0, ending: false, socket: null, timer: setTimeout(() => hangup(id), MAX_VOICE_SECONDS * 1000) };
          session.timer.unref(); sessions.set(id, session);
          if (attachVoice) {
            const socket = new WebSocket(`wss://api.openai.com/v1/live/sessions/${encodeURIComponent(id)}/attach`, { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 10000 });
            session.socket = socket;
            socket.on('error', () => { log({ kind: 'voice-sideband', status: 'error' }).catch(() => {}); });
            socket.on('message', async data => {
              try {
                const event = JSON.parse(data.toString());
                if (event.type === 'session.usage.updated') session.seconds = event.usage?.seconds || session.seconds;
                if (event.type === 'session.closed') {
                  clearTimeout(session.timer);
                  const seconds = event.usage?.seconds;
                  if (Number.isFinite(seconds)) await budget.settle(reservation, seconds * VOICE_RATE, 'voice');
                  await log({ kind: 'voice-final', seconds: seconds ?? session.seconds, finalized: true, usageKnown: Number.isFinite(seconds), reason: event.reason });
                  socket.close(); sessions.delete(id);
                }
              } catch { /* Ignore malformed sideband events without logging sensitive content. */ }
            });
          }
          await log({ kind: 'voice-start', status: 201, startupApiMs: performance.now() - start });
          return json(response, 201, { session: result.session, transport: result.transport, maxSeconds: MAX_VOICE_SECONDS, startupApiMs: performance.now() - start, budget: budget.summary() });
        } catch (error) { return json(response, error.status || 502, { error: error.status ? error.message : 'Voice session creation failed.', budget: budget.summary() }); }
        finally { voiceStarting = false; }
      }
      if (url.pathname === '/api/voice/end') {
        const body = await readJson(request, 2048);
        if (typeof body.sessionId !== 'string' || !sessions.has(body.sessionId)) return json(response, 404, { error: 'No active session with this ID.' });
        await hangup(body.sessionId);
        return json(response, 200, { closing: true });
      }
      return json(response, 404, { error: 'Not found' });
    } catch (error) { return json(response, error.status || 500, { error: error.status ? error.message : 'Server error' }); }
  });
  return { server, budget, sessions, async close() { await Promise.all([...sessions.keys()].map(hangup)); for (const session of sessions.values()) { clearTimeout(session.timer); session.socket?.terminate(); } await new Promise(resolveClose => server.close(resolveClose)); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(resolve(ROOT, '.env')); } catch {}
  const port = Number(process.env.PORT || 3087);
  const demo = await createDemoServer({ key: process.env.OPENAI_API_KEY, gatewayKey: process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_AI_GATEWAY_KEY, port });
  demo.server.listen(port, '127.0.0.1', () => console.log(`Cuddly Decisions Lab: http://localhost:${port} · $5 API cap · key configured: ${!!process.env.OPENAI_API_KEY}`));
  const stop = async () => { await demo.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
