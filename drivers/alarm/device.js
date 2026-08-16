'use strict';

const Homey = require('homey');
const { describeRecurrence } = require('../../lib/recurrence');
const { normalizeTime } = require('../../lib/alarm-clock');

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
    if (this._onAlarms) this.homey.app.alarms.off('alarms', this._onAlarms);
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

  // Romnavnet krever et eget kall mot topologien, så det bufres. Rom bytter
  // sjelden navn, og dette kjører ved hver polling.
  async _roomName(uuid) {
    if (this._roomCache && this._roomCache.uuid === uuid) return this._roomCache.name;
    try {
      const client = await this.homey.app.getClient();
      const name = await client.roomName(uuid);
      this._roomCache = { uuid, name };
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
    if (!normalized) throw new Error(`Ugyldig tidspunkt: ${time}`);
    return this._change({ startTime: normalized });
  }

  async setVolume(volume) {
    if (!Number.isFinite(volume)) throw new Error('Ugyldig volum');
    return this._change({ volume });
  }

  async setRecurrence(recurrence) {
    return this._change({ recurrence });
  }
}

module.exports = AlarmDevice;
