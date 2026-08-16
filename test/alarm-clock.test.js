'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  parseAlarms, normalizeTime, clampVolume, alarmToArgs, validateAlarm, normalizeAlarm,
  mergeAlarm, findEquivalentAlarm, ALARM_FIELDS, CREATE_FIELDS, BUZZER_URI,
} = require('../lib/alarm-clock');
const { LIST_ALARMS_RESPONSE } = require('./fixtures');

test('parser alle alarmene fra et ekte ListAlarms-svar', () => {
  const alarms = parseAlarms(LIST_ALARMS_RESPONSE);
  assert.strictEqual(alarms.length, 3);
  assert.deepStrictEqual(alarms.map((a) => a.id), ['485', '575', '2587']);
});

test('mister ikke alarmer som er beholdere med et Content-barn', () => {
  // Alarmer laget i Sonos-appen skrives som <Alarm …><Content …/></Alarm>,
  // ikke selvlukkende. De forsvant stille, og det var brukerens EGNE alarmer
  // som ble borte mens de appen selv hadde laget kom med.
  const container = parseAlarms(LIST_ALARMS_RESPONSE).find((a) => a.id === '2587');
  assert.ok(container, 'alarm 2587 skal være med');
  assert.strictEqual(container.startTime, '07:00:00');
  assert.strictEqual(container.enabled, true);
  assert.strictEqual(container.volume, 20);
});

test('teller like mange alarmer som det finnes Alarm-elementer', () => {
  // Vaktposten mot hele feilklassen: spriker disse to, dropper parseren noe.
  const raw = (LIST_ALARMS_RESPONSE.match(/&lt;Alarm\b/g) || []).length;
  assert.strictEqual(parseAlarms(LIST_ALARMS_RESPONSE).length, raw);
});

test('leser StartTime ut selv om feltet heter StartLocalTime inn', () => {
  const [first] = parseAlarms(LIST_ALARMS_RESPONSE);
  assert.strictEqual(first.startTime, '10:00:00');
});

test('tolker Enabled og IncludeLinkedZones som boolske', () => {
  const [first] = parseAlarms(LIST_ALARMS_RESPONSE);
  assert.strictEqual(first.enabled, false);
  assert.strictEqual(first.includeLinkedZones, false);
});

test('dekoder ampersand i Spotify-URI-en riktig', () => {
  const [first] = parseAlarms(LIST_ALARMS_RESPONSE);
  assert.ok(first.programURI.includes('&flags=10860'));
  assert.ok(!first.programURI.includes('&amp;'));
});

test('buzzer-alarmen har tom metadata', () => {
  const buzzer = parseAlarms(LIST_ALARMS_RESPONSE).find((a) => a.id === '575');
  assert.strictEqual(buzzer.programURI, BUZZER_URI);
  assert.strictEqual(buzzer.programMetaData, '');
});

test('normaliserer tidspunkter til HH:MM:SS', () => {
  assert.strictEqual(normalizeTime('7:30'), '07:30:00');
  assert.strictEqual(normalizeTime('07:30'), '07:30:00');
  assert.strictEqual(normalizeTime('23:59:59'), '23:59:59');
});

test('godtar tid uten kolon', () => {
  // Feltet fylles ut for hånd; å kreve kolon er unødvendig tyranni.
  assert.strictEqual(normalizeTime('0700'), '07:00:00');
  assert.strictEqual(normalizeTime('700'), '07:00:00');
  assert.strictEqual(normalizeTime('0730'), '07:30:00');
  assert.strictEqual(normalizeTime('730'), '07:30:00');
  assert.strictEqual(normalizeTime('2359'), '23:59:00');
});

test('to siffer eller færre er timer, ikke minutter', () => {
  // «7» skal bli sju om morgenen, ikke sju minutter over midnatt.
  assert.strictEqual(normalizeTime('7'), '07:00:00');
  assert.strictEqual(normalizeTime('07'), '07:00:00');
  assert.strictEqual(normalizeTime('23'), '23:00:00');
});

test('godtar punktum, bindestrek og mellomrom som skilletegn', () => {
  assert.strictEqual(normalizeTime('07.30'), '07:30:00');
  assert.strictEqual(normalizeTime('7.5'), '07:05:00');
  assert.strictEqual(normalizeTime('07-30'), '07:30:00');
  assert.strictEqual(normalizeTime('07 30'), '07:30:00');
  assert.strictEqual(normalizeTime('  07:30  '), '07:30:00');
  // Dobbelttastet kolon leses entydig som 07:30 — ingen grunn til å avvise
  // en åpenbar slurvefeil når meningen er utvetydig.
  assert.strictEqual(normalizeTime('07::30'), '07:30:00');
});

test('sekunder tas med når de er der', () => {
  assert.strictEqual(normalizeTime('073045'), '07:30:45');
  assert.strictEqual(normalizeTime('73045'), '07:30:45');
  assert.strictEqual(normalizeTime('07:30:45'), '07:30:45');
});

test('avviser ugyldige tidspunkter', () => {
  const bad = [
    '24:00', '12:60', 'sju', '', null, undefined,
    '2400', '0760', '9999', // gyldig form, umulig klokkeslett
    '1234567', '07:30:45:12', 'kl 7', '7:3o',
  ];
  for (const value of bad) {
    assert.strictEqual(normalizeTime(value), null, `skulle avvist ${JSON.stringify(value)}`);
  }
});

test('klemmer volum inn i 0–100', () => {
  assert.strictEqual(clampVolume(-5), 0);
  assert.strictEqual(clampVolume(150), 100);
  assert.strictEqual(clampVolume('51'), 51);
  assert.strictEqual(clampVolume('tull'), 0);
});

test('argumentnavn har ikke Desired-prefiks', () => {
  // Dette er feilen som ga UPnP 402 under utprøvingen. Testen finnes for at
  // den ikke skal kunne snike seg inn igjen.
  const [alarm] = parseAlarms(LIST_ALARMS_RESPONSE);
  const names = alarmToArgs(alarm).map(([name]) => name);
  assert.deepStrictEqual(names, ALARM_FIELDS);
  assert.ok(names.every((name) => !name.startsWith('Desired')));
});

test('CreateAlarm sender ikke ID', () => {
  const [alarm] = parseAlarms(LIST_ALARMS_RESPONSE);
  const names = alarmToArgs(alarm, CREATE_FIELDS).map(([name]) => name);
  assert.ok(!names.includes('ID'));
  assert.strictEqual(names.length, ALARM_FIELDS.length - 1);
});

test('serialiserer boolske felt som 1 og 0', () => {
  const [alarm] = parseAlarms(LIST_ALARMS_RESPONSE);
  const args = new Map(alarmToArgs({ ...alarm, enabled: true }));
  assert.strictEqual(args.get('Enabled'), '1');
  assert.strictEqual(args.get('IncludeLinkedZones'), '0');
});

test('validering avviser manglende rom', () => {
  const [alarm] = parseAlarms(LIST_ALARMS_RESPONSE);
  assert.throws(() => validateAlarm({ ...alarm, roomUUID: '' }), /rom/i);
});

test('merge beholder felt som ikke endres', () => {
  const [alarm] = parseAlarms(LIST_ALARMS_RESPONSE);
  const merged = mergeAlarm(alarm, { startTime: '6:15' });
  assert.strictEqual(merged.startTime, '06:15:00');
  // Nettopp dette er poenget med merge: UpdateAlarm overskriver alt, så
  // lydkilden må overleve en ren tidsendring.
  assert.strictEqual(merged.programURI, alarm.programURI);
  assert.strictEqual(merged.volume, alarm.volume);
});

test('merge validerer resultatet, ikke bare endringen', () => {
  const [alarm] = parseAlarms(LIST_ALARMS_RESPONSE);
  assert.throws(() => mergeAlarm(alarm, { recurrence: 'SOMETIMES' }), /gjentakelse/i);
});

test('normalisering skriver tiden om, ikke bare godkjenner den', () => {
  // Dette er feilen som ga UPnP 402 på CreateAlarm: validateAlarm bekreftet at
  // «09:15» KUNNE normaliseres, men verdien gikk urørt på tråden.
  const normalized = normalizeAlarm({
    startTime: '9:15',
    duration: '1:00',
    recurrence: 'daily',
    volume: 150,
    roomUUID: 'RINCON_TEST',
    programURI: BUZZER_URI,
  });
  assert.strictEqual(normalized.startTime, '09:15:00');
  assert.strictEqual(normalized.duration, '01:00:00');
  assert.strictEqual(normalized.recurrence, 'DAILY');
  assert.strictEqual(normalized.volume, 100);
});

test('normalisering lar originalen være i fred', () => {
  const original = {
    startTime: '9:15',
    duration: '1:00',
    recurrence: 'DAILY',
    volume: 20,
    roomUUID: 'RINCON_TEST',
    programURI: BUZZER_URI,
  };
  normalizeAlarm(original);
  assert.strictEqual(original.startTime, '9:15');
});

test('argumentene som sendes har alltid HH:MM:SS', () => {
  const args = new Map(alarmToArgs(normalizeAlarm({
    startTime: '7:05',
    duration: '2:00',
    recurrence: 'ONCE',
    volume: 20,
    roomUUID: 'RINCON_TEST',
    programURI: BUZZER_URI,
  })));
  assert.strictEqual(args.get('StartLocalTime'), '07:05:00');
  assert.strictEqual(args.get('Duration'), '02:00:00');
});

test('finner en alarm som allerede finnes, uansett volum og av/på', () => {
  // «Bruk når du lagrer» står alltid på, så uten dette oppslaget ville hver
  // volumjustering blitt en ny alarm i stedet for en endring av den gamle.
  const alarms = parseAlarms(LIST_ALARMS_RESPONSE);
  const buzzer = alarms.find((alarm) => alarm.id === '575');
  const match = findEquivalentAlarm(alarms, {
    startTime: '8:00',
    recurrence: 'daily',
    programURI: BUZZER_URI,
  }, () => true);
  assert.strictEqual(match.id, buzzer.id);
});

test('ulik tid, dager eller lyd er en annen alarm', () => {
  const alarms = parseAlarms(LIST_ALARMS_RESPONSE);
  const base = { startTime: '08:00', recurrence: 'DAILY', programURI: BUZZER_URI };
  assert.strictEqual(findEquivalentAlarm(alarms, { ...base, startTime: '08:30' }, () => true), null);
  assert.strictEqual(findEquivalentAlarm(alarms, { ...base, recurrence: 'ONCE' }, () => true), null);
  assert.strictEqual(findEquivalentAlarm(alarms, { ...base, programURI: 'x-other:1' }, () => true), null);
});

test('en alarm i et annet rom teller ikke som den samme', () => {
  const alarms = parseAlarms(LIST_ALARMS_RESPONSE);
  const match = findEquivalentAlarm(alarms, {
    startTime: '08:00',
    recurrence: 'DAILY',
    programURI: BUZZER_URI,
  }, () => false);
  assert.strictEqual(match, null);
});

test('tom liste gir tomt resultat i stedet for å kaste', () => {
  assert.deepStrictEqual(parseAlarms('<CurrentAlarmList></CurrentAlarmList>'), []);
  assert.deepStrictEqual(parseAlarms(''), []);
});
