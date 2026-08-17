'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  buildEnvelope, soapAction, parseFault, hasFault, escapeXml, decodeEntities, parseAttributes,
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

test('dekoder numeriske referanser i begge former', () => {
  // Sonos bruker desimal, men titler som kommer videre fra en strømmetjeneste
  // dukker også opp heksadesimalt.
  assert.strictEqual(decodeEntities('Rock &#38; Roll'), 'Rock & Roll');
  assert.strictEqual(decodeEntities('Rock &#x26; Roll'), 'Rock & Roll');
  assert.strictEqual(decodeEntities('It&#x2019;s'), 'It’s');
  assert.strictEqual(decodeEntities('It&#X2019;s'), 'It’s');
});

test('tegn over 0xFFFF overlever dekodingen', () => {
  // fromCharCode kuttet en emoji til ett feil tegn. Navnet er nøkkelen
  // alarmkilden slås opp på, så et ødelagt navn gjør spillelista uvelgbar.
  assert.strictEqual(decodeEntities('Morgen &#128512;'), 'Morgen \u{1F600}');
  assert.strictEqual(decodeEntities('Morgen &#x1F600;'), 'Morgen \u{1F600}');
  assert.strictEqual([...decodeEntities('&#128512;')].length, 1);
});

test('ugyldig numerisk referanse blir stående i stedet for å kaste', () => {
  assert.strictEqual(decodeEntities('&#1114112;'), '&#1114112;');
  assert.strictEqual(decodeEntities('&#x110000;'), '&#x110000;');
});

test('alle tegnene som må escapes overlever en rundtur gjennom konvolutten', () => {
  const nasty = `Tor & Kari <"Morgen"> 'sang' — æøå 日本語 \u{1F600}`;
  const xml = buildEnvelope('AlarmClock:1', 'CreateAlarm', [['ProgramMetaData', nasty]]);

  // Ingen rå metategn igjen inne i verdien: da ville konvolutten vært ugyldig XML.
  const value = /<ProgramMetaData>([\s\S]*)<\/ProgramMetaData>/.exec(xml)[1];
  assert.ok(!/[<>]/.test(value));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(value));
  assert.strictEqual(decodeEntities(value), nasty);
});

test('en allerede escapet DIDL-blob dobbeltescapes og kommer hel tilbake', () => {
  // Slik ser ProgramMetaData ut for en musikkalarm: XML inni et XML-attributt.
  const didl = '<DIDL-Lite xmlns="urn:x"><item id="a&amp;b"><dc:title>P4</dc:title></item></DIDL-Lite>';
  const xml = buildEnvelope('AlarmClock:1', 'CreateAlarm', [['ProgramMetaData', didl]]);
  const value = /<ProgramMetaData>([\s\S]*)<\/ProgramMetaData>/.exec(xml)[1];

  assert.ok(!value.includes('<DIDL-Lite'));
  assert.strictEqual(decodeEntities(value), didl);
});

test('kjenner igjen en feilkropp uansett statuskode', () => {
  assert.strictEqual(hasFault(FAULT_402), true);
  assert.strictEqual(hasFault('<s:Envelope><s:Body><s:Fault><faultcode>s:Client'
    + '</faultcode></s:Fault></s:Body></s:Envelope>'), true);
  // Prefikset varierer med hvem som svarer.
  assert.strictEqual(hasFault('<SOAP-ENV:Fault><detail/></SOAP-ENV:Fault>'), true);
  assert.strictEqual(hasFault('<Fault/>'), false);
});

test('et vanlig svar regnes ikke som feil', () => {
  assert.strictEqual(hasFault('<u:ListAlarmsResponse><CurrentAlarmList/></u:ListAlarmsResponse>'), false);
  assert.strictEqual(hasFault(''), false);
  assert.strictEqual(hasFault(null), false);
  // Ordet «Fault» i en fritekstverdi skal ikke utløse noe.
  assert.strictEqual(hasFault('<CurrentAlarmList>Default playlist</CurrentAlarmList>'), false);
});
