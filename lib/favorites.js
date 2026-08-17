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
    // Tittelen ligger like dypt som res og resMD, altså ett escapingslag under
    // Result. Uten denne dekodingen heter en favoritt «P4 Rock &amp; Pop» i
    // hver eneste liste appen viser — og navnet er nøkkelen kilden slås opp på,
    // så alarmen kan ikke lages ved å skrive navnet slik det faktisk er.
    const title = decodeEntities(tag(item, 'dc:title'));
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
// Returnerer en NØKKEL, ikke ferdig tekst — appen er engelsk med norsk som
// tilvalg, så oversettelsen skjer ved visning.
function serviceOf(uri) {
  const text = String(uri || '');

  if (/x-rincon-buzzer/.test(text)) return '';
  if (/spotify/i.test(text)) return 'Spotify';
  if (/apple|itunes/i.test(text)) return 'Apple Music';
  if (/tidal/i.test(text)) return 'Tidal';
  if (/deezer/i.test(text)) return 'Deezer';
  if (isRadio(text)) return 'radio';
  if (/savedqueues/.test(text)) return 'playlist';
  if (/x-sonos-http:|x-file-cifs:|x-rincon-cpcontainer:/.test(text)) return 'music';
  return '';
}

// Bare de generiske nøklene oversettes. Tjenestenavn som Spotify og Tidal er
// egennavn og skal stå som de er på alle språk.
const SERVICE_LABELS = {
  en: { radio: 'radio', music: 'music', playlist: 'Sonos playlist' },
  no: { radio: 'radio', music: 'musikk', playlist: 'Sonos-spilleliste' },
};

function serviceLabel(service, language = 'en') {
  const table = SERVICE_LABELS[language] || SERVICE_LABELS.en;
  return table[service] || service || '';
}

// Navnet slik det vises i nedtrekk og lister. displayTitle brukes når den
// finnes: den innebygde tonen har et oversatt visningsnavn, mens `title` er den
// språkuavhengige nøkkelen findSourceByTitle slår opp på og derfor ikke kan
// oversettes.
function describeSource(source, language = 'en') {
  const name = source.displayTitle || source.title;
  const label = serviceLabel(source.service, language);
  return label ? `${name} (${label})` : name;
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
    // Samme lag som for favorittene. I tillegg escaper playlistMetadata tittelen
    // på nytt, så uten dekodingen her ble den sendt dobbeltescapet til Sonos.
    const title = decodeEntities(tag(body, 'dc:title'));
    const uri = decodeEntities(tag(body, 'res'));

    if (!title || !uri || !id) continue;

    playlists.push({
      title,
      uri,
      metadata: playlistMetadata(id[1], title),
      radio: false,
      service: 'playlist',
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
    // Tittelen er identiteten kilden slås opp på, så den må være stabil
    // uavhengig av språk. Engelsk er appens standard.
    title: 'Sonos chime',
    displayTitle: language === 'no' ? 'Sonos-tone' : 'Sonos chime',
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

// Slår også opp på URI. Innstillingssiden identifiserer en alarms lyd med
// alarmens egen ProgramURI, og for den innebygde tonen er den
// «x-rincon-buzzer:0» mens kildens id er «buzzer». Uten dette feilet enhver
// lagring av en chime-alarm med «fant ingen lyd med det navnet».
function findSource(sources, id) {
  const wanted = String(id ?? '');
  if (!wanted) return null;

  return (sources || []).find((source) => source.id === wanted)
    || (sources || []).find((source) => source.uri === wanted)
    || null;
}

// Oppslag på navn, for steder der brukeren skriver kilden i stedet for å velge
// den — enhetsinnstillinger kan bare ha statiske nedtrekk, så favorittlista
// kan ikke fylle dem.
function findSourceByTitle(sources, title) {
  const wanted = String(title || '').trim().toLowerCase();
  if (!wanted) return sources[0] || null;

  // Tom, «buzzer» og navnet på tonen på begge språk skal alle gi den innebygde.
  if (wanted === 'buzzer' || wanted === 'sonos-tone' || wanted === 'sonos chime'
      || wanted === 'sonos-tone (buzzer)') {
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
  serviceLabel,
  serviceOf,
  isRadio,
};

