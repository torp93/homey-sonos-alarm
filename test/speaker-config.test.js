'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  isValidHost, resolveHost, resolvePollSeconds, sortHosts, compareHosts,
  DEFAULT_POLL_SECONDS, MIN_POLL_SECONDS, MAX_POLL_SECONDS,
} = require('../lib/speaker-config');

// Nok av Homeys settings-API til at modulen kan testes uten Homey.
function fakeSettings(values = {}) {
  return { get: (key) => values[key] };
}

test('godtar gyldige IPv4-adresser', () => {
  assert.ok(isValidHost('192.168.10.134'));
  assert.ok(isValidHost('  10.0.0.1  '));
});

test('avviser vertsnavn og ugyldige adresser', () => {
  for (const value of ['sonos.local', '192.168.10', '999.1.1.1', '', null]) {
    assert.ok(!isValidHost(value), `skulle avvist ${value}`);
  }
});

test('bruker adressen fra innstillingene når den er gyldig', () => {
  const { host, source } = resolveHost(fakeSettings({ speakerHost: '192.168.10.134' }));
  assert.strictEqual(host, '192.168.10.134');
  assert.strictEqual(source, 'innstilling');
});

test('faller tilbake til oppdagelse når adressen mangler eller er tull', () => {
  for (const value of [undefined, '', 'sonos.local']) {
    const { host, source } = resolveHost(fakeSettings({ speakerHost: value }));
    assert.strictEqual(host, null);
    assert.strictEqual(source, 'oppdagelse');
  }
});

test('pollintervall faller tilbake til standarden', () => {
  assert.strictEqual(resolvePollSeconds(fakeSettings({})), DEFAULT_POLL_SECONDS);
  assert.strictEqual(resolvePollSeconds(fakeSettings({ pollSeconds: 'tull' })), DEFAULT_POLL_SECONDS);
});

test('null fra settings.get gir standarden, ikke nedre grense', () => {
  // Homey returnerer null for en usatt innstilling, og Number(null) er 0 —
  // ikke NaN. Første kjøring på Homey pollet derfor hvert 30. sekund i stedet
  // for hvert 120.
  assert.strictEqual(resolvePollSeconds(fakeSettings({ pollSeconds: null })), DEFAULT_POLL_SECONDS);
  assert.strictEqual(resolvePollSeconds(fakeSettings({ pollSeconds: '' })), DEFAULT_POLL_SECONDS);
  assert.strictEqual(resolvePollSeconds(fakeSettings({ pollSeconds: 0 })), DEFAULT_POLL_SECONDS);
});

test('pollintervall klemmes innenfor grensene', () => {
  // Nedre grense finnes for Homeyens skyld: alarmer endres sjelden, og
  // hyppig polling er ren belastning på en Homey som allerede har lite RAM.
  assert.strictEqual(resolvePollSeconds(fakeSettings({ pollSeconds: 1 })), MIN_POLL_SECONDS);
  assert.strictEqual(resolvePollSeconds(fakeSettings({ pollSeconds: 99999 })), MAX_POLL_SECONDS);
  assert.strictEqual(resolvePollSeconds(fakeSettings({ pollSeconds: 300 })), 300);
});

test('sorterer adresser numerisk, ikke som tekst', () => {
  // Strengsortering satte .124 foran .44, som gjorde at appen valgte suben
  // i Soverom som inngang i stedet for den laveste adressen.
  assert.deepStrictEqual(
    sortHosts(['192.168.10.124', '192.168.10.44', '192.168.10.87']),
    ['192.168.10.44', '192.168.10.87', '192.168.10.124'],
  );
});

test('sortering endrer ikke lista som ble sendt inn', () => {
  const hosts = ['192.168.10.124', '192.168.10.44'];
  sortHosts(hosts);
  assert.deepStrictEqual(hosts, ['192.168.10.124', '192.168.10.44']);
});

test('sammenligning gir 0 for like adresser', () => {
  assert.strictEqual(compareHosts('10.0.0.1', '10.0.0.1'), 0);
});
