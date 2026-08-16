'use strict';

const Homey = require('homey');
const { describeSource } = require('../../lib/favorites');
const { normalizeTime } = require('../../lib/alarm-clock');

class RoomDriver extends Homey.Driver {
  // Ingen egen paringsvisning: rommene kommer fra topologien, og appen finner
  // en høyttaler selv. list_devices-malen er første visning her, og da kaller
  // Homey onPairListDevices av seg selv.
  // Reparasjonsvisningen er det ENESTE stedet på en ferdig lagt til enhet der
  // et nedtrekk kan fylles ved kjøring. Enhetsinnstillinger har statiske
  // nedtrekk kompilert inn i manifestet; her er det egen HTML med handlere.
  async onRepair(session, device) {
    session.setHandler('getSources', async () => {
      const sources = await this.homey.app.listSources();
      const language = this.homey.i18n.getLanguage();
      return sources.map((source) => ({
        id: source.id,
        title: source.title,
        label: describeSource(source, language),
      }));
    });

    // Visningen starter der malen på enheten står, i stedet for å nullstille
    // valgene brukeren allerede har gjort i innstillingene.
    session.setHandler('getTemplate', () => {
      const settings = device.getSettings();
      const days = [
        settings.newSunday ? '0' : '', settings.newMonday ? '1' : '',
        settings.newTuesday ? '2' : '', settings.newWednesday ? '3' : '',
        settings.newThursday ? '4' : '', settings.newFriday ? '5' : '',
        settings.newSaturday ? '6' : '',
      ].join('');

      return {
        time: normalizeTime(settings.newTime),
        volume: Number(settings.newVolume),
        days,
      };
    });

    session.setHandler('createAlarm', async (input) => {
      this.log('createAlarm fra reparasjon:', JSON.stringify(input));
      const created = await this.homey.app.createAlarm({
        roomUUID: String(device.getData().id),
        startTime: input.startTime,
        recurrence: input.recurrence,
        volume: Number(input.volume),
        enabled: true,
        sourceId: input.sourceId,
      });
      return { id: created.id };
    });
  }

  async onPairListDevices() {
    const rooms = await this.homey.app.listRooms();
    const known = new Set(this.getDevices().map((device) => String(device.getData().id)));

    const fresh = rooms.filter((room) => !known.has(room.uuid));
    this.log(`Fant ${rooms.length} rom, ${fresh.length} ikke lagt til fra før`);

    return fresh.map((room) => ({
      name: room.name,
      data: {
        // Koordinatorens UUID er romets identitet. Den er stabil så lenge
        // rommet finnes, og overlever at alarmer kommer og går.
        id: room.uuid,
      },
    }));
  }
}

module.exports = RoomDriver;
