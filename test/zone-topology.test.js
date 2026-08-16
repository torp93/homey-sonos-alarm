'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  parseZoneGroups, listRooms, roomName, coordinatorFor, coordinatorHosts, hostFromLocation,
} = require('../lib/zone-topology');
const { ZONE_GROUP_STATE } = require('./fixtures');

test('parser alle sonegruppene', () => {
  assert.strictEqual(parseZoneGroups(ZONE_GROUP_STATE).length, 3);
});

test('mister ikke grupper der medlemmet er en beholder med satellitter', () => {
  // Dette er feilen røyktesten mot ekte høyttalere avdekket: bare 2 av 5 rom
  // kom med, fordi hvert hjemmekinooppsett har et ZoneGroupMember som ikke
  // lukker seg selv.
  const rooms = listRooms(ZONE_GROUP_STATE).map((room) => room.name);
  assert.deepStrictEqual(rooms, ['Bad', 'Soverom', 'Stue']);
});

test('leser satellittene som medlemmer av gruppen', () => {
  const soverom = parseZoneGroups(ZONE_GROUP_STATE)
    .find((group) => group.coordinator === 'RINCON_48A6B8BB557B01400');
  assert.strictEqual(soverom.members.length, 4);
  assert.strictEqual(soverom.members.filter((member) => member.satellite).length, 3);
});

test('satellitter er alltid usynlige', () => {
  const soverom = parseZoneGroups(ZONE_GROUP_STATE)
    .find((group) => group.coordinator === 'RINCON_48A6B8BB557B01400');
  assert.ok(soverom.members.filter((m) => m.satellite).every((m) => m.invisible));
});

test('stereopar har to medlemmer, ett usynlig', () => {
  const bad = parseZoneGroups(ZONE_GROUP_STATE)
    .find((group) => group.coordinator === 'RINCON_7828CAF57DC601400');
  assert.strictEqual(bad.members.length, 2);
  assert.strictEqual(bad.members.filter((member) => member.invisible).length, 1);
});

test('romlista har ett rom per gruppe, ikke ett per høyttaler', () => {
  const rooms = listRooms(ZONE_GROUP_STATE);
  assert.strictEqual(rooms.length, 3);
  assert.ok(rooms.every((room) => room.uuid && room.name));
});

test('slår opp romnavn for en satellitt alarmen peker på', () => {
  // Alarm 485 og 575 peker begge på denne UUID-en, som er en surroundhøyttaler
  // og ikke et gruppemedlem. Uten satellittstøtte ble navnet tomt.
  assert.strictEqual(roomName(ZONE_GROUP_STATE, 'RINCON_7828CA8108D001400'), 'Soverom');
});

test('slår opp romnavn for usynlig halvdel av et stereopar', () => {
  assert.strictEqual(roomName(ZONE_GROUP_STATE, 'RINCON_7828CAF6B25001400'), 'Bad');
});

test('finner koordinatoren en satellitt hører til', () => {
  assert.strictEqual(
    coordinatorFor(ZONE_GROUP_STATE, 'RINCON_7828CA8108D001400'),
    'RINCON_48A6B8BB557B01400',
  );
});

test('plukker IP-en ut av Location', () => {
  assert.strictEqual(
    hostFromLocation('http://192.168.10.87:1400/xml/device_description.xml'),
    '192.168.10.87',
  );
  assert.strictEqual(hostFromLocation(''), '');
  assert.strictEqual(hostFromLocation(undefined), '');
});

test('lister adressene til koordinatorene, ikke til satellittene', () => {
  // Suben i Soverom (192.168.10.124) svarer på SSDP, men er en satellitt og
  // skal ikke være appens inngang.
  const hosts = coordinatorHosts(ZONE_GROUP_STATE);
  assert.ok(hosts.includes('192.168.10.87'));
  assert.ok(!hosts.includes('192.168.10.124'));
});

test('ukjent UUID gir tom streng, ikke feil', () => {
  assert.strictEqual(roomName(ZONE_GROUP_STATE, 'RINCON_TULL'), '');
  assert.strictEqual(coordinatorFor(ZONE_GROUP_STATE, 'RINCON_TULL'), '');
});
