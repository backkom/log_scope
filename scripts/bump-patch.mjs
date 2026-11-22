import { readFileSync, writeFileSync } from "node:fs";

const packagePath = new URL("../package.json", import.meta.url);
const cargoPath = new URL("../src-tauri/Cargo.toml", import.meta.url);
const tauriPath = new URL("../src-tauri/tauri.conf.json", import.meta.url);

const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const tauriConfig = JSON.parse(readFileSync(tauriPath, "utf8"));
const cargoToml = readFileSync(cargoPath, "utf8");
const cargoVersion = cargoToml.match(/^version = "([^"]+)"/m)?.[1];
const versions = [packageJson.version, cargoVersion, tauriConfig.version];

if (versions.some((version) => typeof version !== "string") || new Set(versions).size !== 1) {
  throw new Error(`Version mismatch: package=${versions[0]}, cargo=${versions[1]}, tauri=${versions[2]}`);
}

const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(packageJson.version);
if (!match) {
  throw new Error(`Expected a stable major.minor.patch version, got ${packageJson.version}`);
}

const nextVersion = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
packageJson.version = nextVersion;
tauriConfig.version = nextVersion;

writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
writeFileSync(
  cargoPath,
  cargoToml.replace(/^version = "[^"]+"/m, `version = "${nextVersion}"`),
);
writeFileSync(tauriPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);

console.log(`Version: ${versions[0]} -> ${nextVersion}`);
