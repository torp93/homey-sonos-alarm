'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { describeAlarm } = require('../lib/alarm-name');
const { BUZZER_URI } = require('../lib/alarm-clock');

const buzzer = {
  id: '575', startTime: '08:00:00', recurrence: 'DAILY', programURI: BUZZER_URI,
};
const music = {
  id: '485', startTime: '10:00:00', recurrence: 'WEEKDAYS', programURI: 'x-rincon-cpcontainer:1006',
};

test('rommet kommer først, så tiden', () => {
  // «Alarm 08:00 daglig» og «Musikkalarm 10:00» var umulige å skille når
  // rommet manglet og halvparten av linjene begynte likt.
  assert.strictEqual(describeAlarm(buzzer, 'Soverom', 'no'), 'Soverom 08:00 (Daglig)');
});

test('musikkalarmer merkes som musikk', () => {
  assert.strictEqual(describeAlarm(music, 'Soverom', 'no'), 'Soverom 10:00 (Ukedager, musikk)');
  assert.strictEqual(describeAlarm(music, 'Bedroom', 'en'), 'Bedroom 10:00 (Weekdays, music)');
});

test('to alarmer i ulike rom får ulike navn', () => {
  assert.notStrictEqual(
    describeAlarm(buzzer, 'Soverom', 'no'),
    describeAlarm(buzzer, 'Kontor', 'no'),
  );
});

test('faller tilbake til ID når både rom og tid mangler', () => {
  const broken = { id: '99', startTime: '', recurrence: '', programURI: BUZZER_URI };
  assert.strictEqual(describeAlarm(broken, '', 'no'), 'Alarm 99');
});

test('klarer seg uten rom, men beholder tiden', () => {
  assert.strictEqual(describeAlarm(buzzer, '', 'no'), '08:00 (Daglig)');
});
