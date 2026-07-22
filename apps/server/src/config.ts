import path from "node:path";

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const port = Number(process.env.PORT ?? 3000);
  const isProduction = process.argv.includes("--production") || process.env.NODE_ENV === "production";
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI ?? `http://127.0.0.1:${port}/api/v1/oauth/spotify/callback`;
  return {
    host: process.env.HOST ?? "0.0.0.0",
    port,
    dataDir: path.resolve(process.env.QUEUE_ME_DATA_DIR ?? "../../data"),
    redirectUri,
    secureCookies: redirectUri.startsWith("https://"),
    webDevUrl: isProduction ? undefined : "http://127.0.0.1:5173",
    isProduction,
  };
}
