/**
 * Android helper: build, install, launch and capture logs without Android Studio.
 *
 * Uses the JDK bundled with Android Studio (`JAVA_HOME`) and the Android SDK
 * (`ANDROID_HOME`/`ANDROID_SDK_ROOT`), falling back to sensible Windows paths.
 *
 * Usage:
 *   node scripts/android.mjs devices
 *   node scripts/android.mjs build      # gradlew assembleDebug
 *   node scripts/android.mjs install    # adb install -r <apk>
 *   node scripts/android.mjs launch     # start MainActivity
 *   node scripts/android.mjs logs       # tail filtered logcat (Ctrl+C to stop)
 *   node scripts/android.mjs test       # build + install + launch + 15s of logs
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const androidDir = fileURLToPath(new URL('../android/', import.meta.url));
const apkPath = join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const appId = 'org.pforum.app';
const activity = `${appId}/.MainActivity`;

function findAndroidHome() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : undefined,
  ].filter(Boolean);
  return candidates.find((dir) => dir && existsSync(dir));
}

function findJavaHome() {
  const candidates = [
    process.env.JAVA_HOME,
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    'C:\\Program Files\\Java\\jdk-17',
  ].filter(Boolean);
  return candidates.find((dir) => dir && existsSync(dir));
}

function adb() {
  const home = findAndroidHome();
  const exe = home ? join(home, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb';
  return existsSync(exe) ? exe : 'adb';
}

function env() {
  const javaHome = findJavaHome();
  const androidHome = findAndroidHome();
  return {
    ...process.env,
    ...(javaHome ? { JAVA_HOME: javaHome } : {}),
    ...(androidHome ? { ANDROID_HOME: androidHome, ANDROID_SDK_ROOT: androidHome } : {}),
  };
}

function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', env: env(), ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function devices() {
  run(adb(), ['devices', '-l']);
}

function build() {
  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  run(gradlew, ['assembleDebug'], { cwd: androidDir });
}

function install() {
  if (!existsSync(apkPath)) {
    console.error(`APK not found at ${apkPath}. Run "build" first.`);
    process.exit(1);
  }
  run(adb(), ['install', '-r', apkPath]);
}

function launch() {
  run(adb(), ['shell', 'am', 'start', '-n', activity]);
}

function logs() {
  // Show app + Capacitor/Node logs, dropping the noise.
  run(adb(), ['logcat', '-v', 'time', 'Capacitor:V', 'CapacitorPlugin:V', 'Nodejs:V', 'chromium:E', 'AndroidRuntime:E', '*:S']);
}

function test() {
  build();
  install();
  run(adb(), ['logcat', '-c']);
  launch();
  console.log('\nCapturing logs for 15s…');
  const result = spawnSync(
    adb(),
    ['logcat', '-v', 'time', 'Capacitor:V', 'CapacitorPlugin:V', 'Nodejs:V', 'chromium:V', 'AndroidRuntime:E', '*:S'],
    { env: env(), timeout: 15_000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  console.log(result.stdout ?? '');
  if (result.stderr) console.error(result.stderr);
}

const command = process.argv[2] ?? 'devices';
switch (command) {
  case 'devices':
    devices();
    break;
  case 'build':
    build();
    break;
  case 'install':
    install();
    break;
  case 'launch':
    launch();
    break;
  case 'logs':
    logs();
    break;
  case 'test':
    test();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
