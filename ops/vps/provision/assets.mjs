import { createHash } from "node:crypto";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function unitBytes(manifest, slot) {
  const unit = `moawork-web-${slot}.service`;
  const releaseDir = `${manifest.paths.releaseRoot}/${slot}/runtime/app`;
  const identityEnv = `${manifest.paths.releaseRoot}/${slot}/.moawork-release.env`;
  return `[Unit]\nDescription=MoaWork web ${slot} slot\nAfter=network-online.target\nWants=network-online.target\nConditionPathExists=${manifest.paths.runtimeEnvFile}\nConditionPathExists=${releaseDir}/server.js\n\n[Service]\nType=simple\nUser=${manifest.accounts.service.name}\nWorkingDirectory=${releaseDir}\nEnvironmentFile=${manifest.paths.runtimeEnvFile}\nEnvironmentFile=${identityEnv}\nExecStart=${manifest.paths.nodePath} server.js\nRestart=on-failure\nRestartSec=${manifest.resources.restartUSec}us\nMemoryMax=${manifest.resources.memoryMaxBytes}\nTasksMax=${manifest.resources.tasksMax}\nCPUQuota=${manifest.resources.cpuQuotaPerSecUSec / 10_000}%\nStandardOutput=journal\nStandardError=journal\nSyslogIdentifier=${unit.slice(0, -8)}\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=true\nReadWritePaths=${manifest.paths.releaseRoot}\n\n[Install]\nWantedBy=multi-user.target\n`;
}

function caddyRootBytes(manifest) {
  // The leading LF is part of the managed delta. It lets the collector strip
  // this block while preserving every original root byte, including an empty
  // file, CRLF content, or a final line without LF.
  return `\n# Managed MoaWork import. Existing unrelated site blocks remain outside this file.\nimport ${manifest.paths.caddySiteFile}\n`;
}

function caddySiteBytes(manifest) {
  return `${manifest.hostLabels.join(", ")} {\n\tencode zstd gzip\n\t# Empty-safe before first cutover: a missing glob contributes no route.\n\timport ${manifest.paths.caddyManagedDirectory}/*.caddy\n}\n`;
}

function polkitBytes(manifest) {
  return `// Generated from ${manifest.schema}; trusted deployer can manage only reviewed units and verbs.\npolkit.addRule(function(action, subject) {\n  if (action.id !== "org.freedesktop.systemd1.manage-units" || subject.user !== "${manifest.accounts.deploy.name}") return polkit.Result.NOT_HANDLED;\n  const unit = action.lookup("unit");\n  const verb = action.lookup("verb");\n  if (["moawork-web-blue.service", "moawork-web-green.service"].indexOf(unit) >= 0 && ["stop", "restart"].indexOf(verb) >= 0) return polkit.Result.YES;\n  if (unit === "caddy.service" && verb === "reload") return polkit.Result.YES;\n  return polkit.Result.NOT_HANDLED;\n});\n`;
}

function releaseConfigBytes(manifest) {
  const caddyImportLine = `import ${manifest.paths.caddySiteFile}`;
  const config = {
    schema: 1,
    serviceUser: manifest.accounts.service.name,
    releaseRoot: manifest.paths.releaseRoot,
    runtimeEnvFile: manifest.paths.runtimeEnvFile,
    stateFile: manifest.paths.stateFile,
    lockFile: manifest.paths.lockFile,
    upstreamFile: manifest.paths.upstreamFile,
    caddyConfigFile: manifest.paths.caddyConfigFile,
    caddyImportLine,
    caddySiteFile: manifest.paths.caddySiteFile,
    caddySiteSha256: manifest.caddy.siteSha256,
    caddyClosureSha256: manifest.caddy.closureSha256,
    caddyPath: manifest.executables.caddyPath,
    caddyUnit: "caddy.service",
    systemctlPath: manifest.executables.systemctlPath,
    nodePath: manifest.paths.nodePath,
    nodeArch: manifest.node.arch,
    nodeVersion: manifest.node.version,
    trustedBuilderPublicKeyPath: manifest.paths.trustedBuilderPublicKeyPath,
    publicHealthUrl: `https://${manifest.hostLabels[0]}/api/health/ready`,
    timeoutMs: 30_000,
    slotIds: ["blue", "green"],
    slots: {
      blue: { port: manifest.ports.blue, releaseDir: `${manifest.paths.releaseRoot}/blue`, unit: "moawork-web-blue.service" },
      green: { port: manifest.ports.green, releaseDir: `${manifest.paths.releaseRoot}/green`, unit: "moawork-web-green.service" },
    },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function renderProvisionAssets(manifest) {
  const blue = unitBytes(manifest, "blue");
  const green = unitBytes(manifest, "green");
  const caddyRoot = caddyRootBytes(manifest);
  const caddySite = caddySiteBytes(manifest);
  const polkit = polkitBytes(manifest);
  const releaseConfig = releaseConfigBytes(manifest);
  return Object.freeze({
    blueUnit: Object.freeze({ path: "/etc/systemd/system/moawork-web-blue.service", bytes: blue, mode: "0644", owner: "root", group: "root", sha256: sha256(blue) }),
    greenUnit: Object.freeze({ path: "/etc/systemd/system/moawork-web-green.service", bytes: green, mode: "0644", owner: "root", group: "root", sha256: sha256(green) }),
    caddyImport: Object.freeze({ path: manifest.paths.caddyConfigFile, bytes: caddyRoot, mode: "0644", owner: "root", group: "root", operation: "append_exact_line", sha256: sha256(caddyRoot) }),
    caddySite: Object.freeze({ path: manifest.paths.caddySiteFile, bytes: caddySite, mode: "0644", owner: "root", group: "root", sha256: sha256(caddySite) }),
    polkit: Object.freeze({ path: manifest.paths.polkitRuleFile, bytes: polkit, mode: "0644", owner: "root", group: "root", sha256: sha256(polkit) }),
    releaseConfig: Object.freeze({ path: manifest.paths.releaseConfigFile, bytes: releaseConfig, mode: "0644", owner: "root", group: "root", sha256: sha256(releaseConfig) }),
  });
}

export function provisionAssetIdentity(assets) {
  return Object.fromEntries(Object.entries(assets).map(([key, asset]) => [key, { path: asset.path, mode: asset.mode, owner: asset.owner, group: asset.group, sha256: asset.sha256 }]));
}

export function verifyProvisionAssets(manifest, assets = renderProvisionAssets(manifest)) {
  const required = ["blueUnit", "greenUnit", "caddyImport", "caddySite", "polkit", "releaseConfig"];
  if (JSON.stringify(Object.keys(assets).sort()) !== JSON.stringify(required.sort())) throw Object.assign(new Error("provision asset set differs from the reviewed contract"), { code: "ASSET_SET" });
  for (const asset of Object.values(assets)) {
    if (sha256(asset.bytes) !== asset.sha256) throw Object.assign(new Error("provision asset bytes changed after rendering"), { code: "ASSET_DRIFT" });
  }
  const caddyClosureSha256 = sha256(`import ${manifest.paths.caddySiteFile}\0${assets.caddySite.bytes}`);
  const expected = {
    blueUnit: manifest.units.blueSha256,
    greenUnit: manifest.units.greenSha256,
    polkit: manifest.units.polkitSha256,
    caddySite: manifest.caddy.siteSha256,
    caddyClosure: manifest.caddy.closureSha256,
  };
  const actual = {
    blueUnit: assets.blueUnit.sha256,
    greenUnit: assets.greenUnit.sha256,
    polkit: assets.polkit.sha256,
    caddySite: assets.caddySite.sha256,
    caddyClosure: caddyClosureSha256,
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Object.assign(new Error("provision asset digest differs from the exact manifest"), { code: "ASSET_IDENTITY" });
  return Object.freeze({ assets, caddyClosureSha256 });
}
