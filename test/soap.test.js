'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  buildEnvelope, soapAction, parseFault, escapeXml, decodeEntities, parseAttributes,
} = require('../lib/soap');
const { FAULT_402 } = require('./fixtures');

test('bygger en konvolutt med argumentene i oppgitt rekkefølge', () => {
  const xml = buildEnvelope('AlarmClock:1', 'UpdateAlarm', [
    ['ID', '575'],
    ['StartLocalTime', '07:30:00'],
  ]);
  assert.ok(xml.indexOf('<ID>575</ID>') < xml.indexOf('<StartLocalTime>07:30:00</StartLocalTime>'));
  assert.ok(xml.includes('xmlns:u="urn:schemas-upnp-org:service:AlarmClock:1"'));
});

test('SOAPACTION-headeren har riktig form', () => {
  assert.strictEqual(
    soapAction('AlarmClock:1', 'ListAlarms'),
    '"urn:schemas-upnp-org:service:AlarmClock:1#ListAlarms"',
  );
});

test('escaper argumentverdier', () => {
  const xml = buildEnvelope('AlarmClock:1', 'CreateAlarm', [['ProgramURI', 'a&b<c']]);
  assert.ok(xml.includes('a&amp;b&lt;c'));
});

test('leser UPnP-feilkoden ut av en 500-respons', () => {
  const fault = parseFault(FAULT_402);
  assert.strictEqual(fault.code, 402);
  assert.match(fault.message, /argument/i);
});

test('gir null når det ikke er noen feil i svaret', () => {
  assert.strictEqual(parseFault('<Envelope>alt bra</Envelope>'), null);
  assert.strictEqual(parseFault(''), null);
});

test('dekoder entiteter uten å bryte dobbeltescaping', () => {
  assert.strictEqual(decodeEntities('&amp;lt;'), '&lt;');
  assert.strictEqual(decodeEntities('a &amp; b'), 'a & b');
  assert.strictEqual(decodeEntities('&quot;x&quot;'), '"x"');
});

test('escape og decode er hverandres motsats', () => {
  const original = `a&b<c>d"e'f`;
  assert.strictEqual(decodeEntities(escapeXml(original)), original);
});

test('plukker attributter ut av en tagg', () => {
  const attributes = parseAttributes(' ID="12" Enabled="1" ZoneName="Stue &amp; kjøkken"');
  assert.strictEqual(attributes.ID, '12');
  assert.strictEqual(attributes.Enabled, '1');
  assert.strictEqual(attributes.ZoneName, 'Stue & kjøkken');
});
