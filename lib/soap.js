'use strict';

// Sonos svarer med UPnP-SOAP. Alt her er ren strengbehandling slik at det kan
// testes uten en høyttaler i nærheten.

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

// Numeriske referanser i begge former. Sonos bruker desimal for det meste, men
// titler som kommer videre fra en strømmetjeneste dukker også opp heksadesimalt
// («&#x2019;» for apostrof).
//
// fromCodePoint, ikke fromCharCode: et tegn over 0xFFFF — en emoji i et
// spillelistenavn er det vanlige tilfellet — ville blitt kuttet til ett feil
// tegn av fromCharCode, og navnet er nøkkelen alarmkilden slås opp på.
const NUMERIC_ENTITY = /&#(?:[xX]([0-9a-fA-F]+)|(\d+));/g;

function decodeNumericEntity(match, hex, decimal) {
  const code = hex ? parseInt(hex, 16) : Number(decimal);
  // Ugyldige verdier blir stående som de er. En streng som «&#999999;» er ikke
  // vår å tolke, og fromCodePoint ville kastet på den.
  if (!Number.isInteger(code) || code < 0 || code > 0x10FFFF) return match;
  return String.fromCodePoint(code);
}

function decodeEntities(value) {
  if (typeof value !== 'string') return '';
  // Ampersanden må dekodes sist, ellers blir «&amp;lt;» til «<» i stedet for «&lt;».
  return value
    .replace(/&(lt|gt|quot|apos);/g, (match) => ENTITIES[match])
    .replace(NUMERIC_ENTITY, decodeNumericEntity)
    .replace(/&amp;/g, '&');
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Argumentene sendes i den rekkefølgen SCPD-en oppgir. Sonos er streng på dette.
function buildEnvelope(service, action, args = []) {
  const body = args
    .map(([name, value]) => `<${name}>${escapeXml(value)}</${name}>`)
    .join('');

  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"'
    + ' s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
    + `<s:Body><u:${action} xmlns:u="urn:schemas-upnp-org:service:${service}">`
    + `${body}</u:${action}></s:Body></s:Envelope>`;
}

function soapAction(service, action) {
  return `"urn:schemas-upnp-org:service:${service}#${action}"`;
}

// Sonos svarer med HTTP 500 og en UPnP-feilkode i kroppen. Koden er det eneste
// brukbare — feilteksten er som regel tom.
// Engelsk: lib/ har ingen tilgang til homey.__(), og disse strengene når
// brukeren gjennom innstillingssiden og paringsvinduet. Engelsk er obligatorisk
// i App Store, så et norsk fragment midt i en engelsk feilmelding er et brudd.
const UPNP_ERRORS = {
  401: 'Unknown action',
  402: 'Invalid arguments',
  501: 'The action failed',
  600: 'Argument out of range',
  701: 'Invalid alarm ID',
  // Bekreftet mot ekte høyttalere 2026-08-16: Sonos avviser en ny alarm når
  // rommet allerede har en på samme starttid, uansett dager og lydkilde.
  801: 'An alarm already exists at that time in this room',
};

function parseFault(xml) {
  const code = /<errorCode>(\d+)<\/errorCode>/.exec(xml || '');
  if (!code) return null;
  const number = Number(code[1]);
  return {
    code: number,
    message: UPNP_ERRORS[number] || `UPnP error ${number}`,
  };
}

// En feilkropp kjennes igjen uavhengig av statuskoden. Sonos svarer normalt
// HTTP 500 på en UPnP-feil, men det er ikke noe vi kan bygge på: et mellomledd
// på nettet — en proxy, en portal, en feilside — kan levere den samme kroppen
// med 200. Leses det som suksess, ser en skriving som aldri traff høyttaleren
// vellykket ut, og for en alarm er det den farlige retningen å ta feil på.
//
// Prefikset på Fault-elementet varierer med hvem som svarer, så det matches løst.
function hasFault(xml) {
  const text = xml || '';
  return /<(?:[\w.-]+:)?Fault[\s>]/.test(text) || /<errorCode>\d+<\/errorCode>/.test(text);
}

// Henter innholdet i et enkelt element, f.eks. <CurrentAlarmList>...</CurrentAlarmList>.
function extractElement(xml, name) {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`).exec(xml || '');
  return match ? match[1] : null;
}

// Attributter fra en selvlukkende tagg. Verdiene er alltid i doble anførselstegn
// i Sonos' svar, så et enkelt uttrykk holder.
function parseAttributes(tag) {
  const attributes = {};
  const pattern = /([A-Za-z_][\w:.-]*)="([^"]*)"/g;
  let match = pattern.exec(tag);
  while (match) {
    attributes[match[1]] = decodeEntities(match[2]);
    match = pattern.exec(tag);
  }
  return attributes;
}

module.exports = {
  decodeEntities,
  escapeXml,
  buildEnvelope,
  soapAction,
  parseFault,
  hasFault,
  extractElement,
  parseAttributes,
  UPNP_ERRORS,
};
