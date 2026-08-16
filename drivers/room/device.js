'use strict';

const Homey = require('homey');
const {
  alarmsForRoom, nextAlarm, describeRoom, formatTime, numberedList, alarmAtPosition,
} = require('../../lib/room-summary');
const { normalizeTime, findEquivalentAlarm } = require('../../lib/alarm-clock');
const { daysToRecurrence } = require('../../lib/recurrence');
const { findSourceByTitle } = require('../../lib/favorites');

class RoomDevice extends Homey.Device {
  async onInit() {
    this.roomUUID = String(this.getData().id);

    // Av/på gjelder hele rommet. Bevisst ingen bryter per alarm: nummererte
    // plasser flytter seg når en alarm slettes i Sonos, og en flow ville da
    // pekt på feil alarm uten å si fra. Presisjonen ligger i alarm-enhetene.
    this.registerCapabilityListener('onoff', async (value) => {
      const count = await this.homey.app.setRoomEnabled(this.roomUUID, value === true);
      this.log(`${count} alarm(er) i rommet satt til ${value ? 'på' : 'av'}`);
    });

    // Vedlikeholdsknapp: lager en alarm i DETTE rommet med verdiene fra
    // enhetsinnstillingene. Ingen romvelger — enheten er rommet.
    this.registerCapabilityListener('button.create_alarm', () => this._createFromSettings());

    this._onAlarms = (alarms) => {
      this._apply(alarms).catch((error) => this.error('Oppdatering feilet', error));
    };
    this.homey.app.alarms.on('alarms', this._onAlarms);

    this.homey.app.refresh().catch((error) => this.error('Første henting feilet', error));
    this._fillMissingSettings().catch((error) => this.error('Kunne ikke fylle standarder', error));
    this.log(`Rom ${this.roomUUID} initialisert`);
  }

  async onSettings({ newSettings, changedKeys }) {
    this.log('Innstillinger lagret, endret:', changedKeys.join(', '));
    const deleting = newSettings.deletePosition && newSettings.deletePosition !== 'none';
    if (newSettings.applyOnSave === false && !deleting) return;

    // Bare endringer i selve alarmen skal utløse noe. Uten dette ville en
    // endring av en helt urelatert innstilling skrevet til Sonos.
    const relevant = [
      'newTime', 'newSource', 'newVolume', 'applyOnSave', 'deletePosition',
      'newMonday', 'newTuesday', 'newWednesday', 'newThursday',
      'newFriday', 'newSaturday', 'newSunday',
    ];
    if (!changedKeys.some((key) => relevant.includes(key))) return;

    // Kjøres ETTER at Homey er ferdig med lagringen: setSettings inne i
    // onSettings kaster.
    this.homey.setTimeout(() => {
      this._applySettings(newSettings)
        .catch((error) => this.error('Kunne ikke bruke innstillingene', error));
    }, 500);
  }

  async _applySettings(settings) {
    const deleting = settings.deletePosition && settings.deletePosition !== 'none';

    if (deleting) {
      await this._deleteSelection(settings.deletePosition);

      // Sletting og gjenoppretting i samme lagring gjorde slettingen
      // meningsløs: alarmen ble borte og lagt til igjen i samme trykk. Derfor
      // slås «Bruk når du lagrer» av her, og opprettelsen hoppes over.
      await this.setSettings({ deletePosition: 'none', applyOnSave: false }).catch(() => {});
      return;
    }

    if (settings.applyOnSave !== false) await this._createFromSettings();
  }

  async _deleteSelection(selection) {
    const resolve = await this.homey.app.coordinatorResolver();
    const client = await this.homey.app.getClient();
    // Lista leses på nytt her, ikke fra det etiketten viste. Er en alarm
    // slettet i mellomtiden, peker plassen på noe annet.
    const mine = alarmsForRoom(await client.listAlarms(), resolve, this.roomUUID);

    if (selection === 'all') {
      if (mine.length === 0) {
        this.log('Ingen alarmer i rommet — sletter ingenting');
        return;
      }
      this.log(`Sletter alle ${mine.length} alarm(er) i rommet`);
      await this.homey.app.deleteAlarms(mine, this.getName());
      return;
    }

    const target = alarmAtPosition(mine, selection);
    if (!target) {
      this.error(`Plass ${selection} finnes ikke blant ${mine.length} alarm(er) — sletter ingenting`);
      return;
    }

    this.log(`Sletter alarm ${target.id} (${target.startTime}) fra plass ${selection}`);
    await this.homey.app.deleteAlarm(target.id);
  }

  async onUninit() {
    if (this._onAlarms) this.homey.app.alarms.off('alarms', this._onAlarms);
  }

  // Enheter som ble paret FØR disse innstillingene fantes, får dem ikke
  // etterfylt av Homey. Da er feltene tomme på nettopp de enhetene som har
  // vært der lengst, og «Opprett alarm» feiler på et tidspunkt som aldri ble satt.
  async _fillMissingSettings() {
    const defaults = {
      applyOnSave: true,
      newTime: '07:00',
      newSource: 'Sonos chime',
      newVolume: 30,
      newMonday: true,
      newTuesday: true,
      newWednesday: true,
      newThursday: true,
      newFriday: true,
      newSaturday: false,
      newSunday: false,
    };

    const current = this.getSettings();
    const missing = {};
    for (const key of Object.keys(defaults)) {
      if (current[key] === undefined || current[key] === null || current[key] === '') {
        missing[key] = defaults[key];
      }
    }

    if (Object.keys(missing).length === 0) return;
    this.log('Fyller inn manglende standardinnstillinger:', Object.keys(missing).join(', '));
    await this.setSettings(missing);
  }

  async _createFromSettings() {
    const settings = this.getSettings();
    this.log('Opprett alarm, innstillinger:', JSON.stringify(settings));

    const time = normalizeTime(settings.newTime);
    if (!time) {
      throw new Error(`${this.homey.__('error.badTime')} ${settings.newTime}`);
    }

    const days = [
      settings.newSunday ? 0 : null,
      settings.newMonday ? 1 : null,
      settings.newTuesday ? 2 : null,
      settings.newWednesday ? 3 : null,
      settings.newThursday ? 4 : null,
      settings.newFriday ? 5 : null,
      settings.newSaturday ? 6 : null,
    ].filter((day) => day !== null);

    const recurrence = daysToRecurrence(days);
    if (!recurrence) throw new Error(this.homey.__('error.noDays'));

    // Kilden skrives som tekst fordi nedtrekk i enhetsinnstillinger må
    // deklareres statisk, og favorittlista er ikke kjent på forhånd.
    const sources = await this.homey.app.listSources();
    const source = findSourceByTitle(sources, settings.newSource);
    if (!source) {
      // Hele lista i feilmeldingen: brukeren skal slippe å gjette hva som er
      // gyldig når navnet ikke traff.
      const names = sources.map((candidate) => candidate.title).join(', ');
      throw new Error(`${this.homey.__('error.unknownSource')} ${names}`);
    }

    // Lagre skal alltid gjelde, uten at brukeren må huske et kryss. Da MÅ
    // opprettelsen være idempotent: uten dette ville hver volumjustering blitt
    // en ny alarm i stedet for en endring av den som allerede finnes.
    const client = await this.homey.app.getClient();
    const resolve = await this.homey.app.coordinatorResolver();
    const existing = findEquivalentAlarm(
      await client.listAlarms(),
      { startTime: time, recurrence, programURI: source.uri },
      (alarm) => resolve(alarm.roomUUID) === this.roomUUID,
    );

    if (existing) {
      await this.homey.app.applyChange(existing.id, {
        volume: Number(settings.newVolume),
        enabled: true,
      });
      this.log(`Alarm ${existing.id} fantes fra før — oppdatert i stedet for duplisert`);
      return;
    }

    const created = await this.homey.app.createAlarm({
      roomUUID: this.roomUUID,
      startTime: time,
      recurrence,
      volume: Number(settings.newVolume),
      enabled: true,
      sourceId: source.id,
    });

    this.log(`Alarm ${created.id} opprettet fra rom-enheten (${source.title})`);
  }

  async _apply(alarms) {
    const resolve = await this.homey.app.coordinatorResolver();
    const mine = alarmsForRoom(alarms, resolve, this.roomUUID);

    const language = this.homey.i18n.getLanguage();
    const next = nextAlarm(mine, new Date());

    // «På» betyr at minst én alarm i rommet er aktiv. Å kreve at alle er på
    // ville gjort brytaren av i det vanlige tilfellet der ett av flere
    // tidspunkt står avslått.
    await this._set('onoff', mine.some((alarm) => alarm.enabled));
    await this._set('sonos_room_count', mine.length);
    await this._set('sonos_room_summary', describeRoom(mine, language));
    await this._set('sonos_room_next', next
      ? formatTime(next.at)
      : (language === 'no' ? 'Ingen' : 'None'));

    // Etiketten oppdateres ved hver polling, så numrene i nedtrekket alltid
    // svarer til noe som faktisk finnes. Etiketter kan settes ved kjøring —
    // nedtrekk kan ikke, og det er hele grunnen til at det er nummer og ikke navn.
    const listing = numberedList(mine, language);
    if (this.getSettings().alarmList !== listing) {
      await this.setSettings({ alarmList: listing }).catch(() => {});
    }
  }

  async _set(capability, value) {
    if (!this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    await this.setCapabilityValue(capability, value)
      .catch((error) => this.error(`Kunne ikke sette ${capability}`, error));
  }
}

module.exports = RoomDevice;
