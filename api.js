'use strict';

const { discoverSpeakers } = require('./lib/discovery');

// Innstillingssiden når appen gjennom dette. Logikken ligger i app.js og ikke
// her, slik at paringen og innstillingene oppfører seg likt.
module.exports = {
  async testSpeaker({ homey, body }) {
    return homey.app.testSpeaker(body && body.host);
  },

  async discover() {
    return { hosts: await discoverSpeakers({ durationMs: 6000 }) };
  },

  // Alt siden trenger i ett kall — rom, alarmer og gruppetilhørighet.
  async overview({ homey }) {
    return homey.app.overview();
  },

  async setEnabled({ homey, body }) {
    await homey.app.applyChange(body.id, { enabled: body.enabled === true });
    return { ok: true };
  },

  async updateAlarm({ homey, body }) {
    homey.app.log('updateAlarm fra innstillinger:', JSON.stringify(body));
    const changes = {};
    if (body.time) changes.startTime = body.time;
    if (body.recurrence) changes.recurrence = body.recurrence;
    if (body.volume !== undefined) changes.volume = Number(body.volume);
    if (body.duration) changes.duration = body.duration;

    // Lydkilden kan byttes på en alarm som finnes. Hele blokka må skrives om,
    // ikke bare URI-en — metadataen bærer tjenestereferansen, og en URI uten
    // matchende metadata gir en alarm som ser riktig ut men er stum.
    if (body.sourceId) {
      const { findSource } = require('./lib/favorites');
      const sources = await homey.app.listSources();
      const source = findSource(sources, body.sourceId);

      if (source) {
        changes.programURI = source.uri;
        changes.programMetaData = source.metadata;
        changes.playMode = source.radio || source.id === 'buzzer' ? 'NORMAL' : 'SHUFFLE';
      } else if (body.sourceId !== body.currentSourceId) {
        // Ukjent lyd som ikke er den alarmen alt spiller: da er det en reell
        // feil, og vi skal ikke gjette.
        throw new Error(`${homey.__('error.unknownSource')} ${body.sourceId}`);
      }
      // Ellers: alarmen spiller noe som ikke lenger står blant favorittene —
      // en avstjernet spilleliste, eller noe valgt i Sonos-appen. Metadataen
      // er tjenestebundet og kan ikke gjenskapes, så lydfeltene lates i fred
      // og brukeren får endre tid, dager og volum uten å miste musikken.
    }

    await homey.app.applyChange(body.id, changes);
    return { ok: true };
  },

  async listSources({ homey }) {
    // Uten uri og metadata: siden skal bare vise navnene, og blobbene er store.
    const sources = await homey.app.listSourcesForUi();
    homey.app.log(`listSources: ${sources.length} kilde(r) til innstillingssiden`);
    return sources;
  },

  async createAlarm({ homey, body }) {
    homey.app.log('createAlarm fra innstillinger:', JSON.stringify(body));
    const created = await homey.app.createAlarm({
      roomUUID: body.roomUUID,
      startTime: body.time,
      recurrence: body.recurrence,
      volume: Number(body.volume),
      enabled: body.enabled !== false,
      sourceId: body.sourceId || 'buzzer',
    });
    return { id: created.id };
  },

  async deleteAlarm({ homey, body }) {
    await homey.app.deleteAlarm(body.id);
    return { ok: true };
  },
};
