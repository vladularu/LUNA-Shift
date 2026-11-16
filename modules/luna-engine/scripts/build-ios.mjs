import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const allowed = ["aarch64-apple-ios", "aarch64-apple-ios-sim", "x86_64-apple-ios"];
export function iosTargets(value, architecture = process.arch) {
  const targets = value
    ? value.split(",")
    : [
        "aarch64-apple-ios",
        architecture === "arm64" ? "aarch64-apple-ios-sim" : "x86_64-apple-ios",
      ];
  if (
    targets.length === 0 ||
    targets.length > 2 ||
    new Set(targets).size !== targets.length ||
    targets.some((target) => !allowed.includes(target))
  )
    throw new Error("INVALID_IOS_TARGETS");
  return targets;
}

/** Local locked build only. The hook/CI must provision rustup before this step. */
export async function build({ root, env = process.env, host = process.platform }) {
  if (host !== "darwin" || env.APP_VARIANT !== "internal" || env.LUNA_FULL_ENGINE !== "1")
    throw new Error("INTERNAL_MACOS_BUILD_REQUIRED");
  const targets = iosTargets(env.LUNA_IOS_TARGETS);
  const rustup = env.LUNA_RUSTUP ?? "rustup";
  const run = (file, args, extraEnv = env) =>
    execFileSync(file, args, { cwd: root, env: extraEnv, stdio: "inherit" });
  const rustVersion = execFileSync(rustup, ["run", "1.99.1", "rustc", "--version"], {
    env,
    encoding: "utf8",
  }).trim();
  if (!rustVersion.startsWith("rustc 1.99.1 ")) throw new Error("PINNED_RUST_REQUIRED");
  const buildDir = path.join(root, ".build/ios");
  const headers = path.join(buildDir, "headers");
  const output = path.join(root, "ios/LunaEngineCore.xcframework");
  if (existsSync(output)) throw new Error("PRIOR_XCFRAMEWORK_EXISTS");
  mkdirSync(headers, { recursive: true });
  cpSync(path.join(root, "rust/include/LunaEngine.h"), path.join(headers, "LunaEngine.h"));
  cpSync(path.join(root, "rust/include/LunaEngine.h"), path.join(root, "ios/LunaEngine.h"));
  writeFileSync(
    path.join(headers, "module.modulemap"),
    'module LunaEngineCore { header "LunaEngine.h" export * }\n',
  );
  const args = ["-create-xcframework"];
  const artifacts = [];
  for (const target of targets) {
    run(rustup, ["target", "add", "--toolchain", "1.99.1", target]);
    const sdk = target === "aarch64-apple-ios" ? "iphoneos" : "iphonesimulator";
    const sdkRoot = execFileSync("xcrun", ["--sdk", sdk, "--show-sdk-path"], {
      encoding: "utf8",
    }).trim();
    const buildEnv = {
      ...env,
      CARGO_TARGET_DIR: path.join(buildDir, "target"),
      IPHONEOS_DEPLOYMENT_TARGET: "16.4",
      SDKROOT: sdkRoot,
    };
    run(
      rustup,
      [
        "run",
        "1.99.1",
        "cargo",
        "build",
        "--release",
        "--locked",
        "--lib",
        "--target",
        target,
        "--manifest-path",
        path.join(root, "rust/Cargo.toml"),
      ],
      buildEnv,
    );
    const library = path.join(buildEnv.CARGO_TARGET_DIR, target, "release/libluna_engine.a");
    args.push("-library", library, "-headers", headers);
    artifacts.push({
      target,
      sha256: createHash("sha256").update(readFileSync(library)).digest("hex"),
    });
  }
  run("xcodebuild", [...args, "-output", output]);
  writeFileSync(
    path.join(buildDir, "build-receipt.json"),
    `${JSON.stringify(
      {
        rustVersion,
        targets,
        artifacts,
        cargoLockSha256: createHash("sha256")
          .update(readFileSync(path.join(root, "rust/Cargo.lock")))
          .digest("hex"),
      },
      null,
      2,
    )}\n`,
  );
}
