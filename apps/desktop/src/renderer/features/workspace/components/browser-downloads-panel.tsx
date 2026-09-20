import { Button, Text } from "@/components/ui";
import {
  ChevronLeft,
  Download,
  FileIconComponent,
  Finder,
  OpenWith,
  Stop,
} from "@/components/ui/icons";

export type BrowserDownloadState =
  | "progressing"
  | "paused"
  | "completed"
  | "cancelled"
  | "interrupted";

export interface BrowserDownloadViewModel {
  id: string;
  tabId: string | null;
  fileName: string;
  savePath: string;
  sourceUrl: string;
  mimeType: string;
  state: BrowserDownloadState;
  receivedBytes: number;
  totalBytes: number;
  speedBytesPerSecond: number;
  startedAt: string;
  updatedAt: string;
}

interface BrowserDownloadsPanelProps {
  downloads: BrowserDownloadViewModel[];
  onBack: () => void;
  onCancel: (downloadId: string) => void;
  onClear: () => void;
  onOpen: (downloadId: string) => void;
  onShowInFolder: (downloadId: string) => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** power;
  const digits = power === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[power]}`;
}

function fileExtension(fileName: string): string | undefined {
  const separator = fileName.lastIndexOf(".");
  return separator > 0 && separator < fileName.length - 1
    ? fileName.slice(separator + 1)
    : undefined;
}

function statusText(download: BrowserDownloadViewModel): string {
  if (download.state === "completed") {
    return `${formatBytes(download.receivedBytes)} · Downloaded`;
  }
  if (download.state === "cancelled") return "Cancelled";
  if (download.state === "interrupted") return "Interrupted";
  if (download.state === "paused") return "Paused";

  const received = formatBytes(download.receivedBytes);
  const speed = download.speedBytesPerSecond > 0
    ? ` · ${formatBytes(download.speedBytesPerSecond)}/s`
    : "";
  return download.totalBytes > 0
    ? `${received} of ${formatBytes(download.totalBytes)}${speed}`
    : `${received}${speed}`;
}

function progressPercent(download: BrowserDownloadViewModel): number | null {
  if (download.totalBytes <= 0) return null;
  return Math.min(
    100,
    Math.max(0, (download.receivedBytes / download.totalBytes) * 100),
  );
}

export function BrowserDownloadsPanel({
  downloads,
  onBack,
  onCancel,
  onClear,
  onOpen,
  onShowInFolder,
}: BrowserDownloadsPanelProps) {
  const activeCount = downloads.filter(
    (download) =>
      download.state === "progressing" || download.state === "paused",
  ).length;
  const finishedCount = downloads.length - activeCount;

  return (
    <div className="w-90" role="none">
      <div className="flex h-10 items-center gap-2 border-b border-primary-200/70 px-2 dark:border-primary-800/70">
        <Button
          autoFocus
          role="menuitem"
          tabIndex={-1}
          onClick={onBack}
          aria-label="Back to browser menu"
          className="rounded-lg text-primary-600  hover:text-primary-900 dark:text-primary-300  dark:hover:text-primary-100"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <Text as="span" size="xs" weight="medium" className="min-w-0 flex-1">
          Downloads
        </Text>
        {activeCount > 0 && (
          <Text
            as="span"
            size="xxs"
            tone="subtle"
            className="rounded-full bg-primary-200/60 px-2 py-0.5 tabular-nums dark:bg-primary-800/60"
          >
            {activeCount} active
          </Text>
        )}
        {finishedCount > 0 && (
          <Button
            role="menuitem"
            tabIndex={-1}
            onClick={onClear}
            className="rounded-lg px-2 py-1 text-xxs text-primary-600 hover:bg-primary-200/60 hover:text-primary-900 dark:text-primary-400 dark:hover:bg-primary-800/70 dark:hover:text-primary-100"
          >
            Clear
          </Button>
        )}
      </div>

      {downloads.length === 0 ? (
        <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-8 text-center">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary-200/60 text-primary-500 dark:bg-primary-800/50 dark:text-primary-400">
            <Download className="size-4" />
          </div>
          <div>
            <Text as="div" size="xs" tone="secondary">
              No downloads yet
            </Text>
            <Text as="div" size="xxs" tone="subtle" className="mt-0.5">
              Files downloaded from browser tabs appear here.
            </Text>
          </div>
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto " role="none">
          {downloads.map((download) => {
            const progress = progressPercent(download);
            const isActive =
              download.state === "progressing" ||
              download.state === "paused";
            const isCompleted = download.state === "completed";

            return (
              <div
                key={download.id}
                className="group/download flex gap-2.5  p-1.5 transition-colors hover:bg-primary-200/35 dark:hover:bg-primary/5"
                role="none"
              >
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center p-2">
                  <FileIconComponent
                    fileName={download.fileName}
                    extension={fileExtension(download.fileName)}
                    className="size-4"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <Text
                    as="div"
                    size="xs"
                    weight="medium"
                    className="truncate text-primary-800 dark:text-primary-200"
                    title={download.fileName}
                  >
                    {download.fileName}
                  </Text>
                  <Text
                    as="div"
                    size="xxs"
                    tone={
                      download.state === "interrupted" ||
                      download.state === "cancelled"
                        ? "secondary"
                        : "subtle"
                    }
                    className="mt-0.5 truncate tabular-nums"
                  >
                    {statusText(download)}
                  </Text>

                  {isActive && (
                    <div
                      role="progressbar"
                      aria-label={`Downloading ${download.fileName}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress === null ? undefined : Math.round(progress)}
                      className="mt-1.5 h-1 overflow-hidden rounded-full bg-primary-300/60 dark:bg-primary-700/60"
                    >
                      <div
                        className={`h-full rounded-full bg-accent transition-[width] duration-200 ${
                          progress === null ? "w-1/3 animate-pulse" : ""
                        }`}
                        style={
                          progress === null ? undefined : { width: `${progress}%` }
                        }
                      />
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-0.5 self-center" role="none">
                  {isActive && (
                    <Button
                      role="menuitem"
                      tabIndex={-1}
                      tooltip="Cancel download"
                      tooltipPosition="top-left"
                      onClick={() => onCancel(download.id)}
                      aria-label={`Cancel ${download.fileName}`}
                      className="rounded-lg p-1.5 text-primary-500 hover:bg-primary-200/60 hover:text-danger dark:text-primary-400 dark:hover:bg-primary-800/70 dark:hover:text-danger"
                    >
                      <Stop className="size-3.5" />
                    </Button>
                  )}
                  {isCompleted && (
                    <>
                      <Button
                        role="menuitem"
                        tabIndex={-1}
                        tooltip="Open"
                        tooltipPosition="top-left"
                        onClick={() => onOpen(download.id)}
                        aria-label={`Open ${download.fileName}`}
                        className="rounded-lg p-1.5 text-primary-500 hover:bg-primary-200/60 hover:text-primary-900 dark:text-primary-400 dark:hover:bg-primary-800/70 dark:hover:text-primary-100"
                      >
                        <OpenWith className="size-3.5" />
                      </Button>
                      <Button
                        role="menuitem"
                        tabIndex={-1}
                        tooltip="Show in Finder"
                        tooltipPosition="top-left"
                        onClick={() => onShowInFolder(download.id)}
                        aria-label={`Show ${download.fileName} in Finder`}
                        className="rounded-lg p-1.5 text-primary-500 hover:bg-primary-200/60 hover:text-primary-900 dark:text-primary-400 dark:hover:bg-primary-800/70 dark:hover:text-primary-100"
                      >
                        <Finder className="size-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
