'use strict';

const { describeRecurrence } = require('./recurrence');
const { BUZZER_URI } = require('./alarm-clock');

// Navnet er det eneste brukeren har å skille alarmer på i paringslista, så
// rommet må komme først: «Soverom 08:00» leses raskere enn «Alarm 08:00» når
// halvparten av linjene begynner likt.
//
// Rommet SKAL alltid være med. Slår man det opp mot koordinatorene alene, blir
// det tomt for alarmer som peker på en satellitt — som er det vanlige når rommet
// har surround eller sub — og da ser to alarmer i ulike rom helt like ut.

function describeAlarm(alarm, room, language = 'en') {
  const time = (alarm.startTime || '').slice(0, 5);
  const when = describeRecurrence(alarm.recurrence, language);
  const music = alarm.programURI && alarm.programURI !== BUZZER_URI;

  const detail = [when, music ? musicLabel(language) : null]
    .filter(Boolean)
    .join(', ');

  const head = [room, time].filter(Boolean).join(' ');
  const name = detail ? `${head} (${detail})` : head;

  // Uten rom OG uten tid står vi igjen med tomt navn, og Homey ville vist en
  // navnløs enhet. ID-en er stygg, men den er i det minste entydig.
  return name.trim() || `${fallbackLabel(language)} ${alarm.id}`;
}

function musicLabel(language) {
  return language === 'no' ? 'musikk' : 'music';
}

function fallbackLabel(language) {
  return language === 'no' ? 'Alarm' : 'Alarm';
}

module.exports = { describeAlarm };
