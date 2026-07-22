# Spotify setup guide

QueueMe uses one Spotify owner account for catalog search, device discovery, and playback control. For the most predictable setup, use the same Spotify account to create the developer app, authorize QueueMe, and operate the librespot device.

## Before you start

- The owner needs an active Spotify Premium subscription. Spotify requires Premium for development-mode app owners and for Web API playback control.
- QueueMe must be running so its setup page can display the exact redirect URI.
- librespot can be started before or after OAuth, but it must ultimately be logged into or selected by the same Spotify owner account.

Spotify currently limits new development-mode apps to one Client ID per developer and five authorized users. QueueMe's single-owner design fits within those limits.

## 1. Open QueueMe setup

Start QueueMe and open its loopback URL on the machine running it:

```text
http://127.0.0.1:3000/setup
```

Enter the six-digit claim code printed by the QueueMe server. Keep the setup page open; it displays the callback address you must register with Spotify.

If QueueMe is on a Raspberry Pi or another headless computer, create the SSH tunnel described in [raspberry-pi.md](raspberry-pi.md) first, then open the same loopback URL on your desktop.

## 2. Create the Spotify developer app

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and sign in as the Spotify Premium owner.
2. Choose **Create app**.
3. Use an app name such as `QueueMe` and a description such as `Local party jukebox`.
4. Copy the **Redirect URI** shown by QueueMe and paste it into Spotify's Redirect URIs field.
5. Select **Web API** when Spotify asks which API you plan to use.
6. Accept Spotify's Developer Terms and save the app.

With QueueMe's default port, the redirect URI is:

```text
http://127.0.0.1:3000/api/v1/oauth/spotify/callback
```

The value must match QueueMe exactly, including the protocol, IP address, port, path, capitalization, and any trailing slash. Spotify permits plain HTTP for an explicit loopback address such as `127.0.0.1`, but not for `localhost` or a private LAN address such as `192.168.x.x`.

QueueMe supplies OAuth scopes when it starts authorization, so there is no scope list to enter in Spotify's dashboard.

## 3. Copy the app credentials

On the Spotify app overview page:

1. Copy the **Client ID** into QueueMe's Spotify client ID field.
2. Choose **View client secret** and copy the value into QueueMe's Spotify client secret field.
3. Choose a QueueMe jukebox name and a 6–12 digit admin PIN.
4. Select **Save Spotify app**.

QueueMe encrypts the Client Secret and OAuth tokens before saving them to the local SQLite database. The encryption key is `data/master.key`; back it up with the database and never commit or share it.

## 4. Authorize the owner

Choose **Connect Spotify owner** in QueueMe and sign in with the same Premium account. Spotify will ask for these permissions:

- `user-read-playback-state` for device discovery and current playback state
- `user-modify-playback-state` for play, pause, resume, skip, and device transfer

After approval, Spotify returns the browser to QueueMe. QueueMe exchanges the temporary authorization code on the server and stores the resulting tokens encrypted in SQLite.

If a different Spotify account must authorize the app, first open the app in Spotify's dashboard and add that account under **Settings → Users Management**. Development-mode API calls from a user who is not the app owner or allowlisted can fail with HTTP 403.

## 5. Select librespot

Start librespot with a recognizable device name. On its first launch, open Spotify desktop or mobile as the owner, open the Spotify Connect device picker, and select the librespot device once. This associates the process with the owner account so Spotify's Web API can return it to QueueMe. Then return to QueueMe, choose **Refresh devices**, select it, and finish setup.

If the device is missing:

- Confirm librespot is running and has not logged an authentication error.
- Confirm Spotify sees it as a Connect device for the same owner account.
- Open Spotify on another device and check whether the librespot name appears in the device picker.
- Start playback once from Spotify if the Connect device has not become active yet, then refresh QueueMe.

## Troubleshooting

### `INVALID_CLIENT` or an invalid client secret

Reopen the Spotify app overview and copy the Client ID and Client Secret again. Make sure the values come from the same app and contain no extra spaces.

### `INVALID_OAUTH_STATE` or an expired authorization request

Return to QueueMe and choose **Connect Spotify owner** again. Authorization attempts expire after ten minutes and cannot be reused.

### Redirect URI mismatch

Compare Spotify's saved redirect URI with the exact value shown by QueueMe. Do not use `localhost`, a LAN IP, HTTPS on one side but HTTP on the other, a different port, or an extra trailing slash.

### Spotify returns HTTP 403

Confirm that the developer-app owner still has Premium. If OAuth used another account, add it in **Settings → Users Management** in Spotify's dashboard.

### OAuth works locally but not from another computer

This is expected for a loopback callback: `127.0.0.1` refers to the computer running the browser. Run the browser on the QueueMe host or use the documented SSH tunnel. Once OAuth is complete, guests can use QueueMe through its normal LAN address.

## Official Spotify references

- [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
- [Web API getting started](https://developer.spotify.com/documentation/web-api)
- [Spotify app concepts and credentials](https://developer.spotify.com/documentation/web-api/concepts/apps)
- [Redirect URI requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)
- [Development-mode quota and user allowlists](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
