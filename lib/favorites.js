'use strict';

const { extractElement, decodeEntities } = require('./soap');
const { BUZZER_URI } = require('./alarm-clock');

// Sonos-favorittene ligger lokalt i ContentDirectory under FV:2. Hver favoritt
// bærer med seg begge feltene en alarm trenger:
//
//   <res>       → ProgramURI
//   <r:resMD>   → ProgramMetaData
//
// Det er nøkkelen til musikk- og radioalarmer. Metadata-blokka inneholder en
// tjenestebundet tokenreferanse (SA_RINCON…-Token) som ikke lar seg konstruere,
// men som kan kopieres ordrett. Vi ser aldri selve legitimasjonen — den bor i
// høyttaleren.

const FAVORITES_OBJECT_ID = 'FV:2';
// Sonos-spillelister ligger IKKE blant favorittene. De har sin egen container
// — «saved queues» — og mangler man den, forsvinner spillelister brukeren har
// laget i Sonos-appen helt ut av kildelista.
const PLAYLISTS_OBJECT_ID = 'SQ:';

function parseFavorites(xml) {
  const result = extractElement(xml, 'Result');
  const didl = result ? decodeEntities(result) : (xml || '');

  const favorites = [];
  const items = didl.split('<item ').slice(1);

  for (const raw of items) {
    const item = raw.split('</item>')[0];
    const title = tag(item, 'dc:title');
    const uri = tag(item, 'res');
    // resMD er dobbeltescapet: den er escapet XML inni et allerede escapet
    // Result-felt, så den må dekodes ett hakk til for å bli gyldig DIDL.
    const metadata = decodeEntities(tag(item, 'r:resMD'));

    // Favoritter uten res er beholdere i Sonos' egen radiomeny («Populært nå»,
    // «Sonos presenterer»). De kan ikke spilles direkte og duger ikke som alarm.
    if (!title || !uri) continue;

    const decodedUri = decodeEntities(uri);
    favorites.push({
      title,
      uri: decodedUri,
      metadata,
      radio: isRadio(uri),
      service: serviceOf(decodedUri),
    });
  }

  return favorites;
}

function tag(text, name) {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`).exec(text);
  return match ? match[1] : '';
}

// Hva favoritten spiller av, i klartekst. «Starred» alene sier ingenting om at
// det er en Spotify-spilleliste, og i et nedtrekk er tjenesten ofte det eneste
// som skiller kildene fra hverandre.
//
// Sonos' eget r:description-felt er IKKE til å stole på: radiostasjonene oppgir
// «myTuner Radio», men en spilleliste ga «Etter Eletro Is My Life Vip» — altså
// en gjentakelse av tittelen som ren støy. Derfor utledes kategorien fra URI-en,
// som er entydig.
function serviceOf(uri) {
  const text = String(uri || '');

  if (/x-rincon-buzzer/.test(text)) return '';
  if (/spotify/i.test(text)) return 'Spotify';
  if (/apple|itunes/i.test(text)) return 'Apple Music';
  if (/tidal/i.test(text)) return 'Tidal';
  if (/deezer/i.test(text)) return 'Deezer';
  if (isRadio(text)) return 'radio';
  if (/x-sonos-http:|x-file-cifs:|x-rincon-cpcontainer:/.test(text)) return 'musikk';
  return '';
}

// Navnet slik det vises i nedtrekk og lister.
function describeSource(source) {
  return source.service ? `${source.title} (${source.service})` : source.title;
}

function isRadio(uri) {
  return /^x-sonosapi-stream:|^x-rincon-mp3radio:|^x-sonosapi-radio:/.test(String(uri));
}

// Spillelister kommer som <container>, ikke <item>, og har ingen r:resMD.
// Metadataen må derfor bygges — men det går, fordi innholdet er lokalt:
// cdudn er den faste RINCON_AssociatedZPUDN, ikke en kontobundet token.
function parsePlaylists(xml) {
  const result = extractElement(xml, 'Result');
  const didl = result ? decodeEntities(result) : (xml || '');

  const playlists = [];
  const containers = didl.split('<container ').slice(1);

  for (const raw of containers) {
    const body = raw.split('</container>')[0];
    const id = /id="([^"]+)"/.exec(raw);
    const title = tag(body, 'dc:title');
    const uri = decodeEntities(tag(body, 'res'));

    if (!title || !uri || !id) continue;

    playlists.push({
      title,
      uri,
      metadata: playlistMetadata(id[1], title),
      radio: false,
      service: 'Sonos-spilleliste',
    });
  }

  return playlists;
}

function playlistMetadata(id, title) {
  const safe = String(title)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"'
    + ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"'
    + ' xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/"'
    + ' xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">'
    + `<item id="${id}" parentID="SQ:" restricted="true">`
    + `<dc:title>${safe}</dc:title>`
    + '<upnp:class>object.container.playlistContainer</upnp:class>'
    + '<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">'
    + 'RINCON_AssociatedZPUDN</desc>'
    + '</item></DIDL-Lite>';
}

// Kildene appen tilbyr: den innebygde tonen, favorittene, og Sonos-spillelistene.
function listSources({ favoritesXml, playlistsXml } = {}, language = 'en') {
  const buzzer = {
    id: 'buzzer',
    title: language === 'no' ? 'Sonos-tone' : 'Sonos chime',
    uri: BUZZER_URI,
    metadata: '',
    radio: false,
    service: '',
  };

  const toSource = (entry) => ({
    id: entry.uri,
    title: entry.title,
    uri: entry.uri,
    metadata: entry.metadata,
    radio: entry.radio,
    service: entry.service,
  });

  const favorites = parseFavorites(favoritesXml).map(toSource);
  const playlists = parsePlaylists(playlistsXml).map(toSource);

  // Spillelister sist: favoritter er det folk stjernemerker for rask tilgang,
  // og bør ligge øverst.
  return [buzzer].concat(favorites, playlists);
}

function findSource(sources, id) {
  return sources.find((source) => source.id === id) || null;
}

// Oppslag på navn, for steder der brukeren skriver kilden i stedet for å velge
// den — enhetsinnstillinger kan bare ha statiske nedtrekk, så favorittlista
// kan ikke fylle dem.
function findSourceByTitle(sources, title) {
  const wanted = String(title || '').trim().toLowerCase();
  if (!wanted) return sources[0] || null;

  // Tom, «buzzer» og navnet på tonen på begge språk skal alle gi den innebygde.
  if (wanted === 'buzzer' || wanted === 'sonos-tone' || wanted === 'sonos chime') {
    return sources.find((source) => source.id === 'buzzer') || null;
  }

  const exact = sources.find((source) => source.title.toLowerCase() === wanted);
  if (exact) return exact;

  // Delvis treff, men bare når det er entydig. «P» skal ikke gi P4 tilfeldig.
  const partial = sources.filter((source) => source.title.toLowerCase().includes(wanted));
  return partial.length === 1 ? partial[0] : null;
}

module.exports = {
  FAVORITES_OBJECT_ID,
  PLAYLISTS_OBJECT_ID,
  parseFavorites,
  parsePlaylists,
  listSources,
  findSource,
  findSourceByTitle,
  describeSource,
  serviceOf,
  isRadio,
};

