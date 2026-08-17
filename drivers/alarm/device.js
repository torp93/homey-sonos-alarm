'use strict';

const Homey = require('homey');
const { describeRecurrence } = require('../../lib/recurrence');
const { normalizeTime } = require('../../lib/alarm-clock');
const { roomName } = require('../../lib/zone-topology');

// Hvor lenge et oppslått romnavn får stå. Rom bytter navn sjelden, men de gjør
// det, og en time er kort nok til at endringen kommer av seg selv.
const ROOM_NAME_MAX_AGE_MS = 60 * 60 * 1000;

class AlarmDevice extends Homey.Device {
  async onInit() {
    this.alarmId = String(this.getData().id);

    this.registerCapabilityListener('onoff', (value) =>
      this._change({ enabled: value === true }));

    this.registerCapabilityListener('sonos_alarm_volume', (value) =>
      this._change({ volume: Number(value) }));

    this._onAlarms = (alarms) => {
      this._apply(alarms).catch((error) => this.error('Oppdatering feilet', error));
    };
    this.homey.app.alarms.on('alarms', this._onAlarms);

    // Appen poller uansett, men en enhet som nettopp ble lagt til skal ikke stå
    // tom til neste runde.
    this.homey.app.refresh().catch((error) => this.error('Første henting feilet', error));

    this.log(`Alarm ${this.alarmId} initialisert`);
  }

  async onUninit() {
    this._detach();
  }

  // onUninit dekker at appen stopper. Sletter brukeren enheten, er det
  // onDeleted som kommer — og uten denne ble lytteren stående igjen og skrev
  // til en enhet som ikke finnes lenger, så lenge appen kjørte.
  async onDeleted() {
    this._detach();
  }

  _detach() {
    if (!this._onAlarms) return;
    this.homey.app.alarms.off('alarms', this._onAlarms);
    this._onAlarms = null;
  }

  async _apply(alarms) {
    const alarm = alarms.find((candidate) => candidate.id === this.alarmId);

    if (!alarm) {
      // Alarmen er slettet i Sonos-appen. Å la enheten stå igjen med gamle
      // verdier ville vært verre: flows ville fortsatt «virke» uten å treffe noe.
      await this.setUnavailable(this.homey.__('device.missing'));
      return;
    }

    await this.setAvailable();

    const room = await this._roomName(alarm.roomUUID);

    await this._set('onoff', alarm.enabled);
    await this._set('sonos_alarm_time', (alarm.startTime || '').slice(0, 5));
    await this._set('sonos_alarm_volume', alarm.volume);
    await this._set('sonos_alarm_recurrence',
      describeRecurrence(alarm.recurrence, this.homey.i18n.getLanguage()));
    await this._set('sonos_alarm_room', room);
  }

  // Romnavnet krever et oppslag i topologien, så det bufres. Rom bytter sjelden
  // navn, og dette kjører ved hver polling.
  //
  // Bufferet har en levetid. Uten den ble navnet stående for alltid: en alarms
  // RoomUUID endres aldri, så treffet var evig, og et rom du døpte om i
  // Sonos-appen beholdt det gamle navnet til appen ble startet på nytt.
  // Oppslaget går dessuten gjennom appens egen topologi-buffer i stedet for et
  // eget kall per enhet.
  async _roomName(uuid) {
    const fresh = this._roomCache
      && this._roomCache.uuid === uuid
      && Date.now() - this._roomCache.at < ROOM_NAME_MAX_AGE_MS;
    if (fresh) return this._roomCache.name;

    try {
      const name = roomName(await this.homey.app.getTopology(), uuid);
      this._roomCache = { uuid, name, at: Date.now() };
      return name;
    } catch (error) {
      this.error('Kunne ikke slå opp romnavn', error);
      return this._roomCache ? this._roomCache.name : '';
    }
  }

  async _set(capability, value) {
    if (!this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    await this.setCapabilityValue(capability, value)
      .catch((error) => this.error(`Kunne ikke sette ${capability}`, error));
  }

  async _change(changes) {
    return this.homey.app.applyChange(this.alarmId, changes);
  }

  // ---- brukt av flow-kortene ----

  async setTime(time) {
    const normalized = normalizeTime(time);
    if (!normalized) throw new Error(`${this.homey.__('error.badTime')} ${time}`);
    return this._change({ startTime: normalized });
  }

  async setVolume(volume) {
    if (!Number.isFinite(volume)) throw new Error(this.homey.__('error.badVolume'));
    return this._change({ volume });
  }

  async setRecurrence(recurrence) {
    return this._change({ recurrence });
  }
}

module.exports = AlarmDevice;
