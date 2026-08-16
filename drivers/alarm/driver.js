'use strict';

const Homey = require('homey');
const { discoverSpeakers } = require('../../lib/discovery');
const { describeAlarm } = require('../../lib/alarm-name');
const { roomName } = require('../../lib/zone-topology');
const { SETTING_HOST, isValidHost } = require('../../lib/speaker-config');

class AlarmDriver extends Homey.Driver {
  async onPair(session) {
    // Adressen appen allerede bruker, uten å utløse et nytt søk. Sparer seks
    // sekunder hver gang paringen åpnes med en høyttaler som alt er kjent.
    session.setHandler('currentSpeaker', () => ({ host: this.homey.app.currentHost() }));

    session.setHandler('discover', async () => {
      const hosts = await discoverSpeakers({
        durationMs: 6000,
        log: (...args) => this.log('[ssdp]', ...args),
      });
      return { hosts };
    });

    session.setHandler('saveHost', async ({ host }) => {
      if (!isValidHost(host)) throw new Error('Adressen ser ikke gyldig ut.');
      await this.homey.settings.set(SETTING_HOST, String(host).trim());
      return this.homey.app.testSpeaker(host);
    });

    // Logges i begge ender: et handler-kall som henger ser i visningen ut som
    // «Laster …» i all evighet, uten en eneste linje noe sted.
    session.setHandler('getSources', async () => {
      const sources = await this.homey.app.listSources();
      // Bare det visningen trenger: metadata-blobbene er store og har ingenting
      // i et nedtrekk å gjøre.
      return sources.map((source) => ({
        id: source.id,
        title: source.title,
        radio: source.radio,
      }));
    });

    session.setHandler('getRooms', async () => {
      this.log('getRooms: henter rom …');
      try {
        const rooms = await this.homey.app.listRooms();
        this.log(`getRooms: ${rooms.length} rom`);
        return rooms;
      } catch (error) {
        this.error('getRooms feilet', error);
        // Kastes videre som ren tekst: en feil som ikke serialiseres blir borte
        // på veien til visningen, og da henger kallet i stedet for å feile.
        throw new Error(error.message || 'Kunne ikke hente rom');
      }
    });

    // Lager alarmen i Sonos og gir tilbake enhetsbeskrivelsen, slik at
    // visningen kan kalle Homey.createDevice og bli ferdig i én operasjon.
    session.setHandler('createAlarm', async (input) => {
      const created = await this.homey.app.createAlarm(input);
      const client = await this.homey.app.getClient();
      // Samme oppslag som i lista, så en nylaget alarm heter det samme som en
      // som legges til senere.
      const room = roomName(await client.zoneGroupState(), created.roomUUID);
      return {
        name: this._describe(created, room),
        data: { id: created.id },
        store: { roomUUID: created.roomUUID },
      };
    });

    // MÅ registreres eksplisitt. Kommer man til list_devices-malen fra en egen
    // visning, kaller den ikke onPairListDevices selv — den viser bare en tom
    // liste, uten feil noe sted.
    session.setHandler('list_devices', () => this.onPairListDevices());
  }

  async onPairListDevices() {
    const client = await this.homey.app.getClient();
    // Hele topologien, ikke bare koordinatorene: alarmer peker ofte på en
    // satellitt, og da finnes ikke UUID-en i romlista.
    const [alarms, topology] = await Promise.all([
      client.listAlarms(),
      client.zoneGroupState(),
    ]);

    const known = new Set(this.getDevices().map((device) => String(device.getData().id)));
    const fresh = alarms.filter((alarm) => !known.has(alarm.id));

    this.log(`Fant ${alarms.length} alarm(er), ${fresh.length} ikke lagt til fra før`);

    return fresh.map((alarm) => ({
      name: this._describe(alarm, roomName(topology, alarm.roomUUID)),
      data: {
        // Alarm-ID-en er stabil i husholdningen og er det eneste Sonos gir oss
        // som identitet. Slettes alarmen i Sonos-appen, blir Homey-enheten
        // utilgjengelig i stedet for å peke på en fremmed alarm.
        id: alarm.id,
      },
      store: {
        roomUUID: alarm.roomUUID,
      },
    }));
  }

  _describe(alarm, room) {
    return describeAlarm(alarm, room, this.homey.i18n.getLanguage());
  }
}

module.exports = AlarmDriver;
