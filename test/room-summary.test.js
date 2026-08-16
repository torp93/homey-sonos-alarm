'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  alarmsForRoom, nextAlarm, nextOccurrence, describeRoom, formatTime,
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

test('tomt rom sier det tydelig', () => {
  assert.strictEqual(describeRoom([], 'no'), 'Ingen alarmer');
  assert.strictEqual(describeRoom([], 'en'), 'No alarms');
});
