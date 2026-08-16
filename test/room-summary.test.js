'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  alarmsForRoom, nextAlarm, nextOccurrence, describeRoom, formatTime,
  sortedByTime, numberedList, alarmAtPosition,
} = require('../lib/room-summary');

const BUZZER = 'x-rincon-buzzer:0';

function alarm(overrides) {
  return {
    id: '1', startTime: '07:00:00', recurrence: 'DAILY', enabled: true,
    roomUUID: 'RINCON_SAT', programURI: BUZZER, ...overrides,
  };
}

// Onsdag 2026-08-19, klokka 09:00 lokal tid.
const WEDNESDAY = new Date(2026, 7, 19, 9, 0, 0);

test('samler alarmene som hører til rommet, også via satellitt', () => {
  const coordinatorOf = (uuid) => (uuid === 'RINCON_SAT' ? 'RINCON_COORD' : 'RINCON_OTHER');
  const alarms = [alarm({ id: '1' }), alarm({ id: '2', roomUUID: 'RINCON_ELSEWHERE' })];
  const mine = alarmsForRoom(alarms, coordinatorOf, 'RINCON_COORD');
  assert.deepStrictEqual(mine.map((a) => a.id), ['1']);
});

test('daglig alarm som alt har ringt i dag, treffer i morgen', () => {
  const at = nextOccurrence(alarm({ startTime: '07:00:00' }), WEDNESDAY);
  assert.strictEqual(at.getDate(), 20);
  assert.strictEqual(formatTime(at), '07:00');
});

test('daglig alarm senere i dag treffer i dag', () => {
  const at = nextOccurrence(alarm({ startTime: '22:00:00' }), WEDNESDAY);
  assert.strictEqual(at.getDate(), 19);
});

test('ukedagsalarm på fredag hopper over helgen', () => {
  // Fredag 21. kl. 07:00 er neste, ikke lørdag.
  const at = nextOccurrence(alarm({ recurrence: 'ON_5', startTime: '07:00:00' }), WEDNESDAY);
  assert.strictEqual(at.getDate(), 21);
  assert.strictEqual(at.getDay(), 5);
});

test('helgealarm fra onsdag treffer lørdag', () => {
  const at = nextOccurrence(alarm({ recurrence: 'WEEKENDS' }), WEDNESDAY);
  assert.strictEqual(at.getDay(), 6);
});

test('ONCE ringer neste gang klokkeslettet passeres', () => {
  const at = nextOccurrence(alarm({ recurrence: 'ONCE', startTime: '06:00:00' }), WEDNESDAY);
  assert.strictEqual(at.getDate(), 20);
});

test('neste alarm ser bort fra avslåtte', () => {
  const alarms = [
    alarm({ id: 'av', startTime: '10:00:00', enabled: false }),
    alarm({ id: 'paa', startTime: '18:00:00', enabled: true }),
  ];
  assert.strictEqual(nextAlarm(alarms, WEDNESDAY).alarm.id, 'paa');
});

test('ingen aktiverte alarmer gir null', () => {
  assert.strictEqual(nextAlarm([alarm({ enabled: false })], WEDNESDAY), null);
  assert.strictEqual(nextAlarm([], WEDNESDAY), null);
});

test('velger den tidligste av flere aktiverte', () => {
  const alarms = [
    alarm({ id: 'sen', startTime: '20:00:00' }),
    alarm({ id: 'tidlig', startTime: '11:00:00' }),
  ];
  assert.strictEqual(nextAlarm(alarms, WEDNESDAY).alarm.id, 'tidlig');
});

test('ugyldig tidspunkt gir null i stedet for å kaste', () => {
  assert.strictEqual(nextOccurrence(alarm({ startTime: '' }), WEDNESDAY), null);
});

test('oppsummeringen sorterer på tid og merker avslåtte', () => {
  const alarms = [
    alarm({ startTime: '10:00:00', recurrence: 'WEEKDAYS', enabled: false }),
    alarm({ startTime: '08:00:00', recurrence: 'DAILY', enabled: true }),
  ];
  assert.strictEqual(describeRoom(alarms, 'no'), '08:00 Daglig · 10:00 Ukedager (av)');
});

test('nummerert liste sorterer på tid og starter på 1', () => {
  // Numrene er det eneste som knytter nedtrekket til en bestemt alarm, så
  // rekkefølgen må være stabil. Sonos gir alarmene i vilkårlig rekkefølge.
  const alarms = [
    alarm({ id: 'sen', startTime: '22:00:00', recurrence: 'DAILY' }),
    alarm({ id: 'tidlig', startTime: '06:30:00', recurrence: 'WEEKDAYS' }),
  ];
  assert.strictEqual(numberedList(alarms, 'no'), '1: 06:30 Ukedager\n2: 22:00 Daglig');
});

test('avslåtte alarmer merkes i lista', () => {
  const alarms = [alarm({ startTime: '07:00:00', recurrence: 'DAILY', enabled: false })];
  assert.strictEqual(numberedList(alarms, 'no'), '1: 07:00 Daglig — av');
});

test('plassoppslag følger samme sortering som lista', () => {
  const alarms = [
    alarm({ id: 'sen', startTime: '22:00:00' }),
    alarm({ id: 'tidlig', startTime: '06:30:00' }),
  ];
  assert.strictEqual(alarmAtPosition(alarms, 1).id, 'tidlig');
  assert.strictEqual(alarmAtPosition(alarms, '2').id, 'sen');
});

test('plass utenfor lista gir null i stedet for feil alarm', () => {
  // Slettingen er ikke reversibel, så et oppslag som bommer må gi ingenting
  // framfor å treffe en tilfeldig nabo.
  const alarms = [alarm({ startTime: '07:00:00' })];
  assert.strictEqual(alarmAtPosition(alarms, 2), null);
  assert.strictEqual(alarmAtPosition(alarms, 0), null);
  assert.strictEqual(alarmAtPosition(alarms, 'none'), null);
  assert.strictEqual(alarmAtPosition([], 1), null);
});

test('sortering endrer ikke lista som ble sendt inn', () => {
  const alarms = [alarm({ id: 'b', startTime: '22:00:00' }), alarm({ id: 'a', startTime: '06:00:00' })];
  sortedByTime(alarms);
  assert.strictEqual(alarms[0].id, 'b');
});

test('tomt rom sier det tydelig', () => {
  assert.strictEqual(describeRoom([], 'no'), 'Ingen alarmer');
  assert.strictEqual(describeRoom([], 'en'), 'No alarms');
});
