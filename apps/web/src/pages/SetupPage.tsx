import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PlayerDevice } from "@queueme/core";
import { api, ApiError, json } from "../api";
import { ErrorBanner, Shell } from "../components";

type SetupStatus = {
  setupRequired: boolean;
  setupClaimed: boolean;
  spotifyConfigured: boolean;
  redirectUri: string;
  spotifyConnected: boolean;
};

export function SetupPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [devices, setDevices] = useState<PlayerDevice[]>([]);
  const [selected, setSelected] = useState("");
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveFeedback = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState({ code: "", jukeboxName: "QueueMe", adminPin: "", spotifyClientId: "", spotifyClientSecret: "" });
  const refresh = async () => setStatus(await api<SetupStatus>("/api/v1/setup/status"));
  const loadDevices = async () => {
    setError(null);
    setLoadingDevices(true);
    try {
      const result = await api<{ devices: PlayerDevice[] }>("/api/v1/setup/devices");
      setDevices(result.devices);
    } catch (reason) {
      handleSetupFailure(reason, "Unable to refresh Spotify devices.");
    } finally {
      setLoadingDevices(false);
    }
  };
  useEffect(() => { void refresh().catch((reason) => setError(reason.message)); }, []);
  useEffect(() => {
    if (!status) return;
    if (!status.setupClaimed) {
      setClaimed(false);
      setConfigured(false);
      return;
    }
    setClaimed(true);
    setConfigured(status.spotifyConfigured);
    if (status.spotifyConnected) {
      void loadDevices();
    }
  }, [status?.setupClaimed, status?.spotifyConfigured, status?.spotifyConnected]);
  if (status && !status.setupRequired) return <Shell><section className="setup-card"><h1>Setup is complete</h1><button onClick={() => navigate("/")}>Open QueueMe</button></section></Shell>;
  const claim = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await api("/api/v1/setup/claim", json("POST", { code: form.code }));
      setClaimed(true);
      setConfigured(status?.spotifyConfigured ?? false);
      if (status?.spotifyConnected) void loadDevices();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invalid setup code.");
    }
  };
  const configure = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setFormError(null);
    const jukeboxName = form.jukeboxName.trim();
    const spotifyClientId = form.spotifyClientId.trim();
    const spotifyClientSecret = form.spotifyClientSecret.trim();
    const validationError = !jukeboxName
      ? "Enter a name for this jukebox."
      : !/^\d{6,12}$/.test(form.adminPin)
        ? "The admin PIN must contain 6–12 digits."
        : spotifyClientId.length < 8
          ? "Enter the Client ID from your Spotify app."
          : spotifyClientSecret.length < 8
            ? "Enter the Client Secret from your Spotify app."
            : null;
    if (validationError) {
      setFormError(validationError);
      window.requestAnimationFrame(() => saveFeedback.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }

    setSaving(true);
    try {
      await api("/api/v1/setup/config", json("PUT", { jukeboxName, adminPin: form.adminPin, spotifyClientId, spotifyClientSecret }));
      setConfigured(true);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "SETUP_CLAIM_REQUIRED") {
        setClaimed(false);
        setError("The setup session expired or the server restarted. Enter the current setup code again; your Spotify details are still filled in.");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setFormError(reason instanceof Error ? reason.message : "Unable to save the Spotify details.");
        window.requestAnimationFrame(() => saveFeedback.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
      }
    } finally {
      setSaving(false);
    }
  };
  const chooseDevice = async () => { if (!selected) return; await api("/api/v1/setup/device", json("PUT", { deviceId: selected })); };
  const complete = async () => { try { if (selected) await chooseDevice(); await api("/api/v1/setup/complete", json("POST")); navigate("/"); window.location.reload(); } catch (reason) { handleSetupFailure(reason, "Unable to complete setup."); } };
  function handleSetupFailure(reason: unknown, fallback: string) {
    if (reason instanceof ApiError && reason.code === "SETUP_CLAIM_REQUIRED") {
      setClaimed(false);
      setConfigured(false);
      setError("The server restarted. Enter the current setup code to continue; your saved Spotify connection is intact.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setError(reason instanceof Error ? reason.message : fallback);
  }
  return <Shell eyebrow="First run" title="Set up QueueMe"><section className="setup-card">
    <div className="steps"><span className={claimed ? "done" : "active"}>1</span><i /><span className={configured ? "done" : claimed ? "active" : ""}>2</span><i /><span className={status?.spotifyConnected ? "done" : configured ? "active" : ""}>3</span><i /><span className={status?.spotifyConnected ? "active" : ""}>4</span></div>
    <ErrorBanner message={error} />
    {!claimed ? <><span className="kicker">Step one</span><h1>Claim this jukebox</h1><p>Enter the six-digit setup code printed in the server terminal.</p><form className="stack-form" onSubmit={claim}><label>Setup code<input inputMode="numeric" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required /></label><button>Continue</button></form></>
      : !configured ? <><span className="kicker">Step two</span><h1>Create the Spotify app</h1><SpotifyAppGuide redirectUri={status?.redirectUri ?? ""} /><form className="stack-form spotify-form" onSubmit={configure} noValidate>
        <label>Jukebox name<input value={form.jukeboxName} onChange={(e) => setForm({ ...form, jukeboxName: e.target.value })} required /></label>
        <label>Admin PIN<input type="password" inputMode="numeric" pattern="[0-9]{6,12}" value={form.adminPin} onChange={(e) => setForm({ ...form, adminPin: e.target.value })} required /><small>Use 6–12 digits. This protects the QueueMe admin screen.</small></label>
        <label>Spotify client ID<input autoComplete="off" value={form.spotifyClientId} onChange={(e) => setForm({ ...form, spotifyClientId: e.target.value })} required /><small>Copy this from the app overview in Spotify's dashboard.</small></label>
        <label>Spotify client secret<input type="password" autoComplete="new-password" value={form.spotifyClientSecret} onChange={(e) => setForm({ ...form, spotifyClientSecret: e.target.value })} required /><small>Choose “View client secret,” then copy it here. QueueMe encrypts it before storing it.</small></label><div ref={saveFeedback}><ErrorBanner message={formError} /></div><button disabled={saving}>{saving ? "Saving Spotify details…" : "Save Spotify details"}</button></form></>
      : !status?.spotifyConnected ? <><span className="kicker">Step three</span><h1>Connect the owner account</h1><p>Sign in with the same Spotify Premium account that owns the developer app and will use librespot. Spotify will show the two playback permissions QueueMe requests; after approval, you will return here.</p><div className="setup-note"><strong>QueueMe requests only:</strong><code>user-read-playback-state</code><code>user-modify-playback-state</code></div><a className="button-link" href="/api/v1/setup/spotify/start">Connect Spotify owner</a></>
      : <><span className="kicker">Final step</span><h1>Select librespot</h1><p>QueueMe lists Spotify Connect devices associated with the authorized owner account. You may also finish setup and select one later in Admin.</p>
        {devices.length === 0 && !loadingDevices && <div className="setup-note device-help"><strong>No Spotify devices found yet</strong><span>On first launch, running librespot is not enough. Open Spotify desktop or mobile as the owner, open the Connect device picker, and select <strong>librespot</strong> once. Then return here and refresh.</span></div>}
        <div className="device-row"><select value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">Select a device later</option>{devices.map((device) => <option value={device.id} key={device.id}>{device.name} · {device.type}{device.active ? " · active" : ""}</option>)}</select><button className="secondary" disabled={loadingDevices} onClick={() => void loadDevices()}>{loadingDevices ? "Checking…" : "Refresh devices"}</button></div><button onClick={() => void complete()}>Finish setup</button></>}
  </section></Shell>;
}

function SpotifyAppGuide({ redirectUri }: { redirectUri: string }) {
  const redirectField = useRef<HTMLInputElement>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copyRedirectUri = async () => {
    let copied = false;
    if (redirectField.current) {
      redirectField.current.focus();
      redirectField.current.select();
      redirectField.current.setSelectionRange(0, redirectUri.length);
      try {
        copied = document.execCommand("copy");
      } catch { /* Try the modern Clipboard API below. */ }
    }

    if (!copied) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(redirectUri);
          copied = true;
        }
      } catch { /* Leave the URI selected so it can be copied manually. */ }
    }

    if (!copied && redirectField.current) {
      redirectField.current.focus();
      redirectField.current.select();
      redirectField.current.setSelectionRange(0, redirectUri.length);
    }

    setCopyStatus(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyStatus("idle"), 2_500);
  };

  return <div className="spotify-guide">
    <div className="guide-heading"><p>Use the Spotify account that will own this jukebox. It must have Premium.</p><a className="external-link" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Open Spotify Developer Dashboard ↗</a></div>
    <ol>
      <li><strong>Sign in and choose “Create app.”</strong> Use a name such as <em>QueueMe</em> and a short description such as <em>Local party jukebox</em>.</li>
      <li><strong>Paste the redirect URI below.</strong> It must match exactly, including <code>http</code>, <code>127.0.0.1</code>, port, and path. Do not substitute <code>localhost</code> or a LAN address.</li>
    </ol>
    <div className={`redirect-copy ${copyStatus}`}><input ref={redirectField} readOnly aria-label="Spotify redirect URI" value={redirectUri} onFocus={(event) => event.currentTarget.select()} /><button type="button" className="small-button" onClick={() => void copyRedirectUri()}>{copyStatus === "copied" ? "Copied!" : copyStatus === "failed" ? "Press Ctrl+C" : "Copy"}</button></div>
    <ol start={3}>
      <li><strong>Select “Web API,” accept Spotify's developer terms, and save the app.</strong> QueueMe supplies its required OAuth permissions later; there are no scopes to enter in the dashboard.</li>
      <li><strong>Copy the credentials back into QueueMe.</strong> The app overview shows the Client ID. Choose <em>View client secret</em> to reveal the Client Secret.</li>
    </ol>
    <details><summary>Using a different Spotify account?</summary><p>For this proof of concept, the easiest setup is one account for the developer app, QueueMe authorization, and librespot. If another account must authorize the development-mode app, add it under the app's <strong>Settings → Users Management</strong> tab first.</p></details>
    <p className="guide-footnote">Your Client Secret and Spotify tokens stay on this machine and are encrypted in local storage. Never share or commit the secret.</p>
  </div>;
}
