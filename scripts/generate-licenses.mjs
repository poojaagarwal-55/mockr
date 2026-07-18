/**
 * generate-licenses.mjs
 *
 * Generates apps/web/public/licenses.json from the DIRECT production
 * dependencies declared in apps/web/package.json.
 *
 * Why only direct deps?
 *   - Industry-standard practice (Vercel, Linear, Notion, etc.)
 *   - Each npm package is responsible for its own transitive-dependency compliance
 *   - Transitive deps are implementation details of the library, not code we ship
 *   - Prevents hundreds of unrelated packages (build tools, API-server deps) appearing
 *
 * Run manually:  node scripts/generate-licenses.mjs
 * Check mode:    node scripts/generate-licenses.mjs --check
 * Auto-runs before: npm run build (via "prebuild" in apps/web/package.json)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WEB_PKG = path.join(ROOT, "apps", "web", "package.json");
const OUT_DIR = path.join(ROOT, "apps", "web", "public");
const OUT_FILE = path.join(OUT_DIR, "licenses.json");

const webPkg = JSON.parse(readFileSync(WEB_PKG, "utf8"));
const directDeps = Object.keys(webPkg.dependencies ?? {});

console.log(`Found ${directDeps.length} direct production dependencies in apps/web/package.json`);

const NM_ROOT = path.join(ROOT, "node_modules");
const NM_WEB = path.join(ROOT, "apps", "web", "node_modules");

function findPkgJson(name) {
  const rel = path.join(...name.split("/"), "package.json");
  const candidates = [
    path.join(NM_ROOT, rel),
    path.join(NM_WEB, rel),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const licenses = [];

for (const depName of directDeps) {
  const pkgJsonPath = findPkgJson(depName);
  if (!pkgJsonPath) {
    console.warn(`Could not find package.json for ${depName}; skipping`);
    continue;
  }

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  } catch {
    console.warn(`Could not parse package.json for ${depName}; skipping`);
    continue;
  }

  let license = "Unknown";
  if (typeof pkg.license === "string") {
    license = pkg.license;
  } else if (pkg.license?.type) {
    license = pkg.license.type;
  } else if (Array.isArray(pkg.licenses)) {
    license = pkg.licenses.map((item) => (typeof item === "string" ? item : item.type)).join(", ");
  }

  let repository = null;
  if (typeof pkg.repository === "string") {
    repository = pkg.repository.replace(/^git\+/, "").replace(/\.git$/, "");
    if (repository.startsWith("github:")) {
      repository = `https://github.com/${repository.slice(7)}`;
    }
  } else if (pkg.repository?.url) {
    repository = pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
    if (repository.startsWith("git://github.com/")) {
      repository = `https://github.com/${repository.slice(17)}`;
    }
    if (repository.startsWith("git+https://")) {
      repository = repository.slice(4);
    }
  }

  const publisher =
    typeof pkg.author === "string"
      ? pkg.author.replace(/ ?<[^>]+>/, "").replace(/ ?\([^)]+\)/, "").trim()
      : pkg.author?.name ?? null;

  licenses.push({
    name: depName,
    version: pkg.version ?? "unknown",
    license,
    repository,
    publisher: publisher || null,
  });
}

licenses.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

const nextJson = `${JSON.stringify(licenses, null, 2)}\n`;
const checkMode = process.argv.includes("--check");

if (checkMode) {
  const currentJson = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, "utf8") : "";
  if (currentJson !== nextJson) {
    console.error("License manifest is out of date.");
    console.error("Run: node scripts/generate-licenses.mjs");
    process.exit(1);
  }

  console.log(`licenses.json is up to date (${licenses.length} packages listed)`);
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, nextJson, "utf8");
  console.log(`licenses.json -> ${OUT_FILE} (${licenses.length} packages listed)`);
}
