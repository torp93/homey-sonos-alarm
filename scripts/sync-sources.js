'use strict';

// Genererer nedtrekket for lydkilder i app.json fra favorittene på anlegget.
//
// Hvorfor et byggeskript: Homey krever at nedtrekk i ENHETSINNSTILLINGER er
// faste i manifestet. Det finnes ikke noe API for å fylle dem ved kjøring, så
// den eneste måten å få et ekte nedtrekk der, er å bake verdiene inn når appen
// bygges. Innstillingssiden og paringsvisningen henter lista live og trenger
// ikke dette.
//
// Konsekvens: nedtrekket er et øyeblikksbilde. Stjernemerker du noe nytt i
// Sonos-appen, kjør dette igjen og deploy på nytt.
//
//   node scripts/sync-sources.js            (finner en høyttaler selv)
//   node scripts/sync-sources.js 192.168.10.87
//
// Verdiene lagres som TITTEL, ikke URI. Favoritt-URI-er inneholder et
// sesjonsnummer (sn=) som Sonos endrer over tid; tittelen er stabil, og
// oppslaget skjer uansett på navn ved kjøring.

const fs = require('fs');
const path = require('path');
const { SonosClient } = require('../lib/sonos-client');
const { discoverSpeakers } = require('../lib/discovery');
const { describeSource } = require('../lib/favorites');

const APP_JSON = path.join(__dirname, '..', 'app.json');
const SETTING_ID = 'newSource';

async function resolveHost() {
  if (process.argv[2]) return process.argv[2];
  const found = await discoverSpeakers({ durationMs: 5000 });
  if (found.length === 0) throw new Error('Fant ingen Sonos-høyttalere. Oppgi adressen som argument.');
  return found.sort()[0];
}

// Finner innstillingen uansett hvor dypt den ligger i settings-treet.
function findSetting(children, id) {
  for (const child of children || []) {
    if (child.id === id) return child;
    const nested = findSetting(child.children, id);
    if (nested) return nested;
  }
  return null;
}

(async () => {
  const host = await resolveHost();
  console.log(`Henter favoritter fra ${host} …`);

  const sources = await new SonosClient({ host }).listSources('no');
  // Valg i ENHETSINNSTILLINGER bruker «label». Flow-kortenes nedtrekk bruker
  // «title» — blander man dem, faller settings-skjemaet tilbake til å kreve en
  // gruppe, og feilmeldingen peker et helt annet sted enn feilen.
  const values = sources.map((source) => {
    const label = describeSource(source);
    return { id: source.title, label: { en: label, no: label } };
  });

  const app = JSON.parse(fs.readFileSync(APP_JSON, 'utf8'));
  let updated = 0;

  for (const driver of app.drivers || []) {
    const setting = findSetting(driver.settings, SETTING_ID);
    if (!setting) continue;

    setting.type = 'dropdown';
    setting.values = values;
    // Standardvalget må finnes blant verdiene, ellers viser Homey et tomt felt.
    setting.value = values[0].id;
    updated += 1;
    console.log(`  ${driver.id}: ${values.length} valg`);
  }

  if (updated === 0) throw new Error(`Fant ingen innstilling med id "${SETTING_ID}" i app.json`);

  fs.writeFileSync(APP_JSON, `${JSON.stringify(app, null, 2)}\n`, 'utf8');
  console.log('');
  console.log('app.json oppdatert. Husk å deploye:  homey app run --remote');
  for (const value of values) console.log(`  • ${value.id}`);
})().catch((error) => {
  console.error('FEIL:', error.message);
  process.exit(1);
});
