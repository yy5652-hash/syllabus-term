// Checks that Firestore rules refuse bad run records. Usage: KEY=<web API key> node scripts/rules_probe.mjs
// Every line must print 403.
const key = process.env.KEY, P = 'buildhybridai-term', B = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;
const s = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })).json();
const H = { 'content-type': 'application/json', authorization: `Bearer ${s.idToken}` };
const base = { uid: { stringValue: s.localId }, charsTotal: { integerValue: '100' }, charsSent: { integerValue: '10' }, gradingSource: { stringValue: 'on_device' }, datesSource: { stringValue: 'in_cloud' }, gradingOk: { booleanValue: true }, datesOk: { booleanValue: true }, escalated: { integerValue: '1' }, repaired: { integerValue: '0' }, ms: { integerValue: '5000' }, sample: { booleanValue: true }, version: { stringValue: 'rules-test' } };
const write = async (name, fields, headers = H, ts = true) => {
  const body = { writes: [{ update: { name: `projects/${P}/databases/(default)/documents/runs/probe-${name}-${Date.now()}`, fields }, currentDocument: { exists: false }, ...(ts ? { updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }] } : {}) }] };
  console.log(name.padEnd(14), (await fetch(`${B}:commit`, { method: 'POST', headers, body: JSON.stringify(body) })).status);
};
await write('extra-field', { ...base, syllabus: { stringValue: 'text' } });
await write('other-uid', { ...base, uid: { stringValue: 'someone-else' } });
await write('sent>total', { ...base, charsSent: { integerValue: '500' } });
await write('client-time', { ...base, at: { timestampValue: '2020-01-01T00:00:00Z' } }, H, false);
await write('no-auth', base, { 'content-type': 'application/json' });
const first = (await (await fetch(`${B}/runs?pageSize=1`, { headers: H })).json()).documents?.[0];
if (first) console.log('delete'.padEnd(14), (await fetch(`https://firestore.googleapis.com/v1/${first.name}`, { method: 'DELETE', headers: H })).status);
