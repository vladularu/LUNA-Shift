import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { prepareNative } from "../../luna-engine/scripts/native-config.mjs";

// Runs before pod install: prepare_command is not executed for local pods.
if (process.env.EAS_BUILD_PLATFORM !== "ios") process.exit(0);
const variant = process.env.APP_VARIANT;
if (process.platform !== "darwin" || (variant !== "internal" && variant !== "production")) {
  throw new Error("Rust iOS builds require macOS and the internal or production app variant");
}
const root = fileURLToPath(new URL("../", import.meta.url));
const build = path.join(root, ".build");
const cargoHome = path.join(build, "cargo");
const rustupHome = path.join(build, "rustup");
mkdirSync(build, { recursive: true });
const hosts = {
  arm64: [
    "aarch64-apple-darwin",
    "20ef5516c31b1ac2290084199ba77dbbcaa1406c45c1d978ca68558ef5964ef5",
  ],
  x64: ["x86_64-apple-darwin", "9c331076f62b4d0edeae63d9d1c9442d5fe39b37b05025ec8d41c5ed35486496"],
};
const host = hosts[process.arch];
if (!host) throw new Error("Unsupported macOS architecture");
const installer = path.join(build, "rustup-init");
if (!existsSync(installer)) {
  const response = await fetch(
    `https://static.rust-lang.org/rustup/archive/1.28.2/${host[0]}/rustup-init`,
  );
  if (!response.ok) throw new Error(`Rust bootstrap download failed: ${response.status}`);
  writeFileSync(installer, Buffer.from(await response.arrayBuffer()));
}
if (createHash("sha256").update(readFileSync(installer)).digest("hex") !== host[1]) {
  throw new Error("Rust bootstrap checksum mismatch");
}
chmodSync(installer, 0o700);
const env = {
  ...process.env,
  CARGO_HOME: cargoHome,
  RUSTUP_HOME: rustupHome,
  CARGO_TARGET_DIR: path.join(build, "target"),
  IPHONEOS_DEPLOYMENT_TARGET: "16.4",
};
const run = (file, args) => execFileSync(file, args, { cwd: root, env, stdio: "inherit" });
run(installer, ["-y", "--no-modify-path", "--default-toolchain", "none"]);
run(path.join(cargoHome, "bin/rustup"), [
  "toolchain",
  "install",
  "1.99.1",
  "--profile",
  "minimal",
  "--target",
  "aarch64-apple-ios",
]);
env.SDKROOT = execFileSync("xcrun", ["--sdk", "iphoneos", "--show-sdk-path"], {
  encoding: "utf8",
}).trim();
run(path.join(cargoHome, "bin/cargo"), [
  "+1.99.1",
  "build",
  "--release",
  "--locked",
  "--lib",
  "--target",
  "aarch64-apple-ios",
  "--manifest-path",
  path.join(root, "rust/Cargo.toml"),
]);
const output = path.join(root, "ios/LunaRestCore.xcframework");
if (existsSync(output)) throw new Error("Remove the prior generated XCFramework before rebuilding");
run("xcodebuild", [
  "-create-xcframework",
  "-library",
  path.join(env.CARGO_TARGET_DIR, "aarch64-apple-ios/release/libluna_rest_pilot.a"),
  "-output",
  output,
]);
console.log(`Prepared pinned Rust device library for ${variant} pod installation.`);
if (process.env.LUNA_FULL_ENGINE === "1") {
  await prepareNative({ env: { ...env, LUNA_RUSTUP: path.join(cargoHome, "bin/rustup") } });
}
