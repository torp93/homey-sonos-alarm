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

// Hurtigvalgene i enhetsinnstillingene. «custom» betyr at de sju dagsvalgene
// gjelder som de står — den er standardverdien, så et lagret hurtigvalg aldri
// overstyrer dager brukeren har satt selv.
const DAY_PRESETS = {
  daily: [0, 1, 2, 3, 4, 5, 6],
  weekdays: [1, 2, 3, 4, 5],
  weekends: [0, 6],
};

function daysForPreset(preset) {
  const days = DAY_PRESETS[String(preset || '').toLowerCase()];
  return days ? days.slice() : null;
}

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

// Ukas rekkefolge slik den LESES. Sonos nummererer sondag som 0, og en rett
// sortering ga «son, fre, lor» for en fredag-til-sondag-alarm. Her starter uka
// pa mandag, slik den gjor i Norge og resten av Europa.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// Monstrene Sonos har egne nokkelord for. Appen skriver alltid ON_-formen —
// daysToRecurrence lager aldri WEEKDAYS eller WEEKENDS — sa uten dette oppslaget
// ville «Ukedager» aldri blitt vist, bare de fem dagene skrevet ut i sin helhet.
function matchKeyword(days) {
  const set = new Set(days);
  const is = (list) => set.size === list.length && list.every((day) => set.has(day));

  if (is([0, 1, 2, 3, 4, 5, 6])) return 'DAILY';
  if (is([1, 2, 3, 4, 5])) return 'WEEKDAYS';
  if (is([0, 6])) return 'WEEKENDS';
  return null;
}

// Kortest mulige beskrivelse som fortsatt er entydig. En sensorflis i Homey
// viser rundt tjue tegn, og alt utover det forsvinner ordlost — sa lengden er
// ikke kosmetikk, den avgjor om verdien i det hele tatt er lesbar.
function describeDays(days, lang) {
  const set = new Set(days);
  const ordered = WEEK_ORDER.filter((day) => set.has(day));
  if (ordered.length === 0) return '';

  const labels = DAY_LABELS[lang];
  const parts = [];
  let run = [ordered[0]];

  // Tre dager eller mer pa rad skrives som et spenn. To blir ikke kortere av en
  // tankestrek, og «man-tir» ville dessuten lest som et spenn uten a vaere det.
  const flush = () => {
    if (run.length >= 3) parts.push(`${labels[run[0]]}–${labels[run[run.length - 1]]}`);
    else for (const day of run) parts.push(labels[day]);
  };

  for (let i = 1; i < ordered.length; i += 1) {
    const adjacent = WEEK_ORDER.indexOf(ordered[i]) === WEEK_ORDER.indexOf(ordered[i - 1]) + 1;
    if (adjacent) { run.push(ordered[i]); continue; }
    flush();
    run = [ordered[i]];
  }
  flush();

  return parts.join(', ');
}

function describeRecurrence(recurrence, language = 'en') {
  const lang = DAY_LABELS[language] ? language : 'en';
  const text = String(recurrence || '').toUpperCase();

  if (KEYWORD_LABELS[text]) return KEYWORD_LABELS[text][lang];

  const days = recurrenceToDays(text);
  if (days.length === 0) return text || '';

  const keyword = matchKeyword(days);
  if (keyword) return KEYWORD_LABELS[keyword][lang];

  return describeDays(days, lang);
}

module.exports = {
  KEYWORDS,
  WEEK_ORDER,
  matchKeyword,
  describeDays,
  DAY_PRESETS,
  daysForPreset,
  isValidRecurrence,
  daysToRecurrence,
  recurrenceToDays,
  describeRecurrence,
};
