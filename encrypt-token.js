// Locks your GitHub token with your site password and writes secret.json.
// Reads GITHUB_TOKEN and SITE_PASSWORD from .env (which is never pushed).
// Usage:  node encrypt-token.js
// Run it again whenever you change your password or make a new token.

const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

const ITERATIONS = 600000;

const envFile = path.join(__dirname, ".env");
if (!fs.existsSync(envFile)) {
  console.error("No .env file found next to this script.");
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const i = trimmed.indexOf("=");
  env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const token = env.GITHUB_TOKEN;
const password = env.SITE_PASSWORD;
if (!token || !password || token.includes("paste_yours_here")) {
  console.error("Fill in GITHUB_TOKEN and SITE_PASSWORD in .env first.");
  process.exit(1);
}

(async () => {
  const enc = new TextEncoder();
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const base = await webcrypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const data = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(token));
  const b64 = (bytes) => Buffer.from(bytes).toString("base64");

  const out = { iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(data)) };
  fs.writeFileSync(path.join(__dirname, "secret.json"), JSON.stringify(out, null, 2) + "\n");
  console.log("Wrote secret.json. Now commit and push it.");
})();
