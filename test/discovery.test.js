'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  buildSearchMessage, hostFromLocation, isZonePlayer, SEARCH_TARGET,
} = require('../lib/discovery');
const { SSDP_RESPONSE } = require('./fixtures');

test('M-SEARCH har feltene SSDP krever', () => {
  const message = buildSearchMessage(3);
  assert.ok(message.startsWith('M-SEARCH * HTTP/1.1\r\n'));
  assert.ok(message.includes('MAN: "ssdp:discover"'));
  assert.ok(message.includes(`ST: ${SEARCH_TARGET}`));
  assert.ok(message.includes('MX: 3'));
  // To avsluttende CRLF er ikke pynt — uten dem svarer ikke høyttalerne.
  assert.ok(message.endsWith('\r\n\r\n'));
});

test('plukker IP-en ut av LOCATION', () => {
  assert.strictEqual(hostFromLocation(SSDP_RESPONSE), '192.168.10.134');
});

test('ignorerer LOCATION på andre porter enn 1400', () => {
  const other = 'LOCATION: http://192.168.10.5:8080/desc.xml';
  assert.strictEqual(hostFromLocation(other), null);
});

test('kjenner igjen et Sonos-svar', () => {
  assert.ok(isZonePlayer(SSDP_RESPONSE));
  assert.ok(!isZonePlayer('SERVER: Some Printer UPnP/1.0'));
});
