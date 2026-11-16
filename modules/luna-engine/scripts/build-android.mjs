import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const targets = {
  "armeabi-v7a": ["armv7-linux-androideabi", "armv7a-linux-androideabi26"],
  x86: ["i686-linux-android", "i686-linux-android26"],
  "arm64-v8a": ["aarch64-linux-android", "aarch64-linux-android26"],
  x86_64: ["x86_64-linux-android", "x86_64-linux-android26"],
};
export function androidAbis(value) {
  const abis = value ? value.split(",") : ["armeabi-v7a", "x86", "x86_64", "arm64-v8a"];
  if (
    abis.length === 0 ||
    abis.length > 4 ||
    new Set(abis).size !== abis.length ||
    abis.some((abi) => !Object.hasOwn(targets, abi))
  )
    throw new Error("INVALID_ANDROID_ABIS");
  return abis;
}
export async function build({ root, env = process.env, host = process.platform }) {
  if (env.APP_VARIANT !== "internal" || env.LUNA_FULL_ENGINE !== "1")
    throw new Error("INTERNAL_ANDROID_BUILD_REQUIRED");
  const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error("ANDROID_SDK_REQUIRED");
  const hostTag = { win32: "windows-x86_64", darwin: "darwin-x86_64", linux: "linux-x86_64" }[host];
  if (!hostTag) throw new Error("ANDROID_HOST_UNSUPPORTED");
  const ndk = path.join(sdk, "ndk/27.1.12297006/toolchains/llvm/prebuilt", hostTag, "bin");
  const rustup = env.LUNA_RUSTUP ?? "rustup";
  const version = execFileSync(rustup, ["run", "1.99.1", "rustc", "--version"], {
    env,
    encoding: "utf8",
  }).trim();
  if (!version.startsWith("rustc 1.99.1 ")) throw new Error("PINNED_RUST_REQUIRED");
  const buildDir = path.join(root, ".build/android");
  const artifacts = [];
  for (const abi of androidAbis(env.LUNA_ANDROID_ABIS)) {
    const [target, compilerPrefix] = targets[abi];
    const compiler = path.join(ndk, `${compilerPrefix}-clang${host === "win32" ? ".cmd" : ""}`);
    if (!existsSync(compiler)) throw new Error("PINNED_NDK_REQUIRED");
    if (env.LUNA_OFFLINE_TARGETS !== "1")
      execFileSync(rustup, ["target", "add", "--toolchain", "1.99.1", target], {
        env,
        stdio: "inherit",
      });
    if (env.RUSTFLAGS && !env.CARGO_ENCODED_RUSTFLAGS) throw new Error("USE_ENCODED_RUSTFLAGS");
    const targetEnv = target.toUpperCase().replaceAll("-", "_");
    const buildEnv = {
      ...env,
      CARGO_TARGET_DIR: env.LUNA_ENGINE_TARGET_DIR ?? path.join(buildDir, "target"),
      [`CARGO_TARGET_${targetEnv}_LINKER`]: compiler,
      CARGO_ENCODED_RUSTFLAGS: [
        env.CARGO_ENCODED_RUSTFLAGS,
        "-Clink-arg=-Wl,-z,max-page-size=16384",
        "-Clink-arg=-Wl,-z,common-page-size=16384",
      ]
        .filter(Boolean)
        .join("\x1f"),
    };
    execFileSync(
      rustup,
      [
        "run",
        "1.99.1",
        "cargo",
        "build",
        "--release",
        "--locked",
        ...(env.LUNA_OFFLINE_TARGETS === "1" ? ["--offline"] : []),
        "--lib",
        "--target",
        target,
        "--manifest-path",
        path.join(root, "rust/Cargo.toml"),
      ],
      { cwd: root, env: buildEnv, stdio: "inherit" },
    );
    const source = path.join(buildEnv.CARGO_TARGET_DIR, target, "release/libluna_engine.so");
    // CMake IMPORTED dependencies are packaged by AGP. Keeping the same .so
    // in jniLibs as well would make mergeNativeLibs package it twice.
    const destination = path.join(buildDir, "prebuilt", abi);
    mkdirSync(destination, { recursive: true });
    cpSync(source, path.join(destination, "libluna_engine.so"));
    artifacts.push({
      abi,
      target,
      sha256: createHash("sha256").update(readFileSync(source)).digest("hex"),
    });
  }
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(
    path.join(buildDir, "build-receipt.json"),
    `${JSON.stringify({ rustVersion: version, ndk: "27.1.12297006", artifacts }, null, 2)}\n`,
  );
}
