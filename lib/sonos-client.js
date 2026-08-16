'use strict';

const http = require('http');
const {
  buildEnvelope, soapAction, parseFault,
} = require('./soap');
const {
  ALARM_FIELDS, CREATE_FIELDS, parseAlarms, alarmToArgs, normalizeAlarm,
} = require('./alarm-clock');
const { listRooms, roomName } = require('./zone-topology');
const { FAVORITES_OBJECT_ID, PLAYLISTS_OBJECT_ID, listSources } = require('./favorites');

const PORT = 1400;

const SERVICES = {
  alarmClock: {
    service: 'AlarmClock:1',
    path: '/AlarmClock/Control',
  },
  topology: {
    service: 'ZoneGroupTopology:1',
    path: '/ZoneGroupTopology/Control',
  },
  content: {
    service: 'ContentDirectory:1',
    path: '/MediaServer/ContentDirectory/Control',
  },
};

// Ingen autentisering noe sted i denne fila, og det er ikke en forglemmelse:
// UPnP-grensesnittet på port 1400 stoler på alle på LAN-et. Det er nettopp
// derfor appen slipper OAuth og tokenfornyelse.
class SonosClient {
  constructor({ host, timeoutMs = 8000, log = () => {} } = {}) {
    this.host = host;
    this.timeoutMs = timeoutMs;
    this.log = log;
  }

  async request(target, action, args = []) {
    const { service, path } = SERVICES[target];
    const body = buildEnvelope(service, action, args);

    const response = await this._post(path, body, soapAction(service, action));

    if (response.statusCode !== 200) {
      const fault = parseFault(response.body);
      const detail = fault ? `${fault.message} (UPnP ${fault.code})` : `HTTP ${response.statusCode}`;
      throw new Error(`${action} feilet: ${detail}`);
    }
    return response.body;
  }

  _post(path, body, action) {
    return new Promise((resolve, reject) => {
      const payload = Buffer.from(body, 'utf8');
      const request = http.request({
        host: this.host,
        port: PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'Content-Length': payload.length,
          SOAPACTION: action,
        },
        timeout: this.timeoutMs,
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({
          statusCode: response.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });

      // 'timeout' avbryter ikke forespørselen av seg selv — uten destroy() blir
      // løftet hengende til TCP-en gir opp, som kan ta minutter.
      request.on('timeout', () => {
        request.destroy(new Error(`Tidsavbrudd mot ${this.host}`));
      });
      request.on('error', reject);
      request.end(payload);
    });
  }

  async listAlarms() {
    return parseAlarms(await this.request('alarmClock', 'ListAlarms'));
  }

  async updateAlarm(alarm) {
    const normalized = normalizeAlarm(alarm);
    await this.request('alarmClock', 'UpdateAlarm', alarmToArgs(normalized, ALARM_FIELDS));
    return normalized;
  }

  async createAlarm(alarm) {
    const normalized = normalizeAlarm(alarm);
    const xml = await this.request(
      'alarmClock', 'CreateAlarm', alarmToArgs(normalized, CREATE_FIELDS),
    );
    // AssignedID er bekreftet som utparameter i SCPD-en. Uten den vet vi ikke
    // hvilken alarm vi nettopp laget, og enheten kan ikke knyttes til den.
    const assigned = /<AssignedID>(\d+)<\/AssignedID>/.exec(xml);
    if (!assigned) throw new Error('Sonos returnerte ingen AssignedID for den nye alarmen');
    return { ...normalized, id: assigned[1] };
  }

  async destroyAlarm(id) {
    await this.request('alarmClock', 'DestroyAlarm', [['ID', String(id)]]);
  }

  // Favorittene er alarmkildene. Argumentrekkefølgen er fra SCPD-en for
  // ContentDirectory og er like streng som AlarmClock sin.
  async browse(objectId, count = 100) {
    return this.request('content', 'Browse', [
      ['ObjectID', objectId],
      ['BrowseFlag', 'BrowseDirectChildren'],
      ['Filter', '*'],
      ['StartingIndex', '0'],
      ['RequestedCount', String(count)],
      ['SortCriteria', ''],
    ]);
  }

  async browseFavorites() {
    return this.browse(FAVORITES_OBJECT_ID);
  }

  async browsePlaylists() {
    return this.browse(PLAYLISTS_OBJECT_ID);
  }

  async listSources(language = 'en') {
    // Spillelistene hentes ved siden av favorittene. Feiler den ene, skal ikke
    // hele kildelista falle bort.
    const [favoritesXml, playlistsXml] = await Promise.all([
      this.browseFavorites().catch(() => ''),
      this.browsePlaylists().catch(() => ''),
    ]);
    return listSources({ favoritesXml, playlistsXml }, language);
  }

  async zoneGroupState() {
    return this.request('topology', 'GetZoneGroupState');
  }

  async listRooms() {
    return listRooms(await this.zoneGroupState());
  }

  async roomName(uuid) {
    return roomName(await this.zoneGroupState(), uuid);
  }
}

module.exports = { SonosClient, PORT, SERVICES };
