'use strict';

// Sonos beskriver gjentakelse enten med et nøkkelord eller som «ON_» etterfulgt
// av ukedagsnumre, der 0 er søndag. Begge formene må inn og ut av flow-kortene.

const KEYWORDS = ['ONCE', 'DAILY', 'WEEKDAYS', 'WEEKENDS'];

const DAY_LABELS = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  no: ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'],
};

const KEYWORD_LABELS = {
  ONCE: { en: 'Once', no: 'Én gang' },
  DAILY: { en: 'Daily', no: 'Daglig' },
  WEEKDAYS: { en: 'Weekdays', no: 'Ukedager' },
  WEEKENDS: { en: 'Weekends', no: 'Helg' },
};

function isValidRecurrence(value) {
  const text = String(value || '').toUpperCase();
  if (KEYWORDS.includes(text)) return true;
  return /^ON_[0-6]{1,7}$/.test(text) && !hasRepeatedDay(text.slice(3));
}

function hasRepeatedDay(digits) {
  return new Set(digits).size !== digits.length;
}

// Dagene sorteres og avdupliseres. Sonos godtar «ON_51» men rapporterer det
// tilbake i egen rekkefølge, og da ville enheten sett endret ut ved neste
// polling selv om ingenting var forandret.
function daysToRecurrence(days) {
  const unique = [...new Set(
    (days || [])
      .map((day) => Number(day))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
  )].sort((a, b) => a - b);

  if (unique.length === 0) return null;
  if (unique.length === 7) return 'DAILY';
  return `ON_${unique.join('')}`;
}

function recurrenceToDays(recurrence) {
  const text = String(recurrence || '').toUpperCase();
  if (text === 'DAILY') return [0, 1, 2, 3, 4, 5, 6];
  if (text === 'WEEKDAYS') return [1, 2, 3, 4, 5];
  if (text === 'WEEKENDS') return [0, 6];
  if (text === 'ONCE') return [];
  const match = /^ON_([0-6]{1,7})$/.exec(text);
  if (!match) return [];
  return [...new Set(match[1].split('').map(Number))].sort((a, b) => a - b);
}

function describeRecurrence(recurrence, language = 'en') {
  const lang = DAY_LABELS[language] ? language : 'en';
  const text = String(recurrence || '').toUpperCase();

  if (KEYWORD_LABELS[text]) return KEYWORD_LABELS[text][lang];

  const days = recurrenceToDays(text);
  if (days.length === 0) return text || '';
  return days.map((day) => DAY_LABELS[lang][day]).join(', ');
}

module.exports = {
  KEYWORDS,
  isValidRecurrence,
  daysToRecurrence,
  recurrenceToDays,
  describeRecurrence,
};
