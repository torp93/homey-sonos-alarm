'use strict';

// Fanget fra Thomas' eget anlegg 2026-08-16. Ekte svar er verdt mer enn
// håndlagde: de fanget opp både at StartTime kommer ut mens StartLocalTime går
// inn, og at ZoneGroupMember slutter å være selvlukkende når høyttaleren har
// satellitter — en form den første, hjemmesnekrede fixturen ikke hadde.

// Lokal, med vilje uavhengig av lib/soap.js: fixturen skal ikke arve en feil
// fra modulen den brukes til å teste.
function escape(xml) {
  return xml
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function envelope(action, service, payload) {
  return '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"'
    + ' s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>'
    + `<u:${action}Response xmlns:u="urn:schemas-upnp-org:service:${service}">`
    + `${payload}</u:${action}Response></s:Body></s:Envelope>`;
}

const ALARMS_RAW = '<Alarms>'
  + '<Alarm ID="485" StartTime="10:00:00" Duration="02:00:00" Recurrence="WEEKDAYS"'
  + ' Enabled="0" RoomUUID="RINCON_7828CA8108D001400"'
  + ' ProgramURI="x-rincon-cpcontainer:10062a6cspotify%3aplaylist%3a0Obv7zEv9VmRfoyX1HSEuz?sid=12&amp;flags=10860&amp;sn=7"'
  + ' ProgramMetaData="" PlayMode="SHUFFLE" Volume="51" IncludeLinkedZones="0"/>'
  + '<Alarm ID="575" StartTime="08:00:00" Duration="02:00:00" Recurrence="DAILY"'
  + ' Enabled="0" RoomUUID="RINCON_7828CA8108D001400" ProgramURI="x-rincon-buzzer:0"'
  + ' ProgramMetaData="" PlayMode="SHUFFLE" Volume="50" IncludeLinkedZones="0"/>'
  // Beholder-formen, fanget fra anlegget 2026-08-16. Alarmer laget i Sonos-appen
  // på nyere firmware ser slik ut; alarmer laget over UPnP er selvlukkende.
  // Denne formen forsvant tidligere sporløst ut av parsingen.
  + '<Alarm ID="2587" StartTime="07:00:00" Duration="02:00:00" Recurrence="DAILY"'
  + ' Enabled="1" RoomUUID="RINCON_48A6B8BB557B01400" ProgramURI="x-rincon-buzzer:0"'
  + ' ProgramMetaData="" PlayMode="NORMAL" Volume="20" IncludeLinkedZones="0">'
  + '            <Content type="other" serviceId="buzzer" objectId="0"/>'
  + '</Alarm>'
  + '</Alarms>';

const LIST_ALARMS_RESPONSE = envelope('ListAlarms', 'AlarmClock:1',
  `<CurrentAlarmList>${escape(ALARMS_RAW)}</CurrentAlarmList>`
  + '<CurrentAlarmListVersion>RINCON_7828CA8108D001400:87</CurrentAlarmListVersion>');

// Tre former, alle hentet fra det virkelige anlegget:
//   Soverom — koordinator som BEHOLDER, med satellitter (surround + sub)
//   Bad     — stereopar: to ZoneGroupMember, den andre Invisible="1"
//   Stue    — enslig høyttaler, selvlukkende tagg
const TOPOLOGY_RAW = '<ZoneGroupState><ZoneGroups>'
  + '<ZoneGroup Coordinator="RINCON_48A6B8BB557B01400" ID="RINCON_48A6B8BB557B01400:1541184742">'
  + '<ZoneGroupMember UUID="RINCON_48A6B8BB557B01400"'
  + ' Location="http://192.168.10.87:1400/xml/device_description.xml" ZoneName="Soverom"'
  + ' Configuration="1" SoftwareVersion="96.1-79270">'
  + '<Satellite UUID="RINCON_7828CA8108D001400" ZoneName="Soverom" Invisible="1"'
  + ' Location="http://192.168.10.134:1400/xml/device_description.xml"/>'
  + '<Satellite UUID="RINCON_7828CA8108D401400" ZoneName="Soverom" Invisible="1"'
  + ' Location="http://192.168.10.138:1400/xml/device_description.xml"/>'
  + '<Satellite UUID="RINCON_949F3EA712CA01400" ZoneName="Soverom" Invisible="1"'
  + ' Location="http://192.168.10.124:1400/xml/device_description.xml"/>'
  + '</ZoneGroupMember></ZoneGroup>'
  + '<ZoneGroup Coordinator="RINCON_7828CAF57DC601400" ID="RINCON_7828CAF57DC601400:2">'
  + '<ZoneGroupMember UUID="RINCON_7828CAF57DC601400" ZoneName="Bad"/>'
  + '<ZoneGroupMember UUID="RINCON_7828CAF6B25001400" ZoneName="Bad" Invisible="1"/>'
  + '</ZoneGroup>'
  + '<ZoneGroup Coordinator="RINCON_74CA6065E63E01400" ID="RINCON_74CA6065E63E01400:3">'
  + '<ZoneGroupMember UUID="RINCON_74CA6065E63E01400" ZoneName="Stue"/>'
  + '</ZoneGroup>'
  + '</ZoneGroups></ZoneGroupState>';

const ZONE_GROUP_STATE = envelope('GetZoneGroupState', 'ZoneGroupTopology:1',
  `<ZoneGroupState>${escape(TOPOLOGY_RAW)}</ZoneGroupState>`);

// Favoritter fra anlegget 2026-08-16. Escapingen er i to lag, akkurat som i
// virkeligheten: DIDL-en er escapet inni <Result>, og r:resMD er escapet igjen
// inni DIDL-en. Blir bare ett lag dekodet, får alarmen ubrukelig metadata.
const FAVORITES_DIDL = '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"'
  + ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"'
  + ' xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/"'
  + ' xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">'
  // Radiostasjon — den enkle typen, tjenestebundet men ikke personlig.
  + '<item id="FV:2/13" parentID="FV:2" restricted="false">'
  + '<dc:title>NRK mP3</dc:title>'
  + '<upnp:class>object.itemobject.item.sonos-favorite</upnp:class>'
  + '<res protocolInfo="x-sonosapi-stream:*:*:*">'
  + 'x-sonosapi-stream:r%3a401782?sid=268&amp;flags=8232&amp;sn=87</res>'
  + '<r:type>instantPlay</r:type>'
  + '<r:resMD>&lt;DIDL-Lite xmlns=&quot;urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/&quot;&gt;'
  + '&lt;item id=&quot;10092028r%3a401782&quot; restricted=&quot;true&quot;&gt;'
  + '&lt;dc:title&gt;NRK mP3&lt;/dc:title&gt;'
  + '&lt;upnp:class&gt;object.item.audioItem.audioBroadcast&lt;/upnp:class&gt;'
  + '&lt;desc id=&quot;cdudn&quot;&gt;SA_RINCON68615_X_#Svc68615-65d10f6a-Token&lt;/desc&gt;'
  + '&lt;/item&gt;&lt;/DIDL-Lite&gt;</r:resMD></item>'
  // Spotify-spilleliste — kontobundet.
  + '<item id="FV:2/20" parentID="FV:2" restricted="false">'
  + '<dc:title>Starred</dc:title>'
  + '<upnp:class>object.itemobject.item.sonos-favorite</upnp:class>'
  + '<res protocolInfo="x-rincon-cpcontainer:*:*:*">'
  + 'x-rincon-cpcontainer:1006286cspotify%3Aplaylist%3A0Obv7zEv9VmRfoyX1HSEuz'
  + '?sid=12&amp;flags=10348&amp;sn=7</res>'
  + '<r:resMD>&lt;DIDL-Lite&gt;&lt;item&gt;&lt;dc:title&gt;Starred&lt;/dc:title&gt;'
  + '&lt;/item&gt;&lt;/DIDL-Lite&gt;</r:resMD></item>'
  // Beholder i Sonos' egen radiomeny: ingen <res>, kan ikke brukes som alarm.
  + '<item id="FV:2/1" parentID="FV:2" restricted="false">'
  + '<dc:title>Populært nå</dc:title>'
  + '<upnp:class>object.itemobject.item.sonos-favorite</upnp:class></item>'
  + '</DIDL-Lite>';

const BROWSE_FAVORITES_RESPONSE = envelope('Browse', 'ContentDirectory:1',
  `<Result>${escape(FAVORITES_DIDL)}</Result>`
  + '<NumberReturned>3</NumberReturned><TotalMatches>3</TotalMatches>'
  + '<UpdateID>25</UpdateID>');

// Sonos-spillelister, fra SQ: på anlegget 2026-08-16. De kommer som
// <container>, ikke <item>, og har ingen r:resMD — metadataen må bygges.
const PLAYLISTS_DIDL = '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"'
  + ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"'
  + ' xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/"'
  + ' xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">'
  + '<container id="SQ:0" parentID="SQ:" restricted="true">'
  + '<dc:title>FTS</dc:title>'
  + '<upnp:class>object.container.playlistContainer</upnp:class>'
  + '<res protocolInfo="file:*:audio/mpegurl:*">'
  + 'file:///jffs/settings/savedqueues.rsq#0</res>'
  + '</container></DIDL-Lite>';

const BROWSE_PLAYLISTS_RESPONSE = envelope('Browse', 'ContentDirectory:1',
  `<Result>${escape(PLAYLISTS_DIDL)}</Result>`
  + '<NumberReturned>1</NumberReturned><TotalMatches>1</TotalMatches>'
  + '<UpdateID>3</UpdateID>');

const FAULT_402 ='<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">'
  + '<s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring>'
  + '<detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0">'
  + '<errorCode>402</errorCode></UPnPError></detail></s:Fault></s:Body></s:Envelope>';

const SSDP_RESPONSE = [
  'HTTP/1.1 200 OK',
  'CACHE-CONTROL: max-age = 1800',
  'LOCATION: http://192.168.10.134:1400/xml/device_description.xml',
  'SERVER: Linux UPnP/1.0 Sonos/85.1-46270',
  'ST: urn:schemas-upnp-org:device:ZonePlayer:1',
  '', '',
].join('\r\n');

module.exports = {
  LIST_ALARMS_RESPONSE,
  ZONE_GROUP_STATE,
  BROWSE_FAVORITES_RESPONSE,
  BROWSE_PLAYLISTS_RESPONSE,
  FAULT_402,
  SSDP_RESPONSE,
};
