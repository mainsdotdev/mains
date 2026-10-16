import path from "node:path";

export function desktopUserDataPath(options: {
  appData: string;
  isPackaged: boolean;
  requestedPath?: string;
  devPath?: string;
  smokeTest: boolean;
  smokePath?: string;
}): string {
  if (options.smokeTest) {
    if (!options.smokePath || !path.isAbsolute(options.smokePath))
      throw new Error("Package smoke requires an isolated absolute userData directory");
    return options.smokePath;
  }
  const requested = options.requestedPath ?? (!options.isPackaged ? options.devPath : undefined);
  if (requested !== undefined && !path.isAbsolute(requested))
    throw new Error(options.requestedPath !== undefined
      ? "--user-data-dir must be an absolute directory"
      : "MAINS_DEV_USER_DATA must be an absolute directory");
  return requested ?? path.join(options.appData, "mains");
}
