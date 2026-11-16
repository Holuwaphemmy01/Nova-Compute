/** Native worker install commands shown on the Machines page. Edit freely. */

export type WorkerPlatform = "linux" | "windows" | "docker";

export const INSTALL_URL = "[INSTALL URL]"; // TODO: real install script URL
export const IMAGE = "[IMAGE]"; // TODO: published Docker image, e.g. ghcr.io/…/nova-worker

export const PLATFORMS: { value: WorkerPlatform; label: string }[] = [
  { value: "linux", label: "Linux / macOS" },
  { value: "windows", label: "Windows" },
  { value: "docker", label: "Docker" },
];

/** {INSTALL_URL}, {IMAGE} and {CODE} are substituted at render time. */
export const WORKER_COMMANDS: Record<WorkerPlatform, string[]> = {
  linux: ["curl -fsSL {INSTALL_URL} | sh", "nova-worker pair {CODE}"],
  windows: ["iwr {INSTALL_URL} -useb | iex", "nova-worker.exe pair {CODE}"],
  docker: ["docker run -d --gpus all {IMAGE} pair {CODE}"],
};

export function buildCommands(platform: WorkerPlatform, code: string): string[] {
  return WORKER_COMMANDS[platform].map((c) =>
    c.replaceAll("{INSTALL_URL}", INSTALL_URL).replaceAll("{IMAGE}", IMAGE).replaceAll("{CODE}", code),
  );
}
