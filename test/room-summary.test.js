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

// nextOccurrence gir tilbake et VEGGKLOKKE-tidspunkt: dato og klokkeslett ligger
// i UTC-feltene uansett hvilken sone prosessen kjører i. Testene må derfor lese
// det med UTC-getterne — leses det med de lokale, måler man prosessens sone i
// stedet for det funksjonen faktisk svarte, og testen gir ulikt svar på en
// utviklermaskin og på Homey.
const dayOfMonth = (date) => date.getUTCDate();
const weekday = (date) => date.getUTCDay();

test('samler alarmene som hører til rommet, også via satellitt', () => {
  const coordinatorOf = (uuid) => (uuid === 'RINCON_SAT' ? 'RINCON_COORD' : 'RINCON_OTHER');
  const alarms = [alarm({ id: '1' }), alarm({ id: '2', roomUUID: 'RINCON_ELSEWHERE' })];
  const mine = alarmsForRoom(alarms, coordinatorOf, 'RINCON_COORD');
  assert.deepStrictEqual(mine.map((a) => a.id), ['1']);
});

test('daglig alarm som alt har ringt i dag, treffer i morgen', () => {
  const at = nextOccurrence(alarm({ startTime: '07:00:00' }), WEDNESDAY);
  assert.strictEqual(dayOfMonth(at), 20);
  assert.strictEqual(formatTime(at), '07:00');
});

test('daglig alarm senere i dag treffer i dag', () => {
  const at = nextOccurrence(alarm({ startTime: '22:00:00' }), WEDNESDAY);
  assert.strictEqual(dayOfMonth(at), 19);
});

test('ukedagsalarm på fredag hopper over helgen', () => {
  // Fredag 21. kl. 07:00 er neste, ikke lørdag.
  const at = nextOccurrence(alarm({ recurrence: 'ON_5', startTime: '07:00:00' }), WEDNESDAY);
  assert.strictEqual(dayOfMonth(at), 21);
  assert.strictEqual(weekday(at), 5);
});

test('helgealarm fra onsdag treffer lørdag', () => {
  const at = nextOccurrence(alarm({ recurrence: 'WEEKENDS' }), WEDNESDAY);
  assert.strictEqual(weekday(at), 6);
});

test('ONCE ringer neste gang klokkeslettet passeres', () => {
  const at = nextOccurrence(alarm({ recurrence: 'ONCE', startTime: '06:00:00' }), WEDNESDAY);
  assert.strictEqual(dayOfMonth(at), 20);
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

test('oppsummeringen viser den tidligste og hvor mange flere som finnes', () => {
  // Flisa paa romkortet viser rundt tjue tegn. Hele lista fikk aldri plass,
  // uansett skilletegn — den staar i enhetsinnstillingene i stedet.
  const alarms = [
    alarm({ startTime: '10:00:00', recurrence: 'WEEKDAYS', enabled: false }),
    alarm({ startTime: '08:00:00', recurrence: 'DAILY', enabled: true }),
  ];
  assert.strictEqual(describeRoom(alarms, 'no'), '08:00 Daglig +1');
});

test('en enkelt alarm far ingen teller', () => {
  assert.strictEqual(describeRoom([alarm({ startTime: '09:15:00', recurrence: 'ONCE' })], 'no'),
    '09:15 Én gang');
});

test('sammendraget faar plass i flisa uansett hvor mange alarmer rommet har', () => {
  // Fem ukedagsalarmer er det virkelige tilfellet fra soverommet.
  const many = ['07:00', '07:30', '07:35', '07:45', '08:00']
    .map((time) => alarm({ startTime: `${time}:00`, recurrence: 'ON_12345' }));

  const label = describeRoom(many, 'no');
  assert.strictEqual(label, '07:00 Ukedager +4');
  assert.ok(label.length <= 20, `${label} er ${label.length} tegn`);
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

// ---- tidssone, midnatt og sommertid ----
//
// Sonos lagrer StartLocalTime som veggklokke i husstandens sone. Homey-apper
// kjører med TZ=UTC, så uten en eksplisitt sone regnes alt i UTC. Testene under
// bruker faste UTC-øyeblikk og oppgir sonen selv, slik at de gir samme svar på
// en utviklermaskin og på Homey.

const OSLO = 'Europe/Oslo';

// 2026-08-16T22:30Z er mandag 00:30 i Oslo, men fortsatt søndag 22:30 i UTC.
// Nettopp her skiller de to regnemåtene lag.
const PAST_MIDNIGHT = new Date('2026-08-16T22:30:00Z');

test('alarm rundt midnatt følger husstandens sone, ikke UTC', () => {
  const sundayAlarm = alarm({ startTime: '23:00:00', recurrence: 'ON_0' });

  // I Oslo er klokka mandag 00:30. Søndagens 23:00 ringte for halvannen time
  // siden, så neste gang er søndagen etter.
  const zoned = nextOccurrence(sundayAlarm, PAST_MIDNIGHT, OSLO);
  assert.strictEqual(dayOfMonth(zoned), 23);
  assert.strictEqual(weekday(zoned), 0);

  // Regnet i UTC er klokka fortsatt søndag 22:30, og da ser den samme alarmen
  // ut til å komme om en halvtime i stedet for om en uke.
  const naive = nextOccurrence(sundayAlarm, PAST_MIDNIGHT, 'UTC');
  assert.strictEqual(dayOfMonth(naive), 16);
});

test('sonen avgjør hvilken alarm som vises som den neste', () => {
  // Dette er forskjellen brukeren faktisk ser på romkortet.
  const alarms = [
    alarm({ id: 'sondag', startTime: '23:00:00', recurrence: 'ON_0' }),
    alarm({ id: 'daglig', startTime: '08:00:00', recurrence: 'DAILY' }),
  ];

  const zoned = nextAlarm(alarms, PAST_MIDNIGHT, OSLO);
  assert.strictEqual(zoned.alarm.id, 'daglig');
  assert.strictEqual(formatTime(zoned.at), '08:00');

  const naive = nextAlarm(alarms, PAST_MIDNIGHT, 'UTC');
  assert.strictEqual(naive.alarm.id, 'sondag');
  assert.strictEqual(formatTime(naive.at), '23:00');
});

test('midnatt regnes som neste døgn, ikke som passert', () => {
  // Onsdag 23:30 i Oslo: 00:00 er om en halvtime.
  const late = new Date('2026-08-19T21:30:00Z');
  const at = nextOccurrence(alarm({ startTime: '00:00:00' }), late, OSLO);

  assert.strictEqual(dayOfMonth(at), 20);
  assert.strictEqual(formatTime(at), '00:00');
});

test('23:59 samme kveld regnes som i dag', () => {
  const late = new Date('2026-08-19T21:30:00Z');
  const at = nextOccurrence(alarm({ startTime: '23:59:00' }), late, OSLO);

  assert.strictEqual(dayOfMonth(at), 19);
  assert.strictEqual(formatTime(at), '23:59');
});

test('søndag kveld ruller over til mandagens ukedagsalarm', () => {
  // Søndag 2026-08-16 kl. 20:00 i Oslo.
  const sundayEvening = new Date('2026-08-16T18:00:00Z');
  const at = nextOccurrence(
    alarm({ startTime: '06:30:00', recurrence: 'WEEKDAYS' }), sundayEvening, OSLO,
  );

  assert.strictEqual(dayOfMonth(at), 17);
  assert.strictEqual(weekday(at), 1);
  assert.strictEqual(formatTime(at), '06:30');
});

test('overgangen til sommertid flytter ikke alarmen', () => {
  // Lørdag 2026-03-28 kl. 22:00 i Oslo. Natt til søndag stilles klokka fram fra
  // 02:00 til 03:00, men veggklokka viser 07:00 like fullt.
  const before = new Date('2026-03-28T21:00:00Z');
  const at = nextOccurrence(alarm({ startTime: '07:00:00' }), before, OSLO);

  assert.strictEqual(dayOfMonth(at), 29);
  assert.strictEqual(formatTime(at), '07:00');
});

test('overgangen til vintertid flytter ikke alarmen', () => {
  // Lørdag 2026-10-24 kl. 22:00 i Oslo. Natt til søndag stilles klokka tilbake.
  const before = new Date('2026-10-24T20:00:00Z');
  const at = nextOccurrence(alarm({ startTime: '07:00:00' }), before, OSLO);

  assert.strictEqual(dayOfMonth(at), 25);
  assert.strictEqual(formatTime(at), '07:00');
});

test('to alarmer på samme tidspunkt gir én av dem, ikke ingen', () => {
  const alarms = [
    alarm({ id: 'a', startTime: '07:00:00' }),
    alarm({ id: 'b', startTime: '07:00:00' }),
  ];
  const best = nextAlarm(alarms, PAST_MIDNIGHT, OSLO);

  assert.ok(best);
  assert.ok(['a', 'b'].includes(best.alarm.id));
  assert.strictEqual(formatTime(best.at), '07:00');
});

test('avslåtte alarmer teller ikke, uansett hvor mange som finnes', () => {
  const alarms = [
    alarm({ id: 'av-tidlig', startTime: '05:00:00', enabled: false }),
    alarm({ id: 'av-sen', startTime: '06:00:00', enabled: false }),
    alarm({ id: 'paa', startTime: '09:30:00', enabled: true }),
  ];

  assert.strictEqual(nextAlarm(alarms, PAST_MIDNIGHT, OSLO).alarm.id, 'paa');
});

test('et rom uten alarmer har ingen neste', () => {
  assert.strictEqual(nextAlarm([], PAST_MIDNIGHT, OSLO), null);
});

test('en ukjent tidssone faller tilbake i stedet for å kaste', () => {
  // Intl kaster på et sonenavn den ikke kjenner. Skjer det, skal vi miste
  // tidssonen — ikke hele alarmoversikten for rommet.
  const daily = alarm({ startTime: '07:00:00' });

  assert.doesNotThrow(() => nextOccurrence(daily, PAST_MIDNIGHT, 'Bogus/Zone'));
  assert.strictEqual(formatTime(nextOccurrence(daily, PAST_MIDNIGHT, 'Bogus/Zone')), '07:00');
  assert.doesNotThrow(() => nextAlarm([daily], PAST_MIDNIGHT, 'Bogus/Zone'));
});
