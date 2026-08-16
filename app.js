'use strict';

const Homey = require('homey');
const EventEmitter = require('events');
const { SonosClient } = require('./lib/sonos-client');
const { discoverSpeakers } = require('./lib/discovery');
const { daysToRecurrence, describeRecurrence } = require('./lib/recurrence');
const { mergeAlarm, BUZZER_URI } = require('./lib/alarm-clock');
const { findSource } = require('./lib/favorites');
const {
  coordinatorHosts, coordinatorFor, listRooms, roomName,
} = require('./lib/zone-topology');
const {
  SETTING_HOST, SETTING_POLL, isValidHost, resolveHost, resolvePollSeconds, sortHosts,
} = require('./lib/speaker-config');

class SonosAlarmApp extends Homey.App {
  async onInit() {
    this._client = null;
    this._host = null;
    this._timer = null;
    this._topologyXml = null;
    this._topologyAt = 0;
    // Enhetene lytter her i stedet for å polle hver for seg. Med én alarm per
    // enhet ville N enheter gitt N kall mot samme høyttaler for samme svar.
    this.alarms = new EventEmitter();
    this.alarms.setMaxListeners(0);

    this.registerFlowCards();

    this.homey.settings.on('set', (key) => {
      if (key === SETTING_HOST) this.resetClient();
      if (key === SETTING_POLL) this.restartPolling();
    });

    this.restartPolling();
    this.log(`Sonos Alarm v${this.manifest.version} startet`);
  }

  async onUninit() {
    this.stopPolling();
  }

  // ---- tilkobling ----

  // Adressen kan komme fra innstillingene eller fra SSDP. Alarmlista er
  // husholdnings-global, så hvilken som helst høyttaler duger som inngang.
  async getClient() {
    if (this._client) return this._client;

    const { host, source } = resolveHost(this.homey.settings);
    let address = host;

    if (!address) {
      const found = await discoverSpeakers({
        durationMs: 5000,
        log: (...args) => this.log('[ssdp]', ...args),
      });
      if (found.length === 0) throw new Error(this.homey.__('error.noSpeakers'));
      address = await this._pickSpeaker(found);
    }

    this._host = address;
    this._client = new SonosClient({
      host: address,
      log: (...args) => this.log('[sonos]', ...args),
    });
    this.log(`Klient opprettet mot ${address} (${source})`);
    return this._client;
  }

  // SSDP svarer i tilfeldig rekkefølge, og blant svarerne er bundne suber og
  // surroundhøyttalere. De duger teknisk — alarmlista er husholdnings-global —
  // men en høyttaler som står alene er en stødigere inngang. Topologien vet
  // hvem som er koordinator, så vi spør den første som svarer.
  async _pickSpeaker(found) {
    const [first] = sortHosts(found);

    try {
      const xml = await new SonosClient({ host: first, timeoutMs: 5000 }).zoneGroupState();
      const [coordinator] = sortHosts(coordinatorHosts(xml));
      if (coordinator) {
        this.log(`Bruker koordinatoren ${coordinator} av ${found.length} oppdagede høyttalere`);
        return coordinator;
      }
    } catch (error) {
      // Ikke verdt å avbryte for: den oppdagede adressen svarer på alarmene
      // like fullt, og et dårligere valg er bedre enn ingen app.
      this.error('Kunne ikke lese topologien — bruker oppdaget adresse', error);
    }

    this.log(`Bruker ${first} av ${found.length} oppdagede høyttalere`);
    return first;
  }

  // Adressen som er i bruk nå, eller null. Utløser bevisst ingen oppdagelse:
  // den som spør vil vite om vi allerede har en, ikke vente på et søk.
  currentHost() {
    return this._host;
  }

  resetClient() {
    this._client = null;
    this._host = null;
    // Topologien og favorittene hører til den gamle høyttaleren og kan være fra
    // et annet anlegg hvis adressen ble endret.
    this._topologyXml = null;
    this._topologyAt = 0;
    this._sources = null;
    this._sourcesAt = 0;
    this.log('Adresse endret — klienten bygges på nytt ved neste kall');
  }

  // Brukes av innstillingssiden og av paringen, slik at begge avviser en
  // adresse på samme grunnlag.
  async testSpeaker(host) {
    if (!isValidHost(host)) throw new Error(this.homey.__('error.badAddress'));
    const client = new SonosClient({ host: String(host).trim(), timeoutMs: 6000 });
    const rooms = await client.listRooms();
    const alarms = await client.listAlarms();
    return { rooms, alarmCount: alarms.length };
  }

  // ---- polling ----

  restartPolling() {
    this.stopPolling();
    const seconds = resolvePollSeconds(this.homey.settings);
    this._timer = this.homey.setInterval(
      () => this.refresh().catch((error) => this.error('Polling feilet', error)),
      seconds * 1000,
    );
    this.log(`Poller alarmlista hvert ${seconds}. sekund`);
    // Første henting med en gang, ellers står enhetene uten verdier til første
    // intervall har gått — opptil en time med den høyeste innstillingen.
    this.refresh().catch((error) => this.error('Første henting feilet', error));
  }

  stopPolling() {
    if (!this._timer) return;
    this.homey.clearInterval(this._timer);
    this._timer = null;
  }

  async refresh() {
    const client = await this.getClient();
    const alarms = await client.listAlarms();
    this.alarms.emit('alarms', alarms);
    return alarms;
  }

  // ---- endringer ----

  // Alle skriveveier går hit. UpdateAlarm overskriver samtlige felt, så den
  // gjeldende alarmen må hentes først og endringene legges oppå — ellers
  // nullstilles f.eks. lydkilden når man bare ville flytte tidspunktet.
  async applyChange(alarmId, changes) {
    const client = await this.getClient();
    const alarms = await client.listAlarms();
    const existing = alarms.find((alarm) => alarm.id === String(alarmId));
    if (!existing) throw new Error(`${this.homey.__('error.unknownAlarm')} ${alarmId}`);

    const updated = mergeAlarm(existing, changes);
    await client.updateAlarm(updated);
    this.log(`Alarm ${alarmId} oppdatert`, changes);

    // Nye verdier ut til enhetene med en gang, i stedet for å vente på neste
    // polling — ellers spretter brytaren tilbake i appen.
    this.alarms.emit('alarms', alarms.map((a) => (a.id === updated.id ? updated : a)));
    return updated;
  }

  // Bare buzzer-alarmer kan lages fra bunnen. En musikkalarms ProgramMetaData
  // inneholder en kontobundet tokenreferanse som ikke lar seg konstruere — den
  // må kopieres fra en alarm eller favoritt som allerede finnes.
  // Kildene er favorittene dine pluss den innebygde tonen. De bufres: lista
  // endres bare når du stjernemerker noe i Sonos-appen.
  async listSources({ maxAgeMs = 300000 } = {}) {
    const age = this._sourcesAt ? Date.now() - this._sourcesAt : Infinity;
    if (this._sources && age < maxAgeMs) return this._sources;

    const client = await this.getClient();
    this._sources = await client.listSources(this.homey.i18n.getLanguage());
    this._sourcesAt = Date.now();
    this.log(`${this._sources.length} alarmkilde(r) tilgjengelig`);
    return this._sources;
  }

  async createAlarm({
    roomUUID, startTime, recurrence = 'DAILY', volume = 30, enabled = true,
    duration = '02:00:00', sourceId = 'buzzer',
  }) {
    const client = await this.getClient();

    // En musikk- eller radiokilde kan ikke konstrueres, men favoritten bærer
    // med seg både URI og metadata — vi kopierer dem ordrett.
    const source = findSource(await this.listSources(), sourceId);
    if (!source) throw new Error(`${this.homey.__('error.unknownSource')} ${sourceId}`);

    const created = await client.createAlarm({
      startTime,
      duration,
      recurrence,
      enabled,
      roomUUID,
      programURI: source.uri,
      programMetaData: source.metadata,
      // Radio er en sammenhengende strøm; SHUFFLE gir ingen mening der, og en
      // spilleliste vil man som regel ha i tilfeldig rekkefølge.
      playMode: source.uri === BUZZER_URI || source.radio ? 'NORMAL' : 'SHUFFLE',
      volume,
      includeLinkedZones: false,
    });

    this.log(
      `Alarm ${created.id} opprettet ${created.startTime} (${created.recurrence})`
      + ` — kilde: ${source.title}`,
    );
    await this.refresh().catch((error) => this.error('Henting etter opprettelse feilet', error));
    return created;
  }

  // Gjelder ALLE alarmer i husholdningen, også de som ikke er lagt til som
  // enheter i Homey — det er hele poenget med kortet.
  async setAllEnabled(enabled) {
    const client = await this.getClient();
    const alarms = await client.listAlarms();
    const targets = alarms.filter((alarm) => alarm.enabled !== enabled);

    if (targets.length === 0) {
      this.log(`Alle ${alarms.length} alarm(er) er allerede ${enabled ? 'på' : 'av'}`);
      return { changed: 0, total: alarms.length };
    }

    const failed = [];
    // Bevisst i sekvens, ikke parallelt: hver UpdateAlarm skriver til samme
    // husholdningsliste, og samtidige skriv gir sporadiske 402-er.
    for (const alarm of targets) {
      try {
        await client.updateAlarm({ ...alarm, enabled });
      } catch (error) {
        failed.push(alarm.id);
        this.error(`Kunne ikke sette alarm ${alarm.id}`, error);
      }
    }

    await this.refresh().catch((error) => this.error('Henting etter endring feilet', error));

    if (failed.length > 0) {
      throw new Error(
        `${targets.length - failed.length} av ${targets.length} alarmer endret. `
        + `Feilet: ${failed.join(', ')}`,
      );
    }

    this.log(`${targets.length} alarm(er) slått ${enabled ? 'på' : 'av'}`);
    return { changed: targets.length, total: alarms.length };
  }

  async listRooms() {
    const client = await this.getClient();
    return client.listRooms();
  }

  async deleteAlarm(id) {
    const client = await this.getClient();
    await client.destroyAlarm(id);
    this.log(`Alarm ${id} slettet`);
    // Enheten som pekte hit blir utilgjengelig ved neste runde, ikke slettet.
    // Å fjerne brukerens Homey-enhet automatisk ville tatt med seg flowene den
    // er brukt i, uten at brukeren ba om det.
    await this.refresh().catch((error) => this.error('Henting etter sletting feilet', error));
  }

  // Alt innstillingssiden trenger i ett kall: alarmene, rommene deres, og
  // hvilket rom hver alarm hører til. Tre separate kall ville gitt siden tre
  // ulike øyeblikksbilder å sy sammen.
  async overview() {
    const client = await this.getClient();
    const [alarms, topology] = await Promise.all([
      client.listAlarms(),
      this.getTopology({ maxAgeMs: 30000 }),
    ]);

    const rooms = listRooms(topology);
    const language = this.homey.i18n.getLanguage();

    return {
      rooms,
      alarms: alarms.map((alarm) => ({
        id: alarm.id,
        time: (alarm.startTime || '').slice(0, 5),
        enabled: alarm.enabled,
        volume: alarm.volume,
        duration: alarm.duration,
        recurrence: alarm.recurrence,
        recurrenceLabel: describeRecurrence(alarm.recurrence, language),
        roomUUID: alarm.roomUUID,
        roomName: roomName(topology, alarm.roomUUID),
        // Gruppering skjer på koordinatoren, ikke på RoomUUID: to alarmer i
        // samme rom kan peke på hver sin høyttaler i gruppen.
        groupUUID: coordinatorFor(topology, alarm.roomUUID),
        music: alarm.programURI !== BUZZER_URI,
      })),
    };
  }

  // Topologien bufres: den endres bare når du flytter høyttalere eller bygger
  // om et rom, men rom-enhetene trenger den ved hver polling.
  async getTopology({ maxAgeMs = 300000 } = {}) {
    const age = this._topologyAt ? Date.now() - this._topologyAt : Infinity;
    if (this._topologyXml && age < maxAgeMs) return this._topologyXml;

    const client = await this.getClient();
    this._topologyXml = await client.zoneGroupState();
    this._topologyAt = Date.now();
    return this._topologyXml;
  }

  // Hvilken gruppe en UUID hører til. Rom-enhetene bruker den for å samle sine
  // egne alarmer, siden en alarm gjerne peker på en satellitt.
  async coordinatorResolver() {
    const xml = await this.getTopology();
    return (uuid) => coordinatorFor(xml, uuid);
  }

  // Alarmene i ett rom. Tilhørighet avgjøres av hvilken gruppe UUID-en ligger
  // i, ikke av likhet — en alarm peker gjerne på en satellitt.
  async alarmsInRoom(coordinatorUUID) {
    const client = await this.getClient();
    const resolve = await this.coordinatorResolver();
    const alarms = await client.listAlarms();
    return alarms.filter((alarm) => resolve(alarm.roomUUID) === coordinatorUUID);
  }

  // Sletting kan ikke angres — Sonos har ingen papirkurv. Antallet logges og
  // returneres slik at en flow i det minste etterlater et spor av hva som forsvant.
  async deleteAlarms(alarms, what) {
    const client = await this.getClient();
    const failed = [];

    // Sekvensielt: samtidige skriv mot samme husholdningsliste gir sporadiske 402-er.
    for (const alarm of alarms) {
      try {
        await client.destroyAlarm(alarm.id);
        this.log(`Alarm ${alarm.id} (${alarm.startTime}) slettet`);
      } catch (error) {
        failed.push(alarm.id);
        this.error(`Kunne ikke slette alarm ${alarm.id}`, error);
      }
    }

    await this.refresh().catch((error) => this.error('Henting etter sletting feilet', error));

    if (failed.length > 0) {
      throw new Error(
        `${alarms.length - failed.length} av ${alarms.length} alarmer slettet fra ${what}. `
        + `Feilet: ${failed.join(', ')}`,
      );
    }

    this.log(`${alarms.length} alarm(er) slettet fra ${what}`);
    return alarms.length;
  }

  async deleteAlarmsInRoom(coordinatorUUID, roomLabel) {
    return this.deleteAlarms(await this.alarmsInRoom(coordinatorUUID), roomLabel || 'rommet');
  }

  async deleteAllAlarms() {
    const client = await this.getClient();
    return this.deleteAlarms(await client.listAlarms(), 'hele husholdningen');
  }

  async setRoomEnabled(coordinatorUUID, enabled) {
    const client = await this.getClient();
    const resolve = await this.coordinatorResolver();
    const alarms = await client.listAlarms();
    const mine = alarms.filter((alarm) => resolve(alarm.roomUUID) === coordinatorUUID);

    for (const alarm of mine.filter((alarm) => alarm.enabled !== enabled)) {
      await client.updateAlarm({ ...alarm, enabled });
    }

    await this.refresh().catch((error) => this.error('Henting etter romendring feilet', error));
    return mine.length;
  }

  registerFlowCards() {
    this.homey.flow
      .getActionCard('sonos_alarm_set_time')
      .registerRunListener(({ device, time }) => device.setTime(time));

    this.homey.flow
      .getActionCard('sonos_alarm_set_volume')
      .registerRunListener(({ device, volume }) => device.setVolume(Number(volume)));

    this.homey.flow
      .getActionCard('sonos_alarm_set_recurrence')
      .registerRunListener(({ device, recurrence }) => device.setRecurrence(recurrence));

    this.homey.flow
      .getActionCard('sonos_alarm_set_days')
      .registerRunListener(({
        device, monday, tuesday, wednesday, thursday, friday, saturday, sunday,
      }) => {
        const days = [
          sunday === 'yes' ? 0 : null,
          monday === 'yes' ? 1 : null,
          tuesday === 'yes' ? 2 : null,
          wednesday === 'yes' ? 3 : null,
          thursday === 'yes' ? 4 : null,
          friday === 'yes' ? 5 : null,
          saturday === 'yes' ? 6 : null,
        ].filter((day) => day !== null);

        const recurrence = daysToRecurrence(days);
        if (!recurrence) throw new Error(this.homey.__('error.noDays'));
        return device.setRecurrence(recurrence);
      });

    // Opprettelse er app-omfattende og har derfor ingen device-parameter: det
    // finnes ingen Homey-enhet ennå når kortet kjører. Alarmen dukker opp som
    // enhet neste gang du parer.
    const create = this.homey.flow.getActionCard('sonos_alarm_create');

    create.registerArgumentAutocompleteListener('room', async (query) => {
      const rooms = await this.listRooms();
      return rooms
        .filter((room) => room.name.toLowerCase().includes(String(query || '').toLowerCase()))
        .map((room) => ({ name: room.name, id: room.uuid }));
    });

    create.registerArgumentAutocompleteListener('source', async (query) => {
      const sources = await this.listSources();
      const text = String(query || '').toLowerCase();
      return sources
        .filter((source) => source.title.toLowerCase().includes(text))
        .map((source) => ({
          name: source.title,
          description: source.radio ? 'Radio' : undefined,
          id: source.id,
        }));
    });

    create.registerRunListener(async ({ room, time, recurrence, volume, source }) => {
      const created = await this.createAlarm({
        roomUUID: room.id,
        startTime: time,
        recurrence,
        volume: Number(volume),
        enabled: true,
        // Kilde er valgfri i kortet: uten valg blir det den innebygde tonen,
        // som er det folk forventer av «alarm».
        sourceId: source ? source.id : 'buzzer',
      });
      // Tokens ut igjen, så en flow kan slå av eller slette alarmen den lagde.
      return { alarm_id: created.id };
    });

    this.homey.flow
      .getActionCard('sonos_alarm_enable_all')
      .registerRunListener(() => this.setAllEnabled(true));

    this.homey.flow
      .getActionCard('sonos_alarm_disable_all')
      .registerRunListener(() => this.setAllEnabled(false));

    // Rom-kortene deler samme autocomplete. Verdien som lagres i flowen er
    // koordinatorens UUID, ikke navnet: navn kan endres i Sonos-appen, og en
    // flow som pekte på «Soverom» ville da stilnet uten å feile.
    const roomAutocomplete = async (query) => {
      const rooms = await this.listRooms();
      return rooms
        .filter((room) => room.name.toLowerCase().includes(String(query || '').toLowerCase()))
        .map((room) => ({ name: room.name, id: room.uuid }));
    };

    // Rom-kortene peker på en Sonos-rom-enhet, ikke på et navn fra en liste.
    // Det gir dem driverens ikon — flow-kort uten enhet arver appikonet, og
    // `icon` per kort ignoreres — og det er dessuten enheten brukeren allerede
    // har lagt til. Enhetens data-id ER romets koordinator-UUID.
    const roomOf = (device) => String(device.getData().id);

    const roomCards = [
      ['sonos_alarm_enable_room', ({ device }) => this.setRoomEnabled(roomOf(device), true)],
      ['sonos_alarm_disable_room', ({ device }) => this.setRoomEnabled(roomOf(device), false)],
      ['sonos_alarm_delete_room',
        ({ device }) => this.deleteAlarmsInRoom(roomOf(device), device.getName())],
    ];

    for (const [id, run] of roomCards) {
      this.homey.flow.getActionCard(id).registerRunListener(run);
    }

    this.homey.flow
      .getActionCard('sonos_alarm_delete_all')
      .registerRunListener(() => this.deleteAllAlarms());

    this.homey.flow
      .getConditionCard('sonos_alarm_is_enabled')
      .registerRunListener(({ device }) => device.getCapabilityValue('onoff') === true);
  }
}

module.exports = SonosAlarmApp;
