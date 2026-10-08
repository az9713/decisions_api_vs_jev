import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
try { process.loadEnvFile('.env'); } catch {}
const key = process.env.OPENAI_API_KEY;
if (!key) { console.log(JSON.stringify({ keyPresent: false })); process.exit(1); }
const report = { checkedAt: new Date().toISOString(), keyPresent: true };
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
try {
  const start = performance.now();
  const response = await fetch('https://api.openai.com/v1/decisions', {
    method: 'POST', headers, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ model: 'gpt-6-luna', input: 'I am delighted that our garden is blooming.', questions: [{ type: 'choice', name: 'expression', instructions: 'Select the appropriate friendly reaction.', choices: [{ value: 'happy', description: 'Delighted or positive.' }, { value: 'concerned', description: 'Worried or negative.' }] }] }),
  });
  const body = await response.json();
  report.decisions = { status: response.status, roundTripMs: Math.round(performance.now() - start), model: body.model, choice: body.answers?.[0]?.choice, usage: body.usage, errorType: body.error?.type, errorCode: body.error?.code, errorParam: body.error?.param };
  if (response.ok) report.decisions.processingHeaderMs = response.headers.get('openai-processing-ms');
} catch (error) { report.decisions = { transportError: error.name, code: error.cause?.code }; }
try {
  const response = await fetch('https://api.openai.com/v1/models', { headers, signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  report.models = { status: response.status, decisionsModelListed: body.data?.some(m => m.id === 'gpt-6-luna') ?? false, liveModelListed: body.data?.some(m => m.id === 'gpt-live-1') ?? false, errorType: body.error?.type, errorCode: body.error?.code };
} catch (error) { report.models = { transportError: error.name, code: error.cause?.code }; }
await mkdir('evidence', { recursive: true });
await writeFile('evidence/access-probe.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
