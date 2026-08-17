'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  parseFavorites, parsePlaylists, listSources, findSource, findSourceByTitle, isRadio,
  serviceOf, describeSource,
} = require('../lib/favorites');
const { BUZZER_URI } = require('../lib/alarm-clock');
const { BROWSE_FAVORITES_RESPONSE, BROWSE_PLAYLISTS_RESPONSE } = require('./fixtures');

// Kildelista bygges av to kall. Hjelperen holder testene lesbare.
const allSources = (language = 'no') => listSources({
  favoritesXml: BROWSE_FAVORITES_RESPONSE,
  playlistsXml: BROWSE_PLAYLISTS_RESPONSE,
}, language);

test('leser favorittene som kan spilles', () => {
  const favorites = parseFavorites(BROWSE_FAVORITES_RESPONSE);
  assert.deepStrictEqual(favorites.map((f) => f.title), ['NRK mP3', 'Starred']);
});

test('hopper over favoritter uten spillbar kilde', () => {
  // «Populært nå» er en beholder i Sonos' radiomeny uten <res>. Tilbys den som
  // alarmkilde, lager man en alarm som aldri gir lyd.
  const titles = parseFavorites(BROWSE_FAVORITES_RESPONSE).map((f) => f.title);
  assert.ok(!titles.includes('Populært nå'));
});

test('dekoder URI-en ett lag, så ampersandene blir ekte', () => {
  const radio = parseFavorites(BROWSE_FAVORITES_RESPONSE)[0];
  assert.ok(radio.uri.includes('&flags=8232'));
  assert.ok(!radio.uri.includes('&amp;'));
});

test('dekoder resMD to lag, så metadata blir gyldig DIDL', () => {
  // Dette er lagdelingen som er lett å bomme på: resMD er escapet inni en
  // allerede escapet Result. Dekodes bare ett lag, får alarmen en streng full
  // av &lt; og Sonos avviser den.
  const radio = parseFavorites(BROWSE_FAVORITES_RESPONSE)[0];
  assert.ok(radio.metadata.startsWith('<DIDL-Lite'));
  assert.ok(radio.metadata.includes('<dc:title>NRK mP3</dc:title>'));
  assert.ok(radio.metadata.includes('SA_RINCON68615_X_#Svc68615-65d10f6a-Token'));
  assert.ok(!radio.metadata.includes('&lt;'));
});

test('kjenner igjen radio kontra spilleliste', () => {
  const [radio, playlist] = parseFavorites(BROWSE_FAVORITES_RESPONSE);
  assert.strictEqual(radio.radio, true);
  assert.strictEqual(playlist.radio, false);
});

test('isRadio dekker formene Sonos bruker', () => {
  assert.ok(isRadio('x-sonosapi-stream:r%3a401782?sid=268'));
  assert.ok(isRadio('x-rincon-mp3radio://stream.example/live'));
  assert.ok(!isRadio(BUZZER_URI));
  assert.ok(!isRadio('x-rincon-cpcontainer:1006286cspotify'));
});

test('kildelista har den innebygde tonen først', () => {
  const sources = allSources();
  assert.strictEqual(sources[0].id, 'buzzer');
  assert.strictEqual(sources[0].uri, BUZZER_URI);
  assert.strictEqual(sources[0].metadata, '');
  assert.strictEqual(sources[0].title, 'Sonos chime');
});

test('kilder kan slås opp på id', () => {
  const sources = allSources();
  const radio = findSource(sources, sources[1].id);
  assert.strictEqual(radio.title, 'NRK mP3');
  assert.strictEqual(findSource(sources, 'finnes-ikke'), null);
});

test('merker Spotify-spillelister som Spotify', () => {
  // «Starred» alene sier ingenting om hvor musikken kommer fra.
  const sources = allSources();
  const starred = sources.find((source) => source.title === 'Starred');
  assert.strictEqual(starred.service, 'Spotify');
  assert.strictEqual(describeSource(starred), 'Starred (Spotify)');
});

test('merker radiostasjoner som radio', () => {
  const sources = allSources();
  const radio = sources.find((source) => source.title === 'NRK mP3');
  assert.strictEqual(describeSource(radio), 'NRK mP3 (radio)');
});

test('generiske merkelapper oversettes, egennavn står', () => {
  // Appen er engelsk med norsk som tilvalg. «Spotify» er et egennavn og skal
  // se likt ut på begge språk; «playlist» er en kategori og oversettes.
  const sources = allSources();
  const playlist = sources.find((source) => source.title === 'FTS');
  const starred = sources.find((source) => source.title === 'Starred');
  assert.strictEqual(describeSource(playlist, 'en'), 'FTS (Sonos playlist)');
  assert.strictEqual(describeSource(playlist, 'no'), 'FTS (Sonos-spilleliste)');
  assert.strictEqual(describeSource(starred, 'en'), 'Starred (Spotify)');
  assert.strictEqual(describeSource(starred, 'no'), 'Starred (Spotify)');
});

test('den innebygde tonen får ingen tjenestemerking', () => {
  const sources = allSources();
  assert.strictEqual(sources[0].service, '');
  // Ingen parentes med tjeneste — den innebygde tonen kommer ikke fra noen.
  assert.ok(!describeSource(sources[0]).includes('('));
});

test('tonen vises på brukerens språk, men slås opp på det faste navnet', () => {
  // displayTitle er visningsnavnet; title er nøkkelen findSourceByTitle bruker
  // og må være lik på alle språk, ellers ville en lagret innstilling sluttet å
  // virke idet brukeren byttet språk.
  const { listSources } = require('../lib/favorites');
  const norwegian = listSources({ favoritesXml: '', playlistsXml: '' }, 'no')[0];
  const english = listSources({ favoritesXml: '', playlistsXml: '' }, 'en')[0];

  assert.strictEqual(norwegian.title, 'Sonos chime');
  assert.strictEqual(english.title, 'Sonos chime');
  assert.strictEqual(describeSource(norwegian, 'no'), 'Sonos-tone');
  assert.strictEqual(describeSource(english, 'en'), 'Sonos chime');
});

// Escapingen ligger i to lag: DIDL-en er escapet inni <Result>, og tegnene i
// selve DIDL-en er escapet der igjen. En favoritt som HETER «P4 Rock & Pop»
// står derfor som «P4 Rock &amp;amp; Pop» i svaret fra høyttaleren.
function browseResponse(inner) {
  const escaped = inner
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<s:Envelope><s:Body><u:BrowseResponse><Result>${escaped}</Result>`
    + '</u:BrowseResponse></s:Body></s:Envelope>';
}

test('ampersand i et favorittnavn kommer hele veien ut', () => {
  // Navnet er nøkkelen kilden slås opp på. Uten dekodingen het favoritten
  // «P4 Rock &amp; Pop» i hver liste, og å skrive det ekte navnet ga ingen treff.
  const xml = browseResponse(
    '<DIDL-Lite><item id="FV:2/1"><dc:title>P4 Rock &amp; Pop</dc:title>'
    + '<res>x-sonosapi-stream:s1234?sid=254</res>'
    + '<r:resMD>&lt;DIDL-Lite&gt;&lt;item&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;</r:resMD>'
    + '</item></DIDL-Lite>',
  );

  const [favorite] = parseFavorites(xml);
  assert.strictEqual(favorite.title, 'P4 Rock & Pop');

  const sources = listSources({ favoritesXml: xml, playlistsXml: '' }, 'en');
  assert.strictEqual(findSourceByTitle(sources, 'P4 Rock & Pop').uri, 'x-sonosapi-stream:s1234?sid=254');
  assert.strictEqual(describeSource(sources[1], 'en'), 'P4 Rock & Pop (radio)');
});

test('ampersand i et spillelistenavn dobbeltescapes ikke i metadataen', () => {
  // playlistMetadata escaper tittelen på nytt. Uten dekodingen først ble
  // «Chill & Relax» sendt til Sonos som «Chill &amp;amp; Relax».
  const xml = browseResponse(
    '<DIDL-Lite><container id="SQ:12"><dc:title>Chill &amp; Relax</dc:title>'
    + '<res>file:///jffs/settings/savedqueues.rsq#12</res></container></DIDL-Lite>',
  );

  const [playlist] = parsePlaylists(xml);
  assert.strictEqual(playlist.title, 'Chill & Relax');
  assert.ok(playlist.metadata.includes('<dc:title>Chill &amp; Relax</dc:title>'));
  assert.ok(!playlist.metadata.includes('&amp;amp;'));
});

test('en kilde kan slås opp både på id og på URI', () => {
  // Innstillingssiden kjenner alarmens lyd som dens ProgramURI. For den
  // innebygde tonen er den «x-rincon-buzzer:0», mens kildens id er «buzzer» —
  // uten oppslag på URI feilet enhver lagring av en chime-alarm.
  const sources = listSources({ favoritesXml: '', playlistsXml: '' }, 'en');

  assert.strictEqual(findSource(sources, 'buzzer').id, 'buzzer');
  assert.strictEqual(findSource(sources, 'x-rincon-buzzer:0').id, 'buzzer');
  assert.strictEqual(findSource(sources, 'finnes-ikke'), null);
  assert.strictEqual(findSource(sources, ''), null);
});

test('kategorien utledes av URI, ikke av Sonos-beskrivelsen', () => {
  // r:description er upålitelig: radiostasjoner ga «myTuner Radio», mens en
  // spilleliste ga «Etter Eletro Is My Life Vip» — tittelen om igjen som støy.
  assert.strictEqual(serviceOf('x-rincon-cpcontainer:1006spotify%3Aplaylist%3Ax'), 'Spotify');
  assert.strictEqual(serviceOf('x-sonosapi-stream:r%3a401782?sid=268'), 'radio');
  assert.strictEqual(serviceOf('x-sonos-http:track%3a634252554.mp3?sid=160'), 'music');
  assert.strictEqual(serviceOf('x-rincon-buzzer:0'), '');
});

test('finner kilde på navn, uavhengig av store bokstaver', () => {
  const sources = allSources();
  assert.strictEqual(findSourceByTitle(sources, 'nrk mp3').title, 'NRK mP3');
  assert.strictEqual(findSourceByTitle(sources, '  NRK mP3 ').title, 'NRK mP3');
});

test('tom tekst og «Sonos-tone» gir den innebygde tonen', () => {
  const sources = allSources();
  assert.strictEqual(findSourceByTitle(sources, '').id, 'buzzer');
  assert.strictEqual(findSourceByTitle(sources, 'Sonos-tone').id, 'buzzer');
  assert.strictEqual(findSourceByTitle(sources, 'buzzer').id, 'buzzer');
});

test('delvis treff godtas bare når det er entydig', () => {
  const sources = allSources();
  assert.strictEqual(findSourceByTitle(sources, 'NRK').title, 'NRK mP3');
  // «r» finnes i både NRK mP3 og Starred — da skal den nekte å gjette.
  assert.strictEqual(findSourceByTitle(sources, 'r'), null);
});

test('ukjent navn gir null i stedet for en tilfeldig kilde', () => {
  const sources = allSources();
  assert.strictEqual(findSourceByTitle(sources, 'NRK P13'), null);
});

test('tomt svar gir bare den innebygde tonen', () => {
  const sources = listSources({ favoritesXml: '<Result></Result>', playlistsXml: '' }, 'no');
  assert.strictEqual(sources.length, 1);
  assert.strictEqual(sources[0].id, 'buzzer');
});

test('Sonos-spillelister kommer med, ikke bare favoritter', () => {
  // FTS lå i SQ: og ikke blant favorittene, så den manglet helt i kildelista.
  const playlist = allSources().find((source) => source.title === 'FTS');
  assert.ok(playlist, 'FTS skal være en kilde');
  assert.strictEqual(playlist.uri, 'file:///jffs/settings/savedqueues.rsq#0');
  assert.strictEqual(playlist.service, 'playlist');
});

test('spillelistas metadata bygges som gyldig DIDL', () => {
  // Spillelister har ingen r:resMD, men innholdet er lokalt: cdudn er den faste
  // RINCON_AssociatedZPUDN, ikke en kontobundet token. Derfor kan den bygges.
  const playlist = allSources().find((source) => source.title === 'FTS');
  assert.ok(playlist.metadata.startsWith('<DIDL-Lite'));
  assert.ok(playlist.metadata.includes('<dc:title>FTS</dc:title>'));
  assert.ok(playlist.metadata.includes('object.container.playlistContainer'));
  assert.ok(playlist.metadata.includes('RINCON_AssociatedZPUDN'));
});

test('spillelister ligger etter favorittene', () => {
  const titles = allSources().map((source) => source.title);
  assert.ok(titles.indexOf('FTS') > titles.indexOf('Starred'));
});
