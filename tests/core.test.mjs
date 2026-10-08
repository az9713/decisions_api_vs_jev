import test from 'node:test';
import assert from 'node:assert/strict';
import { quantile, summarize, targetLane, admissibleActions, isFreshDecision, frameLifetimeMs, visibleRows, csvFor } from '../public/core.mjs';
test('latency summaries exclude failed calls and missing provider headers', () => {
  const s = summarize([{ok:true,roundTripMs:100,processingMs:30,expected:'left',choice:'left',onTime:true,applied:true,inputTokens:20},{ok:true,roundTripMs:300,processingMs:null,expected:'right',choice:'stay',onTime:false,stale:'deadline'},{ok:false,roundTripMs:9000}]);
  assert.equal(s.p50,200); assert.equal(s.p95,290); assert.equal(s.processingP50,30); assert.equal(s.processingCount,1); assert.equal(s.accuracy,.5); assert.equal(s.onTimeRate,.5); assert.equal(s.errors,1); assert.equal(s.stale,1); assert.equal(quantile([], .95),null);
});
test('steering obeys boundaries and labels do not accept clamped invalid moves', () => {
  assert.equal(targetLane(0,'left'),0); assert.equal(targetLane(2,'right'),2); assert.deepEqual(admissibleActions(0,[0,2]),['right']); assert.deepEqual(admissibleActions(1,[0,2]),['stay']); assert.throws(()=>targetLane(1,'jump'));
});
test('late, out-of-order, previous-run, and changed-lane replies cannot steer', () => {
  const valid = {running:true,runId:3,capturedRunId:3,currentLane:1,capturedLane:1,sequence:9,lastAppliedSequence:8,rowResolved:false};
  assert.equal(isFreshDecision(valid),true);
  for (const change of [{running:false},{runId:4},{currentLane:2},{sequence:7},{rowResolved:true}]) assert.equal(isFreshDecision({...valid,...change}),false);
});
test('CSV quotes embedded delimiters and preserves zero measurements', () => { const csv = csvFor([{mode:'a,"b',roundTripMs:0}]); assert.ok(csv.includes('"a,""b"')); assert.ok(csv.includes('"0"')); });
test('frame lifetime is bounded by both useful obstacle time and one-second freshness', () => {
  assert.equal(frameLifetimeMs(14944),1000);assert.equal(frameLifetimeMs(300),300);assert.equal(frameLifetimeMs(-10),0);
});
test('resolved logs are excluded from the rendered image', () => {
  assert.deepEqual(visibleRows([{id:16,resolved:true},{id:17,resolved:false}]).map(row=>row.id),[17]);
});
test('cancelled waits remain separate from completed latency percentiles and errors', () => {
  const result=summarize([{ok:true,roundTripMs:150,onTime:true},{ok:false,cancelled:true,censored:true,stale:'frame expired',observedWaitMs:1000,onTime:false}]);
  assert.equal(result.p95,150);assert.equal(result.cancelled,1);assert.equal(result.expired,1);assert.equal(result.errors,0);assert.equal(result.stale,1);assert.equal(result.onTimeRate,.5);
});
