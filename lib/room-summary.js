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

// Neste gang en av alarmene faktisk ringer. Bare aktiverte alarmer teller —
// en avslått alarm som «neste» ville vært direkte villedende.
function nextAlarm(alarms, now) {
  const enabled = (alarms || []).filter((alarm) => alarm.enabled);
  let best = null;

  for (const alarm of enabled) {
    const at = nextOccurrence(alarm, now);
    if (at && (!best || at < best.at)) best = { alarm, at };
  }

  return best;
}

function nextOccurrence(alarm, now) {
  const parts = /^(\d{2}):(\d{2})/.exec(alarm.startTime || '');
  if (!parts) return null;

  const hours = Number(parts[1]);
  const minutes = Number(parts[2]);
  const days = recurrenceToDays(alarm.recurrence);
  // ONCE gir tom dagsliste: den ringer neste gang klokkeslettet passeres,
  // uansett ukedag.
  const once = days.length === 0;

  // Åtte dager fram dekker enhver ukentlig gjentakelse, også når dagens
  // tidspunkt allerede er passert.
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = new Date(now.getTime());
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hours, minutes, 0, 0);

    if (candidate <= now) continue;
    if (once || days.includes(candidate.getDay())) return candidate;
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

function formatTime(date) {
  if (!date) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

module.exports = {
  alarmsForRoom, nextAlarm, nextOccurrence, describeRoom, formatTime,
};
