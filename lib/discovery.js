'use strict';

const dgram = require('dgram');

// SSDP fungerer her fordi appen kjører på Homey Pro, som står på samme LAN som
// høyttalerne. Kjører man appen i Docker på en PC i stedet, blir multicast
// upålitelig og denne skanningen finner ingenting — bruk manuell adresse da.

const MULTICAST_ADDRESS = '239.255.255.250';
const MULTICAST_PORT = 1900;
const SEARCH_TARGET = 'urn:schemas-upnp-org:device:ZonePlayer:1';

function buildSearchMessage(mx) {
  return [
    'M-SEARCH * HTTP/1.1',
    `HOST: ${MULTICAST_ADDRESS}:${MULTICAST_PORT}`,
    'MAN: "ssdp:discover"',
    `MX: ${mx}`,
    `ST: ${SEARCH_TARGET}`,
    '', '',
  ].join('\r\n');
}

// LOCATION ser ut som http://192.168.10.134:1400/xml/device_description.xml
function hostFromLocation(message) {
  const match = /LOCATION:\s*http:\/\/([\d.]+):1400\//i.exec(message);
  return match ? match[1] : null;
}

function isZonePlayer(message) {
  return /ZonePlayer/i.test(message) || /Sonos/i.test(message);
}

async function discoverSpeakers({ durationMs = 5000, log = () => {} } = {}) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const hosts = new Set();

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // close() kaster hvis socketen allerede er nede, og det skjer i nettopp
      // feilstien der vi minst har lyst på en ny feil oppå den første.
      try { socket.close(); } catch (ignored) { /* allerede lukket */ }
      if (error) reject(error);
      else resolve([...hosts]);
    };

    const timer = setTimeout(() => finish(null), durationMs);

    socket.on('error', finish);

    socket.on('message', (buffer) => {
      const message = buffer.toString('utf8');
      if (!isZonePlayer(message)) return;
      const host = hostFromLocation(message);
      if (host && !hosts.has(host)) {
        hosts.add(host);
        log(`Fant Sonos-høyttaler på ${host}`);
      }
    });

    socket.bind(() => {
      // MX må være mindre enn tidsvinduet vår, ellers rekker de tregeste
      // høyttalerne å svare etter at vi har gitt opp.
      const mx = Math.max(1, Math.floor(durationMs / 1000) - 1);
      const message = Buffer.from(buildSearchMessage(mx));
      socket.send(message, 0, message.length, MULTICAST_PORT, MULTICAST_ADDRESS, (error) => {
        if (error) finish(error);
      });
    });
  });
}

module.exports = {
  discoverSpeakers,
  buildSearchMessage,
  hostFromLocation,
  isZonePlayer,
  SEARCH_TARGET,
};
