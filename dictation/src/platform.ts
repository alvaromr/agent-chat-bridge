// Where the worker can run: mlx, under mlx-whisper, publishes its packages only for Apple Silicon Macs on macOS 14 or
// later, and the worker installs wheels only (worker/pyproject.toml).

/** Darwin's major version on macOS 14. */
const MACOS_14 = 23;

/** Whether the worker's packages exist for this machine, from Node's `os.platform()`, `os.arch()` and `os.release()`. */
export const canRunWorker = (platform: string, arch: string, release: string) =>
    platform === "darwin" && arch === "arm64" && Number.parseInt(release, 10) >= MACOS_14;
