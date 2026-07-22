# librespot

QueueMe does not launch, configure, authenticate, or monitor the librespot process. librespot should be running before device selection and must use the same Spotify Premium owner account linked during QueueMe setup.

Confirm the local installation with:

```bash
librespot --version
```

Start librespot using the authentication and audio-backend options appropriate for the host. Give it a stable, recognizable device name. Once Spotify lists the device, open QueueMe Admin, refresh devices, and select it.

QueueMe stores both the device ID and its name/type. Spotify does not guarantee that IDs remain stable. If the ID changes, QueueMe automatically rebinds only when exactly one visible device has the saved name and type; ambiguous matches require manual selection.

If the device disappears during playback, the application queue remains intact and playback enters a blocked state. Restart librespot, refresh devices, select it if necessary, and press Resume.

