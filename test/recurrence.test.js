'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  isValidRecurrence, daysToRecurrence, recurrenceToDays, describeRecurrence, daysForPreset,
} = require('../lib/recurrence');

test('godtar nøkkelordene Sonos bruker', () => {
  for (const value of ['ONCE', 'DAILY', 'WEEKDAYS', 'WEEKENDS']) {
    assert.ok(isValidRecurrence(value), value);
  }
});

test('godtar ON_-formen', () => {
  assert.ok(isValidRecurrence('ON_135'));
  assert.ok(isValidRecurrence('ON_0'));
});

test('avviser tull og gjentatte dager', () => {
  for (const value of ['SOMETIMES', 'ON_', 'ON_7', 'ON_112', '', null]) {
    assert.ok(!isValidRecurrence(value), `skulle avvist ${value}`);
  }
});

test('sorterer og avdupliserer dager', () => {
  // Sonos rapporterer dagene i egen rekkefølge. Uten sortering ville enheten
  // sett endret ut ved hver polling.
  assert.strictEqual(daysToRecurrence([5, 1, 1, 3]), 'ON_135');
});

test('alle sju dager blir DAILY, ikke ON_0123456', () => {
  assert.strictEqual(daysToRecurrence([0, 1, 2, 3, 4, 5, 6]), 'DAILY');
});

test('ingen dager gir null slik at kallet kan avvises', () => {
  assert.strictEqual(daysToRecurrence([]), null);
  assert.strictEqual(daysToRecurrence(['tull']), null);
});

test('oversetter nøkkelord til dager, med søndag som 0', () => {
  assert.deepStrictEqual(recurrenceToDays('WEEKDAYS'), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(recurrenceToDays('WEEKENDS'), [0, 6]);
  assert.deepStrictEqual(recurrenceToDays('DAILY'), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(recurrenceToDays('ONCE'), []);
});

test('tur-retur gjennom dager bevarer verdien', () => {
  assert.strictEqual(daysToRecurrence(recurrenceToDays('ON_135')), 'ON_135');
  assert.strictEqual(daysToRecurrence(recurrenceToDays('WEEKDAYS')), 'ON_12345');
});

test('hurtigvalgene gir riktige dager', () => {
  assert.deepStrictEqual(daysForPreset('daily'), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(daysForPreset('weekdays'), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(daysForPreset('weekends'), [0, 6]);
});

test('custom og ukjente hurtigvalg gir null, ikke tomme dager', () => {
  // Null betyr «rør ikke dagene». Tom liste ville tømt alle sju.
  assert.strictEqual(daysForPreset('custom'), null);
  assert.strictEqual(daysForPreset(''), null);
  assert.strictEqual(daysForPreset(undefined), null);
  assert.strictEqual(daysForPreset('tull'), null);
});

test('hurtigvalg kan ikke endres utenfra', () => {
  // Returneres den interne lista direkte, kan en kaller mutere tabellen for
  // alle senere oppslag.
  const first = daysForPreset('weekdays');
  first.push(6);
  assert.deepStrictEqual(daysForPreset('weekdays'), [1, 2, 3, 4, 5]);
});

test('hurtigvalg og gjentakelse er enige med hverandre', () => {
  assert.strictEqual(daysToRecurrence(daysForPreset('daily')), 'DAILY');
  assert.strictEqual(daysToRecurrence(daysForPreset('weekdays')), 'ON_12345');
  assert.strictEqual(daysToRecurrence(daysForPreset('weekends')), 'ON_06');
});

test('beskriver gjentakelse på begge språk', () => {
  assert.strictEqual(describeRecurrence('DAILY', 'no'), 'Daglig');
  assert.strictEqual(describeRecurrence('DAILY', 'en'), 'Daily');
  assert.strictEqual(describeRecurrence('ON_15', 'no'), 'man, fre');
  assert.strictEqual(describeRecurrence('ON_15', 'en'), 'Mon, Fri');
});

test('faller tilbake til engelsk for ukjent språk', () => {
  assert.strictEqual(describeRecurrence('DAILY', 'de'), 'Daily');
});

// ---- kortest mulig, men fortsatt entydig ----
//
// En sensorflis i Homey viser rundt tjue tegn. «man, tir, ons, tor, fre» er
// tjuetre, og resten forsvant ordløst — derfor er lengden her et krav, ikke
// kosmetikk. Samtidig må ingen forkorting slå to ulike dagsett sammen til
// samme tekst.

test('mønstre Sonos har nøkkelord for gjenkjennes i ON_-formen', () => {
  // daysToRecurrence lager alltid ON_-formen, aldri WEEKDAYS. Uten oppslaget
  // ville «Ukedager» aldri blitt vist.
  assert.strictEqual(describeRecurrence(daysToRecurrence([1, 2, 3, 4, 5]), 'no'), 'Ukedager');
  assert.strictEqual(describeRecurrence(daysToRecurrence([1, 2, 3, 4, 5]), 'en'), 'Weekdays');
  assert.strictEqual(describeRecurrence(daysToRecurrence([0, 6]), 'no'), 'Helg');
  assert.strictEqual(describeRecurrence(daysToRecurrence([0, 6]), 'en'), 'Weekends');
  assert.strictEqual(describeRecurrence(daysToRecurrence([0, 1, 2, 3, 4, 5, 6]), 'no'), 'Daglig');
});

test('uka begynner på mandag, ikke på søndag', () => {
  // Sonos nummererer søndag som 0. En rett sortering ga «søn, fre, lør».
  assert.strictEqual(describeRecurrence('ON_056', 'no'), 'fre–søn');
  assert.strictEqual(describeRecurrence('ON_01', 'no'), 'man, søn');
  assert.strictEqual(describeRecurrence('ON_012345', 'no'), 'man–fre, søn');
});

test('tre dager eller mer på rad skrives som spenn', () => {
  assert.strictEqual(describeRecurrence('ON_123', 'no'), 'man–ons');
  assert.strictEqual(describeRecurrence('ON_1234', 'no'), 'man–tor');
  assert.strictEqual(describeRecurrence('ON_23456', 'en'), 'Tue–Sat');
});

test('to dager listes, for en tankestrek gjør dem ikke kortere', () => {
  assert.strictEqual(describeRecurrence('ON_12', 'no'), 'man, tir');
  assert.strictEqual(describeRecurrence('ON_25', 'no'), 'tir, fre');
});

test('spredte dager listes hver for seg', () => {
  assert.strictEqual(describeRecurrence('ON_135', 'no'), 'man, ons, fre');
  assert.strictEqual(describeRecurrence('ON_1', 'no'), 'man');
});

test('flere spenn i samme uke skilles med komma', () => {
  // Mandag til onsdag, og fredag til søndag: to strekk, ingen torsdag.
  assert.strictEqual(describeRecurrence('ON_0123 56'.replace(' ', ''), 'no'), 'man–ons, fre–søn');
});

test('ingen to dagskombinasjoner får samme tekst', () => {
  // Den viktigste egenskapen: forkortingen skal spare plass, ikke informasjon.
  // Alle 127 ikke-tomme kombinasjoner, på begge språk.
  for (const language of ['no', 'en']) {
    const seen = new Map();

    for (let mask = 1; mask < 128; mask += 1) {
      const days = [0, 1, 2, 3, 4, 5, 6].filter((day) => mask & (1 << day));
      const recurrence = daysToRecurrence(days);

      // Gjentakelsen må dessuten kunne leses tilbake til nøyaktig samme dager.
      assert.deepStrictEqual(recurrenceToDays(recurrence), days, recurrence);

      const label = describeRecurrence(recurrence, language);
      const key = days.join(',');
      const clash = seen.get(label);
      assert.ok(clash === undefined || clash === key,
        `«${label}» brukes både av ${clash} og ${key}`);
      seen.set(label, key);
    }
  }
});

test('ingen vanlig kombinasjon er lengre enn en flis klarer', () => {
  // Ukedager, helg, daglig, enkeltdager og sammenhengende strekk er det folk
  // faktisk velger. De skal alle få plass.
  const common = [[1, 2, 3, 4, 5], [0, 6], [0, 1, 2, 3, 4, 5, 6], [1], [6],
    [1, 2, 3], [1, 2, 3, 4], [2, 3, 4, 5, 6], [5, 6, 0]];

  for (const days of common) {
    const label = describeRecurrence(daysToRecurrence(days), 'no');
    assert.ok(label.length <= 12, `${days} ga «${label}» (${label.length} tegn)`);
  }
});
