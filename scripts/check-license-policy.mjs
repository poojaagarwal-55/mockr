import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const rootPkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

const ALLOWED_LICENSE_PATTERNS = [
  /^MIT$/i,
  /^ISC$/i,
  /^BSD-2-Clause$/i,
  /^BSD-3-Clause$/i,
  /^0BSD$/i,
  /^Apache-2\.0$/i,
  /^Python-2\.0$/i,
  /^CC0-1\.0$/i,
  /^Unlicense$/i,
];

const BLOCKED_LICENSE_PATTERNS = [
  /AGPL/i,
  /\bGPL\b/i,
  /LGPL/i,
  /SSPL/i,
  /BUSL/i,
  /Elastic/i,
  /Commons Clause/i,
  /Polyform/i,
  /Commercial/i,
  /Proprietary/i,
];

const PACKAGE_LICENSE_ALLOWLIST = new Map([
  ["gsap", /^Standard 'no charge' license:/i],
  ["@gsap/react", /^SEE LICENSE AT https:\/\/gsap\.com\/standard-license/i],
]);

function expandWorkspacePatterns(patterns) {
  const manifests = [];
  for (const pattern of patterns) {
    if (!pattern.endsWith("/*")) continue;
    const baseRel = pattern.slice(0, -2);
    const baseDir = path.join(ROOT, baseRel);
    if (!existsSync(baseDir)) continue;
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = path.join(baseDir, entry.name, "package.json");
      if (existsSync(pkgPath)) manifests.push(pkgPath);
    }
  }
  return manifests;
}

function normalizeLicense(pkg) {
  if (typeof pkg.license === "string" && pkg.license.trim()) return pkg.license.trim();
  if (pkg.license?.type) return String(pkg.license.type).trim();
  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
    return pkg.licenses.map((item) => (typeof item === "string" ? item : item?.type || "Unknown")).join(", ");
  }
  return "UNKNOWN";
}

function findInstalledPackageJson(name) {
  const rel = path.join(...name.split("/"), "package.json");
  const candidates = [
    path.join(ROOT, "node_modules", rel),
    path.join(ROOT, "apps", "web", "node_modules", rel),
    path.join(ROOT, "apps", "api", "node_modules", rel),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const workspaceManifests = expandWorkspacePatterns(rootPkg.workspaces || []);
const thirdPartyDeps = new Map();

for (const manifestPath of workspaceManifests) {
  const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
  const relManifestPath = path.relative(ROOT, manifestPath).replace(/\\/g, "/");
  for (const depName of Object.keys(pkg.dependencies || {})) {
    if (depName.startsWith("@interviewforge/")) continue;
    if (!thirdPartyDeps.has(depName)) thirdPartyDeps.set(depName, new Set());
    thirdPartyDeps.get(depName).add(relManifestPath);
  }
}

const failures = [];
const reviewed = [];

for (const [depName, sources] of [...thirdPartyDeps.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const pkgJsonPath = findInstalledPackageJson(depName);
  if (!pkgJsonPath) {
    failures.push({
      name: depName,
      license: "MISSING",
      reason: "package.json not found in installed node_modules",
      sources: [...sources],
    });
    continue;
  }

  const installedPkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  const license = normalizeLicense(installedPkg);
  reviewed.push({ name: depName, license, sources: [...sources] });

  const overridePattern = PACKAGE_LICENSE_ALLOWLIST.get(depName);
  if (overridePattern?.test(license)) continue;

  if (BLOCKED_LICENSE_PATTERNS.some((pattern) => pattern.test(license))) {
    failures.push({
      name: depName,
      license,
      reason: "license matches blocked policy",
      sources: [...sources],
    });
    continue;
  }

  if (!ALLOWED_LICENSE_PATTERNS.some((pattern) => pattern.test(license))) {
    failures.push({
      name: depName,
      license,
      reason: "license is not in the approved allowlist",
      sources: [...sources],
    });
  }
}

console.log(`Reviewed ${reviewed.length} direct production dependencies across workspace apps/packages.`);

if (failures.length > 0) {
  console.error("\nLicense policy check failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure.name}`);
    console.error(`  license: ${failure.license}`);
    console.error(`  reason: ${failure.reason}`);
    console.error(`  declared in: ${failure.sources.join(", ")}`);
  }
  process.exit(1);
}

console.log("All reviewed dependency licenses passed policy.");
