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
    await homey.app.applyChange(body.id, changes);
    return { ok: true };
  },

  async listSources({ homey }) {
    // Uten uri og metadata: siden skal bare vise navnene, og blobbene er store.
    const { describeSource } = require('./lib/favorites');
    const language = homey.i18n.getLanguage();
    const sources = await homey.app.listSources();
    return sources.map((source) => ({
      id: source.id,
      title: source.title,
      label: describeSource(source, language),
      radio: source.radio,
    }));
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
