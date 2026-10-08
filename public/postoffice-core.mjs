import { quantile } from './core.mjs';
export const ENGINES = { decisions: 'openai/gpt-6-luna-decisions', jev: 'typesafe-ai/jev' };
export const QUEUES = ['billing','technical','sales','review'];
export const ROUTING_QUESTION = { type:'choice', name:'queue', instructions:'Route the current request to one mailbox. Billing handles payments, refunds, invoices, cancellations and subscription charges. Technical handles broken products, errors, login failures and outages. Sales handles buying, plans, demos, quotes and upgrades. Review handles unclear requests, unrelated messages or messages with multiple equally active intents. Explicit corrections supersede earlier words. If the sender clearly specifies a single current request, use it.', choices:[
{value:'billing',description:'Payments, invoices, refunds, cancellations and subscription charges.'},
{value:'technical',description:'Broken products, errors, login failures and service outages.'},
{value:'sales',description:'Purchasing, product demos, quotes, plans and upgrades.'},
{value:'review',description:'Unclear, unrelated or multiple equally active requests.'}
]};
export const CASES = [
['Please refund the duplicate charge on my invoice.','billing'],
['I cannot log in. The reset link gives error 503.','technical'],
['Can you send a quote for twenty seats?','sales'],
['Hello there.','review'],
['Cancel my subscription at the end of this month.','billing'],
['The dashboard crashes whenever I upload a photo.','technical'],
['We would like a demonstration before purchasing.','sales'],
['Can you help with the thing from yesterday?','review'],
['My card was charged twice. Please fix the payment.','billing'],
['The service is down for everyone on our team.','technical'],
['What features are included in the enterprise plan?','sales'],
['Please fix my login AND refund my invoice. Both are equally urgent.','review'],
['I do not need a demo. I need a copy of my paid invoice.','billing'],
['I am not asking for a refund. The app keeps freezing.','technical'],
['Our login works fine. We want to buy ten more seats.','sales'],
['The weather in my garden is beautiful today.','review'],
['Earlier I asked about upgrades. Actually, my current request is to cancel my subscription.','billing'],
['Earlier I mentioned an invoice. Ignore that: my only current request is to fix the broken export button.','technical'],
['Earlier I reported a crash; it is resolved. Now I want a quote for a larger plan.','sales'],
['I need both a product demo and a refund. Neither request takes priority.','review'],
['Where can I update the card used to pay my subscription?','billing'],
['The export file is empty even though the dashboard has data.','technical'],
['Is a trial available for a potential new customer?','sales'],
['Please tell me what to do. I have not described my problem yet.','review']
].map(([text,expected],i)=>({id:'letter-'+(i+1),text,expected}));
export function postPayload(body) {
 if (!Object.hasOwn(ENGINES,body.engine) || typeof body.text!=='string' || !body.text.trim() || body.text.length>12000) throw Object.assign(new Error('Choose a valid engine and provide 1–12000 text characters.'),{status:400});
 return {model:ENGINES[body.engine],input:body.text,questions:[ROUTING_QUESTION]};
}
export function postSummary(samples) {
 const ok=samples.filter(s=>s.ok), labeled=samples.filter(s=>s.expected), times=ok.map(s=>s.roundTripMs);
 return {count:samples.length,completed:ok.length,errors:samples.filter(s=>!s.ok&&!s.skipped).length,skipped:samples.filter(s=>s.skipped).length,
 p50:quantile(times,.5),p95:quantile(times,.95),p99:quantile(times,.99),
 accuracy:labeled.length?labeled.filter(s=>s.ok&&s.choice===s.expected).length/labeled.length:null,
 timelyCorrect:labeled.length?labeled.filter(s=>s.ok&&s.choice===s.expected&&s.onTime).length/labeled.length:null,
 late:ok.filter(s=>!s.onTime).length,inputTokens:samples.reduce((n,s)=>n+(s.inputTokens||0),0),
 cost:samples.reduce((n,s)=>n+(s.estimatedUsd||0),0),unknownCost:samples.filter(s=>!s.skipped&&!Number.isFinite(s.estimatedUsd)).length};
}
