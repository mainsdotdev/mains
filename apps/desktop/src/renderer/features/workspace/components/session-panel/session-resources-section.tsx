import { useMemo, useState, type ReactNode } from "react";
import { Button, Text } from "@/components/ui";
import {
  Bug,
  Chart,
  FileIconComponent,
  Link,
  Note,
  Picture,
  Plugin,
  Read,
  Web,
} from "@/components/ui/icons";
import {
  useGetRunArtifactsQuery,
  useGetRunContextQuery,
  useGetToolCallsByRunQuery,
  useListRunOutputFilesQuery,
  type RunArtifact,
  type RunContext,
  type RunOutputFile,
  type ToolCall,
} from "@/lib/redux/api";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { useOpenLink } from "@/hooks/use-open-link";
import { useOpenFileInEditor } from "@/features/workspace/hooks/use-open-file-in-editor";
import { useRunEventRefetch } from "@/features/workspace/hooks/use-run-event-refetch";
import { ImagePreviewModal } from "@/features/workspace/components/image-preview-modal";
import { BrowserFavicon } from "@/features/workspace/components/browser-favicon";
import { faviconUrlForHref } from "@/lib/favicon-url";
import { PanelItem } from "./panel-item";
import {
  buildSessionResources,
  type SessionPlugin,
  type SessionResource,
} from "./session-resources";

const COLLAPSED_ITEM_COUNT = 4;
const EMPTY_CONTEXT: RunContext[] = [];
const EMPTY_ARTIFACTS: RunArtifact[] = [];
const EMPTY_TOOL_CALLS: ToolCall[] = [];
const EMPTY_OUTPUT_FILES: RunOutputFile[] = [];

function SectionHeading({
  id,
  title,
  //count,
}: {
  id: string;
  title: string;
}) {
  return (
    <div className="flex items-center justify-between px-2 pb-1 pt-2">
      <Text id={id} as="h2" size="xs" tone="subtle" weight="medium">
        {title}
      </Text>
      {/* {count > 0 && (
        <Text
          as="span"
          size="xxs"
          tone="faint"
          className="min-w-4 rounded-full bg-primary-100 px-1.5 py-0.5 text-center tabular-nums dark:bg-primary-900"
        >
          {count}
        </Text>
      )} */}
    </div>
  );
}

function resourceIcon(
  resource: SessionResource,
  imageUrl?: string,
): ReactNode {
  switch (resource.kind) {
    case "file":
    case "document":
      return <FileIconComponent fileName={resource.title} className="size-4" />;
    case "folder":
      return (
        <FileIconComponent
          fileName={resource.title}
          isDirectory
          className="size-4"
        />
      );
    case "image":
      if (imageUrl) {
        return (
          <img
            src={imageUrl}
            alt=""
            className="size-4 rounded-[0.2rem] object-cover ring-1 ring-primary-200/70 dark:ring-primary-800/70"
          />
        );
      }
      return <Picture className="size-4" />;
    case "url":
      return (
        <BrowserFavicon
          faviconUrl={faviconUrlForHref(resource.target?.value)}
          className="size-4"
        />
      );
    case "search":
      return <Web className="size-4" />;
    case "issue":
      return <Link className="size-4" />;
    case "signal":
      return <Bug className="size-4" />;
    case "selection":
      return <Read className="size-4" />;
    case "visualization":
      return <Chart className="size-4" />;
    case "note":
      return <Note className="size-4" />;
  }
}

function SessionSourceImage({
  resource,
  onPreview,
}: {
  resource: SessionResource;
  onPreview: (preview: { name: string; src: string }) => void;
}) {
  const source =
    resource.target?.type === "image" ? resource.target.value : undefined;
  const imageUrl = useLocalImageUrl(source);

  return (
    <Button
      onClick={() =>
        imageUrl && onPreview({ name: resource.title, src: imageUrl })
      }
      disabled={!imageUrl}
      title={resource.title}
      aria-label={`Preview ${resource.title}`}
      className="group relative h-16 w-20 shrink-0 overflow-hidden rounded-xl  bg-primary-50 transition-colors  disabled:opacity-100 dark:bg-primary-900/60 "
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          className="size-full object-cover transition-transform duration-200 "
        />
      ) : (
        <span className="flex size-full items-center justify-center text-primary-400 dark:text-primary-600">
          <Picture className="size-5" />
        </span>
      )}
      <span className="sr-only">{resource.title}</span>
    </Button>
  );
}

function ResourceSubsectionHeading({
  id,
  title,
  count,
}: {
  id: string;
  title: string;
  count: number;
}) {
  return (
    <div className="flex items-center justify-between pb-1.5">
      <Text id={id} as="h3" size="xxs" tone="faint" weight="medium">
        {title}
      </Text>
      <Text as="span" size="xxs" tone="faint" className="tabular-nums">
        {count}
      </Text>
    </div>
  );
}

function SessionSourceImages({
  resources,
  onPreview,
}: {
  resources: SessionResource[];
  onPreview: (preview: { name: string; src: string }) => void;
}) {
  if (resources.length === 0) return null;

  return (
    <section
      className="px-2 pb-1 pt-2"
      aria-labelledby="session-source-images-heading"
    >
      <ResourceSubsectionHeading
        id="session-source-images-heading"
        title="Images"
        count={resources.length}
      />
      <div className="flex gap-2 overflow-x-auto pb-1 noscrollbar">
        {resources.map((resource) => (
          <SessionSourceImage
            key={resource.id}
            resource={resource}
            onPreview={onPreview}
          />
        ))}
      </div>
    </section>
  );
}

function SessionPluginIcon({ plugin }: { plugin: SessionPlugin }) {
  const [failed, setFailed] = useState(false);
  const iconUrl = useLocalImageUrl(plugin.iconSource);

  if (iconUrl && !failed) {
    return (
      <img
        src={iconUrl}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        className="size-6 shrink-0 object-contain rounded-md"
      />
    );
  }

  return (
    <Plugin
      aria-hidden="true"
      className="size-6 shrink-0 text-primary-500 dark:text-primary-400"
    />
  );
}

function SessionPlugins({ plugins }: { plugins: SessionPlugin[] }) {
  if (plugins.length === 0) return null;

  return (
    <section
      className="px-2 pb-1 pt-2"
      aria-labelledby="session-plugins-heading"
    >
      <ResourceSubsectionHeading
        id="session-plugins-heading"
        title="Plugins"
        count={plugins.length}
      />
      <ul className="flex w-full gap-3 overflow-x-auto pb-1 noscrollbar">
        {plugins.map((plugin) => (
          <li key={plugin.id} className="shrink-0" title={plugin.title}>
            <span role="img" aria-label={plugin.title} className="block">
              <SessionPluginIcon plugin={plugin} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function resourceTitle(resource: SessionResource): string {
  const target =
    resource.target?.type === "image" ? undefined : resource.target?.value;
  return Array.from(new Set([resource.detail, target].filter(Boolean))).join(
    "\n",
  );
}

function SessionResourceRow({
  resource,
  onPreview,
}: {
  resource: SessionResource;
  onPreview: (preview: { name: string; src: string }) => void;
}) {
  const openFile = useOpenFileInEditor();
  const openLink = useOpenLink();
  const imageSource =
    resource.target?.type === "image" ? resource.target.value : undefined;
  const imageUrl = useLocalImageUrl(imageSource);

  const onClick = (() => {
    const target = resource.target;
    if (!target) return undefined;
    if (target.type === "url") {
      return () => void openLink(target.value);
    }
    if (target.type === "file") {
      return () => void openFile(target.value);
    }
    if (imageUrl) {
      return () => onPreview({ name: resource.title, src: imageUrl });
    }
    return undefined;
  })();

  return (
    <PanelItem
      icon={resourceIcon(resource, imageUrl)}
      label={resource.title}
      trailing={resource.badge}
      onClick={onClick}
      title={resourceTitle(resource)}
    />
  );
}

function ResourceList({
  resources,
  expanded,
  onExpandedChange,
  onPreview,
}: {
  resources: SessionResource[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onPreview: (preview: { name: string; src: string }) => void;
}) {
  const visible = expanded
    ? resources
    : resources.slice(0, COLLAPSED_ITEM_COUNT);

  return (
    <>
      {visible.map((resource) => (
        <SessionResourceRow
          key={resource.id}
          resource={resource}
          onPreview={onPreview}
        />
      ))}
      {resources.length > COLLAPSED_ITEM_COUNT && (
        <PanelItem
          icon={<Link className="size-4" />}
          label={expanded ? "Show less" : "View all"}
          onClick={() => onExpandedChange(!expanded)}
          expandable
          expanded={expanded}
        />
      )}
    </>
  );
}

/** Sources and outputs belonging to the active run, projected from persisted data. */
export function SessionResourcesSection({
  runId,
  showDeliverables,
  hideWhenEmpty = false,
  separated = false,
}: {
  runId: string;
  showDeliverables: boolean;
  /** Code already has Environment, so an empty resource shelf adds no value. */
  hideWhenEmpty?: boolean;
  /** Draw the divider only when this component actually renders. */
  separated?: boolean;
}) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [deliverablesExpanded, setDeliverablesExpanded] = useState(false);
  const [preview, setPreview] = useState<{ name: string; src: string } | null>(
    null,
  );
  const {
    data: contextRows,
    isLoading: contextLoading,
    refetch: refetchContext,
  } = useGetRunContextQuery(runId, { refetchOnMountOrArgChange: true });
  const {
    data: artifactRows,
    isLoading: artifactsLoading,
    refetch: refetchArtifacts,
  } = useGetRunArtifactsQuery(runId, { refetchOnMountOrArgChange: true });
  const {
    data: toolCallRows,
    isLoading: toolCallsLoading,
    refetch: refetchToolCalls,
  } = useGetToolCallsByRunQuery(runId, { refetchOnMountOrArgChange: true });
  const {
    data: outputFileRows,
    isLoading: outputFilesLoading,
    refetch: refetchOutputFiles,
  } = useListRunOutputFilesQuery(runId, {
    skip: !showDeliverables,
    refetchOnMountOrArgChange: true,
  });

  // New tool calls and artifacts land while a run is live. The same coalesced
  // persisted-event signal as the transcript/subagent views keeps this shelf
  // current without polling while the panel is closed.
  useRunEventRefetch(runId, () => {
    void refetchContext();
    void refetchArtifacts();
    void refetchToolCalls();
    if (showDeliverables) void refetchOutputFiles();
  });

  const resources = useMemo(
    () =>
      buildSessionResources({
        context: contextRows ?? EMPTY_CONTEXT,
        artifacts: artifactRows ?? EMPTY_ARTIFACTS,
        toolCalls: toolCallRows ?? EMPTY_TOOL_CALLS,
        outputFiles: outputFileRows ?? EMPTY_OUTPUT_FILES,
      }),
    [contextRows, artifactRows, toolCallRows, outputFileRows],
  );
  const loading =
    contextLoading ||
    artifactsLoading ||
    toolCallsLoading ||
    (showDeliverables && outputFilesLoading);
  const sourceImages = resources.sources.filter(
    (resource) => resource.target?.type === "image",
  );
  const sourceRows = resources.sources.filter(
    (resource) => resource.target?.type !== "image",
  );
  const visibleResourceCount =
    resources.sources.length +
    resources.plugins.length +
    (showDeliverables ? resources.deliverables.length : 0);
  const sourceCount = resources.sources.length + resources.plugins.length;

  if (hideWhenEmpty && visibleResourceCount === 0) return null;

  return (
    <div
      className={
        separated
          ? "mt-1 border-t border-primary-200/70 pt-1 dark:border-primary-800/70"
          : ""
      }
    >
      <section aria-labelledby="session-sources-heading">
        <SectionHeading
          id="session-sources-heading"
          title="Sources"
        />
        {loading && sourceCount === 0 ? (
          <Text as="div" size="xs" tone="faint" className="px-2 py-3">
            Loading sources…
          </Text>
        ) : sourceCount === 0 ? (
          <Text as="div" size="xs" tone="faint" className="px-2 py-3 leading-relaxed">
            Files, links, and references used in this chat appear here.
          </Text>
        ) : (
          <>
            {sourceRows.length > 0 && (
              <ResourceList
                resources={sourceRows}
                expanded={sourcesExpanded}
                onExpandedChange={setSourcesExpanded}
                onPreview={setPreview}
              />
            )}
            <SessionPlugins plugins={resources.plugins} />
            <SessionSourceImages
              resources={sourceImages}
              onPreview={setPreview}
            />
          </>
        )}
      </section>

      {showDeliverables && resources.deliverables.length > 0 && (
        <section
          className="mt-1 border-t border-primary-200/70 pt-1 dark:border-primary-800/70"
          aria-labelledby="session-deliverables-heading"
        >
          <SectionHeading
            id="session-deliverables-heading"
            title="Deliverables"
          />
          <ResourceList
            resources={resources.deliverables}
            expanded={deliverablesExpanded}
            onExpandedChange={setDeliverablesExpanded}
            onPreview={setPreview}
          />
        </section>
      )}

      {preview && (
        <ImagePreviewModal
          name={preview.name}
          src={preview.src}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
