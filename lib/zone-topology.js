'use strict';

const { extractElement, decodeEntities, parseAttributes } = require('./soap');

// En alarms RoomUUID må peke på sonens koordinator. Romnavnet i
// /xml/device_description.xml duger ikke: bundne par og surroundhøyttalere
// deler navn, og bare én av dem er koordinator.
//
// To fallgruver, begge bekreftet mot ekte XML fra et anlegg med soundbar,
// surround og sub:
//
//   1. <ZoneGroupMember> er selvlukkende når høyttaleren står alene, men en
//      beholder med <Satellite>-barn når den har surround eller sub knyttet
//      til seg. Matcher man bare den selvlukkende formen, forsvinner hver
//      eneste gruppe som har et hjemmekinooppsett.
//   2. Satellittene har egne UUID-er, og en alarm kan godt peke på en av dem.
//      De må derfor være med i oppslaget, ikke bare gruppemedlemmene.

// Fanger åpningstaggen til begge elementtypene, uansett om den lukker seg selv.
const MEMBER_PATTERN = /<(ZoneGroupMember|Satellite)\b([^>]*?)\/?>/g;

function parseZoneGroups(xml) {
  const state = extractElement(xml, 'ZoneGroupState');
  const inner = state ? decodeEntities(state) : (xml || '');

  const groups = [];
  const groupPattern = /<ZoneGroup\b([^>]*?)>([\s\S]*?)<\/ZoneGroup>/g;
  let match = groupPattern.exec(inner);

  while (match) {
    const attributes = parseAttributes(match[1]);
    groups.push({
      coordinator: attributes.Coordinator || '',
      id: attributes.ID || '',
      members: parseMembers(match[2]),
    });
    match = groupPattern.exec(inner);
  }

  return groups;
}

function parseMembers(content) {
  const members = [];
  MEMBER_PATTERN.lastIndex = 0;
  let match = MEMBER_PATTERN.exec(content);

  while (match) {
    const [, tag, rawAttributes] = match;
    const fields = parseAttributes(rawAttributes);
    if (fields.UUID) {
      members.push({
        uuid: fields.UUID,
        name: fields.ZoneName || '',
        // Location er en full URL til enhetsbeskrivelsen. IP-en derfra sparer
        // oss for et eget oppslag når vi vil snakke med en bestemt høyttaler.
        host: hostFromLocation(fields.Location),
        satellite: tag === 'Satellite',
        // Bundne enheter (sub, surround, andre halvdel av et stereopar) er
        // usynlige og skal aldri tilbys som rom for en ny alarm. Satellitter
        // er det per definisjon, uansett hva attributtet sier.
        invisible: fields.Invisible === '1' || tag === 'Satellite',
      });
    }
    match = MEMBER_PATTERN.exec(content);
  }

  return members;
}

function hostFromLocation(location) {
  const match = /^https?:\/\/([\d.]+):\d+\//.exec(String(location || ''));
  return match ? match[1] : '';
}

// Adressene til de synlige koordinatorene. Appen bruker den laveste som
// inngang: en bundet sub eller surroundhøyttaler svarer riktignok like godt,
// men er et dårligere valg å knytte seg til enn en høyttaler som står alene.
function coordinatorHosts(xml) {
  return parseZoneGroups(xml)
    .map((group) => group.members.find((member) => member.uuid === group.coordinator))
    .filter((member) => member && member.host)
    .map((member) => member.host);
}

// Ett valgbart rom per gruppe, navngitt etter koordinatoren.
function listRooms(xml) {
  return parseZoneGroups(xml)
    .map((group) => {
      const coordinator = group.members.find((member) => member.uuid === group.coordinator);
      if (!coordinator) return null;
      return { uuid: coordinator.uuid, name: coordinator.name };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Alarmer peker ofte på en satellitt eller et usynlig medlem — slik blir det
// når et rom bindes til et hjemmekinooppsett etter at alarmen ble laget.
// Navnet må derfor slås opp på medlemmet, ikke på koordinatoren.
function roomName(xml, uuid) {
  for (const group of parseZoneGroups(xml)) {
    const member = group.members.find((candidate) => candidate.uuid === uuid);
    if (member) return member.name;
  }
  return '';
}

// Alarmen spilles av koordinatoren for gruppen UUID-en hører til. Trengs når en
// ny alarm skal lages: peker man den på en satellitt, blir den aldri hørt.
function coordinatorFor(xml, uuid) {
  for (const group of parseZoneGroups(xml)) {
    if (group.members.some((member) => member.uuid === uuid)) return group.coordinator;
  }
  return '';
}

module.exports = {
  parseZoneGroups,
  parseMembers,
  listRooms,
  roomName,
  coordinatorFor,
  coordinatorHosts,
  hostFromLocation,
};
