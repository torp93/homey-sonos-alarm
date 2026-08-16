'use strict';

const {
  extractElement, parseAttributes, decodeEntities,
} = require('./soap');
const { isValidRecurrence } = require('./recurrence');

// Rekkefølgen er hentet fra SCPD-en på høyttaleren (/xml/AlarmClock1.xml).
// Merk at argumentene IKKE har «Desired»-prefiks, i motsetning til f.eks.
// RenderingControl sin SetVolume. Feil navn gir UPnP-feil 402.
const ALARM_FIELDS = [
  'ID',
  'StartLocalTime',
  'Duration',
  'Recurrence',
  'Enabled',
  'RoomUUID',
  'ProgramURI',
  'ProgramMetaData',
  'PlayMode',
  'Volume',
  'IncludeLinkedZones',
];

// CreateAlarm tar de samme feltene, men uten ID — den tildeles av Sonos.
const CREATE_FIELDS = ALARM_FIELDS.filter((field) => field !== 'ID');

// Den innebygde pipelyden. ProgramMetaData skal være tom for denne, og det er
// grunnen til at alarmer kan lages fra bunnen uten en kontobundet DIDL-blob.
const BUZZER_URI = 'x-rincon-buzzer:0';

// <Alarm> er selvlukkende for alarmer laget over UPnP, men en BEHOLDER med et
// <Content>-barn for alarmer laget i Sonos-appen på nyere firmware:
//
//   <Alarm ID="2589" ... IncludeLinkedZones="0"/>
//   <Alarm ID="2587" ... IncludeLinkedZones="0">
//       <Content type="other" serviceId="buzzer" objectId="0"/>
//   </Alarm>
//
// Et uttrykk som bare matcher den selvlukkende formen dropper alarmer stille —
// og det er nettopp brukerens egne alarmer som forsvinner. Samme felle som
// ZoneGroupMember i zone-topology.js; begge former må håndteres.
const ALARM_PATTERN = /<Alarm\b([^>]*?)\/?>/g;

function parseAlarms(xml) {
  const list = extractElement(xml, 'CurrentAlarmList');
  // Lista ligger som escapet XML inni CurrentAlarmList.
  const inner = list ? decodeEntities(list) : (xml || '');

  const alarms = [];
  ALARM_PATTERN.lastIndex = 0;
  let match = ALARM_PATTERN.exec(inner);
  while (match) {
    const attributes = parseAttributes(match[1]);
    // Åpningstaggen matcher én gang uansett form, men uten ID er det ikke en
    // alarm vi kan gjøre noe med.
    if (attributes.ID) alarms.push(toAlarm(attributes));
    match = ALARM_PATTERN.exec(inner);
  }
  return alarms;
}

function toAlarm(attributes) {
  return {
    id: String(attributes.ID || ''),
    // Attributtet heter StartTime ut, men StartLocalTime inn. Sonos er ikke
    // symmetrisk her, og det er lett å tro at man har mistet feltet.
    startTime: normalizeTime(attributes.StartTime || attributes.StartLocalTime),
    duration: attributes.Duration || '02:00:00',
    recurrence: (attributes.Recurrence || 'ONCE').toUpperCase(),
    enabled: attributes.Enabled === '1',
    roomUUID: attributes.RoomUUID || '',
    programURI: attributes.ProgramURI || BUZZER_URI,
    programMetaData: attributes.ProgramMetaData || '',
    playMode: attributes.PlayMode || 'NORMAL',
    volume: clampVolume(attributes.Volume),
    includeLinkedZones: attributes.IncludeLinkedZones === '1',
  };
}

// Gir alltid HH:MM:SS tilbake, som er det eneste Sonos aksepterer — men er
// romslig med hva den tar imot. Feltet fylles ut for hånd, og det er urimelig
// å kreve kolon av noen som bare vil skrive «0700».
//
// Godtar:
//   7  07            → 07:00:00
//   730  0730        → 07:30:00
//   073045           → 07:30:45
//   7:30  07.30      → 07:30:00
//   07:30:45         → 07:30:45
//
// Avviser fortsatt ekte tull: bokstaver, 2400, 0760, tomme felt.
function normalizeTime(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;

  let parts;
  if (/[:.\-\s]/.test(text)) {
    // Skilletegnet kan være hva som helst av kolon, punktum, bindestrek eller
    // mellomrom — norske tastatur gir gjerne punktum.
    parts = text.split(/[:.\-\s]+/).filter((part) => part !== '');
    if (parts.length < 2 || parts.length > 3) return null;
    if (!parts.every((part) => /^\d{1,2}$/.test(part))) return null;
  } else {
    if (!/^\d+$/.test(text)) return null;
    // Sifre uten skilletegn tolkes bakfra: de to siste er minutter, resten er
    // timer. «730» blir 7:30, ikke 73:0.
    switch (text.length) {
      case 1:
      case 2: parts = [text, '0']; break;
      case 3: parts = [text.slice(0, 1), text.slice(1)]; break;
      case 4: parts = [text.slice(0, 2), text.slice(2)]; break;
      case 5: parts = [text.slice(0, 1), text.slice(1, 3), text.slice(3)]; break;
      case 6: parts = [text.slice(0, 2), text.slice(2, 4), text.slice(4)]; break;
      default: return null;
    }
  }

  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2] || 0);
  if (![hours, minutes, seconds].every(Number.isInteger)) return null;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

function clampVolume(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, number));
}

function alarmToArgs(alarm, fields = ALARM_FIELDS) {
  const values = {
    ID: alarm.id,
    StartLocalTime: alarm.startTime,
    Duration: alarm.duration,
    Recurrence: alarm.recurrence,
    Enabled: alarm.enabled ? '1' : '0',
    RoomUUID: alarm.roomUUID,
    ProgramURI: alarm.programURI,
    ProgramMetaData: alarm.programMetaData,
    PlayMode: alarm.playMode,
    Volume: String(clampVolume(alarm.volume)),
    IncludeLinkedZones: alarm.includeLinkedZones ? '1' : '0',
  };
  return fields.map((field) => [field, values[field]]);
}

// Validering alene er ikke nok: den bekrefter bare at verdiene KAN normaliseres.
// Sender man «09:15» videre urørt, avviser Sonos den med 402, siden feltet må
// være HH:MM:SS. Alle skriveveier må derfor gjennom denne først.
function normalizeAlarm(alarm) {
  validateAlarm(alarm);
  return {
    ...alarm,
    startTime: normalizeTime(alarm.startTime),
    duration: normalizeTime(alarm.duration),
    recurrence: String(alarm.recurrence).toUpperCase(),
    volume: clampVolume(alarm.volume),
  };
}

// Kastes før nettverkskallet. Sonos svarer bare «402» uansett hva som er galt,
// så en presis feilmelding må lages her.
function validateAlarm(alarm) {
  if (!normalizeTime(alarm.startTime)) {
    throw new Error(`Invalid start time: ${alarm.startTime}`);
  }
  if (!normalizeTime(alarm.duration)) {
    throw new Error(`Invalid duration: ${alarm.duration}`);
  }
  if (!isValidRecurrence(alarm.recurrence)) {
    throw new Error(`Invalid recurrence: ${alarm.recurrence}`);
  }
  if (!alarm.roomUUID) {
    throw new Error('The alarm has no room (RoomUUID)');
  }
  if (!alarm.programURI) {
    throw new Error('The alarm has no sound (ProgramURI)');
  }
  return true;
}

// En endring skal aldri sende delvise felt: UpdateAlarm overskriver ALLE felt,
// så et utelatt felt blir nullstilt i stedet for å beholdes.
function mergeAlarm(existing, changes) {
  return normalizeAlarm({ ...existing, ...changes });
}

// «Samme alarm» er tid, gjentakelse og lydkilde i samme rom. Volum og av/på
// teller IKKE med: det er nettopp de to man justerer på en alarm som allerede
// finnes, og teller de med, blir hver justering en ny alarm i stedet for en
// endring av den gamle.
function findEquivalentAlarm(alarms, candidate, belongsToRoom) {
  const time = normalizeTime(candidate.startTime);
  const recurrence = String(candidate.recurrence || '').toUpperCase();

  return (alarms || []).find((alarm) => alarm.startTime === time
    && alarm.recurrence === recurrence
    && alarm.programURI === candidate.programURI
    && belongsToRoom(alarm)) || null;
}

module.exports = {
  ALARM_FIELDS,
  CREATE_FIELDS,
  BUZZER_URI,
  parseAlarms,
  normalizeTime,
  clampVolume,
  alarmToArgs,
  validateAlarm,
  normalizeAlarm,
  mergeAlarm,
  findEquivalentAlarm,
};
