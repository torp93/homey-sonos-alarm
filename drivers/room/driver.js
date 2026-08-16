'use strict';

const Homey = require('homey');

class RoomDriver extends Homey.Driver {
  // Ingen egen paringsvisning: rommene kommer fra topologien, og appen finner
  // en høyttaler selv. list_devices-malen er første visning her, og da kaller
  // Homey onPairListDevices av seg selv.
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
