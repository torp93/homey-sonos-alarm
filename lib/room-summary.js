'use strict';

const { recurrenceToDays, describeRecurrence } = require('./recurrence');

// Romoversikten er bevisst read-only bortsett fra av/på for hele rommet.
// Alternativet — nummererte alarmplasser med hver sin bryter — ville gitt flows
// som peker på feil alarm så snart en alarm slettes i Sonos og de andre rykker
// opp. Presisjonen ligger i én-enhet-per-alarm; dette er oversikten.

// Alarmene som hører til rommet. En alarm kan peke på en satellitt, så
// tilhørighet avgjøres av hvilken gruppe UUID-en ligger i — ikke av likhet.
function alarmsForRoom(alarms, coordinatorOf, coordinatorUUID) {
  return (alarms || []).filter((alarm) => coordinatorOf(alarm.roomUUID) === coordinatorUUID);
}

// Sonos lagrer StartLocalTime som VEGGKLOKKE i høyttalerens sone — «07:00» er
// 07:00 slik klokka på veggen viser den, ikke et tidspunkt på tidslinja.
//
// Homey-apper kjører med process.env.TZ satt til UTC i SDK v3, så getHours(),
// setHours() og getDay() regner i UTC. Uten en eksplisitt sone bommer regningen
// med hele tidssoneforskjellen. Feilen er usynlig i klokkeslettet som vises —
// den forplanter seg like mye inn som ut — men den flytter grensen for «har den
// alt ringt i dag», og rundt midnatt havner alarmen da på feil ukedag.
//
// Derfor regner vi i én ramme: veggklokka legges inn i en Date som om den var
// UTC, og alt videre bruker UTC-getterne. formatTime() leser samme ramme.
function wallClock(now, timeZone) {
  try {
    return wallClockIn(now, timeZone);
  } catch (error) {
    // Intl kaster på et sonenavn den ikke kjenner. Én ubrukelig sone skal ikke
    // rive med seg hele oppdateringen av rommet — da ville brukeren mistet
    // alarmoversikten, ikke bare tidssonen.
    return timeZone ? wallClockIn(now, null) : new Date(now.getTime());
  }
}

function wallClockIn(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    // Uten timeZone løser Intl opp til prosessens egen sone, som er nettopp
    // oppførselen fra før. Da endres ingenting for den som ikke oppgir sone.
    ...(timeZone ? { timeZone } : {}),
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  return new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Enkelte ICU-versjoner gir «24» for midnatt med hour12: false.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  ));
}

// Neste gang en av alarmene faktisk ringer. Bare aktiverte alarmer teller —
// en avslått alarm som «neste» ville vært direkte villedende.
function nextAlarm(alarms, now, timeZone = null) {
  const enabled = (alarms || []).filter((alarm) => alarm.enabled);
  let best = null;

  for (const alarm of enabled) {
    const at = nextOccurrence(alarm, now, timeZone);
    if (at && (!best || at < best.at)) best = { alarm, at };
  }

  return best;
}

// Returnerer et veggklokke-tidspunkt: feltene leses med UTC-getterne, og
// formatTime() gjør nettopp det.
function nextOccurrence(alarm, now, timeZone = null) {
  const parts = /^(\d{2}):(\d{2})/.exec(alarm.startTime || '');
  if (!parts) return null;

  const hours = Number(parts[1]);
  const minutes = Number(parts[2]);
  const days = recurrenceToDays(alarm.recurrence);
  // ONCE gir tom dagsliste: den ringer neste gang klokkeslettet passeres,
  // uansett ukedag.
  const once = days.length === 0;

  const base = wallClock(now, timeZone);

  // Åtte dager fram dekker enhver ukentlig gjentakelse, også når dagens
  // tidspunkt allerede er passert.
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = new Date(base.getTime());
    candidate.setUTCDate(candidate.getUTCDate() + offset);
    candidate.setUTCHours(hours, minutes, 0, 0);

    if (candidate <= base) continue;
    if (once || days.includes(candidate.getUTCDay())) return candidate;
  }

  return null;
}

function describeRoom(alarms, language = 'en') {
  const list = alarms || [];
  if (list.length === 0) return language === 'no' ? 'Ingen alarmer' : 'No alarms';

  return list
    .slice()
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)))
    .map((alarm) => {
      const time = String(alarm.startTime || '').slice(0, 5);
      const when = describeRecurrence(alarm.recurrence, language);
      // Avslåtte alarmer må merkes, ellers ser oversikten ut som en liste over
      // alarmer som kommer til å ringe.
      const off = language === 'no' ? ' (av)' : ' (off)';
      return `${time} ${when}${alarm.enabled ? '' : off}`;
    })
    .join(' · ');
}

// Alarmene i rommet i fast, forutsigbar rekkefølge. Sortering på tid er det
// eneste stabile: Sonos gir dem i vilkårlig rekkefølge, og ID-rekkefølgen
// endres når alarmer slettes og lages.
function sortedByTime(alarms) {
  return (alarms || []).slice()
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
}

// Nummerert liste til etiketten, slik at «2» i nedtrekket har en synlig
// betydning. Nummereringen er 1-basert fordi den leses av mennesker.
function numberedList(alarms, language = 'en') {
  const sorted = sortedByTime(alarms);
  if (sorted.length === 0) return language === 'no' ? 'Ingen alarmer' : 'No alarms';

  return sorted
    .map((alarm, index) => {
      const time = String(alarm.startTime || '').slice(0, 5);
      const when = describeRecurrence(alarm.recurrence, language);
      const off = language === 'no' ? ' — av' : ' — off';
      return `${index + 1}: ${time} ${when}${alarm.enabled ? '' : off}`;
    })
    .join('\n');
}

// Alarmen på en gitt plass, 1-basert. Null hvis plassen er tom — da skal det
// ikke slettes noe i det hele tatt.
function alarmAtPosition(alarms, position) {
  const index = Number(position) - 1;
  if (!Number.isInteger(index) || index < 0) return null;
  return sortedByTime(alarms)[index] || null;
}

// Leser samme ramme som nextOccurrence bygger: veggklokka ligger i UTC-feltene.
// Med de lokale getterne ville tidspunktet blitt forskjøvet med prosessens egen
// sone og vist feil klokkeslett på enheten.
function formatTime(date) {
  if (!date) return '';
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

module.exports = {
  alarmsForRoom,
  nextAlarm,
  nextOccurrence,
  describeRoom,
  formatTime,
  sortedByTime,
  numberedList,
  alarmAtPosition,
};
