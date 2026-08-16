'use strict';

const SETTING_HOST = 'speakerHost';
const SETTING_POLL = 'pollSeconds';

const DEFAULT_POLL_SECONDS = 120;
const MIN_POLL_SECONDS = 30;
const MAX_POLL_SECONDS = 3600;

function isValidHost(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  // Bare IPv4. Sonos annonserer alltid LOCATION med IP, aldri vertsnavn, og et
  // navn som ikke lar seg slå opp ville gitt en langt mer kryptisk feil senere.
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(text)
    && text.split('.').every((part) => Number(part) <= 255);
}

// Polling er den eneste måten å fange endringer gjort i Sonos-appen på —
// AlarmClock sender ingen hendelser vi kan abonnere på uten en egen
// callback-server. Standarden er bevisst rolig; alarmer endres sjelden, og
// Homey Pro har lite RAM å avse.
function resolvePollSeconds(settings) {
  const stored = settings.get(SETTING_POLL);
  // Homeys settings.get() gir null for en usatt verdi, og Number(null) er 0 —
  // ikke NaN. Uten denne sjekken faller standarden bort og nullen klemmes til
  // nedre grense i stedet, som ga fire ganger hyppigere polling enn tiltenkt.
  if (stored === null || stored === undefined || stored === '') return DEFAULT_POLL_SECONDS;

  const raw = Number(stored);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_POLL_SECONDS;
  return Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, Math.round(raw)));
}

// IP-er må sammenlignes oktett for oktett. Strengsortering setter «.124» foran
// «.44», som gjorde at appen valgte en tilfeldig høyttaler i stedet for den
// laveste — og valget ble dessuten ustabilt mellom omstarter.
function compareHosts(a, b) {
  const left = String(a).split('.').map(Number);
  const right = String(b).split('.').map(Number);
  for (let i = 0; i < 4; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

function sortHosts(hosts) {
  return [...hosts].sort(compareHosts);
}

function resolveHost(settings) {
  const configured = String(settings.get(SETTING_HOST) || '').trim();
  if (isValidHost(configured)) return { host: configured, source: 'innstilling' };
  return { host: null, source: 'oppdagelse' };
}

module.exports = {
  SETTING_HOST,
  SETTING_POLL,
  DEFAULT_POLL_SECONDS,
  MIN_POLL_SECONDS,
  MAX_POLL_SECONDS,
  isValidHost,
  resolveHost,
  resolvePollSeconds,
  compareHosts,
  sortHosts,
};
