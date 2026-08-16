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
