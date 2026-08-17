'use strict';

const test = require('node:test');
const assert = require('node:assert');

const http = require('http');
const { EventEmitter } = require('events');

const { SonosClient } = require('../lib/sonos-client');

// _post slår opp http.request på modulobjektet ved hvert kall, så en
// midlertidig erstatning her treffer den ekte koden uten å røre den.
async function withFakeHttp(handle, run) {
  const original = http.request;
  http.request = (options, callback) => {
    const request = new EventEmitter();
    request.destroy = (error) => request.emit('error', error);
    request.end = () => handle(callback, request);
    return request;
  };

  try {
    return await run();
  } finally {
    http.request = original;
  }
}

function respond(callback, emit) {
  setImmediate(() => {
    const response = new EventEmitter();
    response.statusCode = 200;
    callback(response);
    setImmediate(() => emit(response));
  });
}

// Klienten testes uten høyttaler ved å bytte ut _post. Alt over den — feilsjekk,
// argumentbygging og at skrivinger ikke gjentas — er ren logikk.
function stub(responses) {
  const client = new SonosClient({ host: '192.168.1.10' });
  const calls = [];

  client._post = async (path, body, action) => {
    calls.push({ path, body, action });
    const next = Array.isArray(responses) ? responses.shift() : responses;
    if (next instanceof Error) throw next;
    return next;
  };

  return { client, calls };
}

const OK_BODY = '<s:Envelope><s:Body><u:CreateAlarmResponse>'
  + '<AssignedID>4711</AssignedID></u:CreateAlarmResponse></s:Body></s:Envelope>';

const FAULT_BODY = '<s:Envelope><s:Body><s:Fault><faultcode>s:Client</faultcode>'
  + '<detail><UPnPError><errorCode>402</errorCode></UPnPError></detail>'
  + '</s:Fault></s:Body></s:Envelope>';

const VALID_ALARM = {
  startTime: '07:00:00',
  duration: '02:00:00',
  recurrence: 'DAILY',
  enabled: true,
  roomUUID: 'RINCON_1',
  programURI: 'x-rincon-buzzer:0',
  programMetaData: '',
  playMode: 'NORMAL',
  volume: 30,
  includeLinkedZones: false,
};

test('en feilkropp med HTTP 200 regnes ikke som suksess', async () => {
  // Sonos svarer normalt 500, men et mellomledd på nettet kan levere den samme
  // kroppen med 200. Leses det som suksess, melder CreateAlarm at alarmen ble
  // laget uten at noe traff høyttaleren.
  const { client } = stub({ statusCode: 200, body: FAULT_BODY });

  await assert.rejects(
    () => client.request('alarmClock', 'CreateAlarm', []),
    /CreateAlarm failed.*402/,
  );
});

test('en feilkropp med HTTP 500 gir samme forklaring', async () => {
  const { client } = stub({ statusCode: 500, body: FAULT_BODY });

  await assert.rejects(
    () => client.request('alarmClock', 'UpdateAlarm', []),
    /UpdateAlarm failed.*402/,
  );
});

test('UPnP 801 forklares med ord, ikke bare et tall', async () => {
  const body = FAULT_BODY.replace('402', '801');
  const { client } = stub({ statusCode: 500, body });

  await assert.rejects(
    () => client.request('alarmClock', 'CreateAlarm', []),
    /already exists at that time/,
  );
});

test('et vanlig svar slipper gjennom urørt', async () => {
  const { client } = stub({ statusCode: 200, body: OK_BODY });
  assert.strictEqual(await client.request('alarmClock', 'CreateAlarm', []), OK_BODY);
});

test('en tom liste er et gyldig svar, ikke en feil', async () => {
  // Null alarmer i husholdningen skal gi en tom liste og ingen feil.
  const { client } = stub({
    statusCode: 200,
    body: '<s:Envelope><s:Body><u:ListAlarmsResponse><CurrentAlarmList></CurrentAlarmList>'
      + '</u:ListAlarmsResponse></s:Body></s:Envelope>',
  });

  assert.deepStrictEqual(await client.listAlarms(), []);
});

// ---- skrivesikkerhet ----
//
// CreateAlarm og DestroyAlarm er ikke idempotente. Et nytt forsøk etter et svar
// som ble borte på veien ville laget alarmen to ganger, eller slettet noe som
// alt var slettet. Derfor skal en feilet skriving gi opp med én gang og la
// brukeren avgjøre.

test('en feilet CreateAlarm forsøkes ikke på nytt', async () => {
  const { client, calls } = stub(new Error('socket hang up'));

  await assert.rejects(() => client.createAlarm(VALID_ALARM), /socket hang up/);
  assert.strictEqual(calls.length, 1, 'skrivingen skal sendes nøyaktig én gang');
});

test('en feilet DestroyAlarm forsøkes ikke på nytt', async () => {
  const { client, calls } = stub(new Error('ETIMEDOUT'));

  await assert.rejects(() => client.destroyAlarm('575'), /ETIMEDOUT/);
  assert.strictEqual(calls.length, 1);
});

test('en feilet UpdateAlarm forsøkes ikke på nytt', async () => {
  const { client, calls } = stub(new Error('ECONNRESET'));

  await assert.rejects(() => client.updateAlarm({ ...VALID_ALARM, id: '575' }), /ECONNRESET/);
  assert.strictEqual(calls.length, 1);
});

test('CreateAlarm uten AssignedID melder fra i stedet for å finne på en id', async () => {
  // Uten id vet vi ikke hvilken alarm som ble laget, og enheten ville pekt på
  // ingenting. Da er en feil riktigere enn en enhet som ser riktig ut.
  const { client } = stub({ statusCode: 200, body: '<s:Envelope><s:Body/></s:Envelope>' });

  await assert.rejects(() => client.createAlarm(VALID_ALARM), /AssignedID/);
});

test('CreateAlarm sender feltene i den rekkefølgen SCPD-en krever, og uten ID', async () => {
  const { client, calls } = stub({ statusCode: 200, body: OK_BODY });
  const created = await client.createAlarm(VALID_ALARM);

  assert.strictEqual(created.id, '4711');

  const sent = [...calls[0].body.matchAll(/<(\w+)>/g)]
    .map((match) => match[1])
    .filter((name) => name !== 'CreateAlarm');

  assert.deepStrictEqual(sent, [
    'StartLocalTime', 'Duration', 'Recurrence', 'Enabled', 'RoomUUID',
    'ProgramURI', 'ProgramMetaData', 'PlayMode', 'Volume', 'IncludeLinkedZones',
  ]);
});

test('UpdateAlarm sender ID først og alle de andre feltene etter', async () => {
  // UpdateAlarm overskriver samtlige felt. Utelates ett, nullstilles det —
  // derfor må hele strukturen med, ikke bare det som ble endret.
  const { client, calls } = stub({ statusCode: 200, body: '<ok/>' });
  await client.updateAlarm({ ...VALID_ALARM, id: '575' });

  const sent = [...calls[0].body.matchAll(/<(\w+)>/g)]
    .map((match) => match[1])
    .filter((name) => name !== 'UpdateAlarm');

  assert.strictEqual(sent[0], 'ID');
  assert.strictEqual(sent.length, 11);
  assert.ok(calls[0].body.includes('<ID>575</ID>'));
});

// ---- forbindelser som ryker ----
//
// Høyttaleren kan lukke socketen midt i svaret — den starter på nytt etter en
// firmware-oppdatering, for eksempel. Da kommer verken 'end' eller en feil på
// selve forespørselen, og løftet ble hengende for alltid: en skriveløkke stanset
// på det ene elementet uten å feile, uten å logge og uten å komme videre.

test('en forbindelse som brytes midt i svaret gir en feil, ikke et løfte som henger', async () => {
  await withFakeHttp(
    (callback) => respond(callback, (response) => {
      response.emit('data', Buffer.from('<s:Envelope><partial'));
      response.emit('aborted');
    }),
    async () => {
      const client = new SonosClient({ host: '192.168.1.10' });
      await assert.rejects(() => client.listAlarms(), /closed the connection mid-response/);
    },
  );
});

test('en feil på selve svaret avviser løftet', async () => {
  await withFakeHttp(
    (callback) => respond(callback, (response) => response.emit('error', new Error('ECONNRESET'))),
    async () => {
      const client = new SonosClient({ host: '192.168.1.10' });
      await assert.rejects(() => client.listAlarms(), /ECONNRESET/);
    },
  );
});

test('et fullstendig svar påvirkes ikke av de nye lytterne', async () => {
  const body = '<s:Envelope><s:Body><u:ListAlarmsResponse><CurrentAlarmList>'
    + '&lt;Alarm ID="7" StartTime="07:00:00" Duration="02:00:00" Recurrence="DAILY"'
    + ' Enabled="1" RoomUUID="RINCON_1" ProgramURI="x-rincon-buzzer:0"'
    + ' ProgramMetaData="" PlayMode="NORMAL" Volume="30" IncludeLinkedZones="0"/&gt;'
    + '</CurrentAlarmList></u:ListAlarmsResponse></s:Body></s:Envelope>';

  await withFakeHttp(
    (callback) => respond(callback, (response) => {
      response.emit('data', Buffer.from(body));
      response.emit('end');
    }),
    async () => {
      const client = new SonosClient({ host: '192.168.1.10' });
      const alarms = await client.listAlarms();
      assert.strictEqual(alarms.length, 1);
      assert.strictEqual(alarms[0].id, '7');
    },
  );
});

test('løftet gjøres opp én gang selv om både end og aborted kommer', async () => {
  // Uten settled-flagget kunne en avvisning komme etter en oppfyllelse — eller
  // motsatt, og da ville en ekte feil blitt borte.
  await withFakeHttp(
    (callback) => respond(callback, (response) => {
      response.emit('data', Buffer.from('<ok/>'));
      response.emit('end');
      response.emit('aborted');
      response.emit('error', new Error('for sent'));
    }),
    async () => {
      const client = new SonosClient({ host: '192.168.1.10' });
      assert.strictEqual(await client.request('alarmClock', 'ListAlarms', []), '<ok/>');
    },
  );
});
