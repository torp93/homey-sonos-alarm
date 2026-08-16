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

function decodeEntities(value) {
  if (typeof value !== 'string') return '';
  // Ampersanden må dekodes sist, ellers blir «&amp;lt;» til «<» i stedet for «&lt;».
  return value
    .replace(/&(lt|gt|quot|apos);/g, (match) => ENTITIES[match])
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
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
const UPNP_ERRORS = {
  401: 'Ukjent handling',
  402: 'Ugyldige argumenter',
  501: 'Handlingen feilet',
  600: 'Argument utenfor gyldig område',
  701: 'Ugyldig alarm-ID',
};

function parseFault(xml) {
  const code = /<errorCode>(\d+)<\/errorCode>/.exec(xml || '');
  if (!code) return null;
  const number = Number(code[1]);
  return {
    code: number,
    message: UPNP_ERRORS[number] || `UPnP-feil ${number}`,
  };
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
  extractElement,
  parseAttributes,
  UPNP_ERRORS,
};
