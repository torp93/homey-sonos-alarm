# Sonos Alarms for Homey Pro

Control the alarms on your Sonos speakers from Homey flows — set the time,
volume, and repeat days, or enable and disable an alarm entirely.

## How it works

Sonos speakers expose a local UPnP service called `AlarmClock` on port 1400.
Alarms live in the speakers themselves, so they keep working even when Homey is
down. This app talks to that service directly over the local network.

**No Sonos account, login, or cloud access is involved.** Sonos' official cloud
Control API has no alarm endpoints at all, so the local service is the only way
to reach them. A side effect worth knowing: the UPnP interface has no
authentication, so anyone on your network can change these alarms. That is
Sonos' design, not this app's — but it is an argument for keeping guest Wi-Fi on
a separate VLAN.

## What it can and cannot do

| | |
|---|---|
| Enable / disable an alarm | yes |
| Change time, volume, repeat days | yes |
| Create a buzzer alarm from scratch | yes (`x-rincon-buzzer:0` needs no metadata) |
| Create a music alarm from scratch | no — the source is bound to your streaming account |
| Reuse an existing music alarm's source | yes |

Music alarms carry a `ProgramMetaData` blob containing an account-bound token
reference. It cannot be constructed, only copied from an alarm or favourite that
already exists. So: create the alarm once in the Sonos app, then let Homey drive
its schedule.

## Setup

1. Install the app and add a device — it finds your speakers over SSDP.
2. Every alarm that already exists in the Sonos app shows up as a device.
3. If discovery finds nothing (some VLAN setups drop multicast), enter a
   speaker's IP address manually in the app settings.

## Development

```
npm test
homey app validate --level publish
homey app run --remote
```

`--remote` runs the app on the Homey itself, which is what puts it on the same
network as the speakers. Running it locally in Docker breaks SSDP discovery.

## License

MIT
