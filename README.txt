Control the alarms on your Sonos speakers from Homey flows.

Set the time, the volume and the repeat days, or enable and disable an alarm
entirely — all from a flow. Every alarm that already exists in the Sonos app
shows up in Homey as its own device.

The app talks to your speakers directly over the local network, using the
AlarmClock service built into every Sonos speaker. No Sonos account, no login
and no cloud connection is involved, so there are no tokens to expire and
nothing to re-authorise. The alarms stay in the speakers, which means they keep
going off even if Homey is switched off.

Alarms that play the built-in alarm sound can be created and changed freely.
Alarms that play music from a streaming service can also be scheduled from
Homey, but the music itself has to be chosen once in the Sonos app first,
because the streaming source is tied to your account.

Speakers are found automatically on the network. If your network blocks that,
you can enter the address of one speaker manually in the app settings.
