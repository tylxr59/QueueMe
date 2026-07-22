import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const originalArgv = [...process.argv];
const originalRedirectUri = process.env.SPOTIFY_REDIRECT_URI;

afterEach(() => {
  process.argv.splice(0, process.argv.length, ...originalArgv);
  if (originalRedirectUri === undefined) delete process.env.SPOTIFY_REDIRECT_URI;
  else process.env.SPOTIFY_REDIRECT_URI = originalRedirectUri;
});

describe("runtime configuration", () => {
  it("does not mark cookies Secure merely because the production build serves local HTTP", () => {
    process.argv.push("--production");
    delete process.env.SPOTIFY_REDIRECT_URI;

    const config = loadConfig();

    expect(config.isProduction).toBe(true);
    expect(config.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(config.secureCookies).toBe(false);
  });

  it("uses Secure cookies when the configured public callback uses HTTPS", () => {
    process.env.SPOTIFY_REDIRECT_URI = "https://jukebox.example/api/v1/oauth/spotify/callback";

    expect(loadConfig().secureCookies).toBe(true);
  });
});
