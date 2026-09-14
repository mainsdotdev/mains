import { ReactNode, RefObject, useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Button, DropdownWrapper, Text } from "@/components/ui";
import { useClickOutside } from "@/hooks/use-click-outside";
import type { CommandInfo, SkillInfo } from "@/lib/redux/api/providersApi";
import { Sparkles } from "@/components/ui/icons";
import { useDropdownKeyboardNavigation } from "@/features/workspace/hooks/use-dropdown-keyboard-navigation";
import { FileIconComponent } from "@/components/ui/icons";
import type { DirEntry, FileNode } from "@/features/workspace/types/file-explorer";
import type { IssueWithEntity } from "@/lib/redux/api/entitiesApi";
import { useListProjectIssuesQuery } from "@/lib/redux/api";
import { ProviderIcon } from "./provider-icon";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";

/**
 * "@" and "/" open the full combined menu (skills, files, issues, commands);
 * "$" narrows to skills only and "#" to issues only.
 */
export type UnifiedContextTrigger = "@" | "/" | "$" | "#";

/**
 * Optional narrowing on top of the trigger: the toolbar's plugins picker opens
 * the "$" menu restricted to the plugins bucket, with no token in the text.
 */
export type UnifiedContextBucket = "plugins";

interface FetchState {
  entries: DirEntry[];
  loading: boolean;
  error: string | null;
}

type FetchAction =
  | { type: "fetch_start" }
  | { type: "fetch_success"; entries: DirEntry[] }
  | { type: "fetch_error"; error: string };

function fetchReducer(state: FetchState, action: FetchAction): FetchState {
  switch (action.type) {
    case "fetch_start":
      return { entries: [], loading: true, error: null };
    case "fetch_success":
      return { entries: action.entries, loading: false, error: null };
    case "fetch_error":
      return { entries: [], loading: false, error: action.error };
  }
}

function parseFileFilterText(filterText: string): { dirPath: string; nameFilter: string } {
  const lastSlash = filterText.lastIndexOf("/");
  if (lastSlash === -1) {
    return { dirPath: "", nameFilter: filterText };
  }
  return {
    dirPath: filterText.slice(0, lastSlash + 1),
    nameFilter: filterText.slice(lastSlash + 1),
  };
}

/** Lowercase relative path from workspace root, using / */
function workspaceRelativePath(fullPath: string, workspacePath: string): string {
  const root = workspacePath.replace(/\/$/, "");
  if (!fullPath.startsWith(root)) return fullPath;
  return fullPath.slice(root.length).replace(/^\//, "");
}

function workspaceRelativeDir(fullPath: string, workspacePath?: string): string {
  if (!workspacePath) return "";
  const root = workspacePath.replace(/\/$/, "");
  if (!fullPath.startsWith(root)) return "";
  const rel = fullPath.slice(root.length).replace(/^\//, "");
  return rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
}

function abbreviateHome(path: string): string {
  return path.replace(/^\/Users\/[^/]+\//, "~/");
}

function formatFileLocation(fullPath: string, workspacePath?: string): string | null {
  const rel = workspaceRelativeDir(fullPath, workspacePath);
  if (rel) return rel;
  if (workspacePath && fullPath.startsWith(workspacePath.replace(/\/$/, ""))) {
    return null;
  }
  const dir = fullPath.includes("/") ? fullPath.slice(0, fullPath.lastIndexOf("/")) : fullPath;
  return abbreviateHome(dir);
}

const WORKSPACE_SEARCH_DEBOUNCE_MS = 320;
const MAX_WORKSPACE_FILE_MATCHES = 150;

function bucketSkill(skill: SkillInfo): "plugins" | "mac_apps" | "skills" | null {
  if (skill.userInvokable === false) return null;
  const sc = (skill.scope || "").toLowerCase();
  if (sc === "plugin") return "plugins";
  if (sc === "mac" || sc === "mac_app" || sc === "computer") return "mac_apps";
  return "skills";
}

function getScopeLabel(scope?: string): string {
  switch (scope) {
    case "user":
      return "User";
    case "project":
    case "repo":
      return "Project";
    case "system":
      return "System";
    case "plugin":
      return "Plugin";
    default:
      return "";
  }
}

function SkillRowIcon({ skill }: { skill: SkillInfo }) {
  const [failed, setFailed] = useState(false);
  const iconPath = skill.iconLarge || skill.iconSmall;
  const resolved = useLocalImageUrl(iconPath);
  if (iconPath && resolved && !failed) {
    return (
      <img
        src={resolved}
        alt=""
        className="size-5 rounded shrink-0 object-contain"
        style={skill.brandColor ? { backgroundColor: skill.brandColor } : undefined}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className="size-5 rounded shrink-0 flex items-center justify-center bg-primary-200/50 dark:bg-primary-700/50 text-primary-600 dark:text-primary-400"
      style={skill.brandColor ? { backgroundColor: skill.brandColor, color: "#fff" } : undefined}
    >
      <Sparkles className="size-3" />
    </div>
  );
}

function RowButton({
  active,
  onHover,
  onSelect,
  className = "",
  children,
}: {
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      role="menuitem"
      data-dropdown-active={active ? "true" : undefined}
      onMouseEnter={onHover}
      onClick={onSelect}
      className={`w-full text-left px-3 py-1.5 cursor-pointer transition-colors hover:bg-primary-200/30 dark:hover:bg-primary-800 text-primary-700 dark:text-primary-300 ${
        active ? "bg-primary-200/30 dark:bg-primary-800" : ""
      } ${className}`}
    >
      {children}
    </Button>
  );
}

type FlatRow =
  | { kind: "skill"; skill: SkillInfo; bucket: "plugins" | "mac_apps" | "skills" }
  | { kind: "file"; entry: DirEntry; dirPath: string }
  | { kind: "issue"; item: IssueWithEntity }
  | { kind: "command"; command: CommandInfo };

interface UnifiedContextDropdownProps {
  isOpen: boolean;
  trigger: UnifiedContextTrigger;
  /** Restrict the menu to one skill bucket (toolbar-opened pickers). */
  bucket?: UnifiedContextBucket | null;
  filterText: string;
  workspacePath?: string;
  projectId?: string;
  commands: CommandInfo[];
  skills: SkillInfo[];
  isLoadingSkills?: boolean;
  onSelectCommand: (command: CommandInfo) => void;
  onSelectSkill: (skill: SkillInfo) => void;
  onSelectFile: (node: FileNode) => void;
  onNavigateFile: (dirPath: string) => void;
  onSelectIssue: (issue: IssueWithEntity) => void;
  onClose: () => void;
  dropdownRef: RefObject<HTMLDivElement | null>;
  /** A toolbar trigger that opened this menu — clicks on it are not "outside". */
  triggerRef?: RefObject<HTMLElement | null>;
}

function buildSections(
  pluginSkills: SkillInfo[],
  macSkills: SkillInfo[],
  regularSkills: SkillInfo[],
  sortedFiles: DirEntry[],
  fileDirPath: string,
  includeFilesSection: boolean,
  filteredIssues: IssueWithEntity[],
  filteredCommands: CommandInfo[],
): { title: string; rows: FlatRow[] }[] {
  const out: { title: string; rows: FlatRow[] }[] = [];
  if (pluginSkills.length > 0) {
    out.push({
      title: "Plugins",
      rows: pluginSkills.map((skill) => ({ kind: "skill" as const, skill, bucket: "plugins" as const })),
    });
  }
  if (macSkills.length > 0) {
    out.push({
      title: "Mac apps",
      rows: macSkills.map((skill) => ({ kind: "skill" as const, skill, bucket: "mac_apps" as const })),
    });
  }
  if (regularSkills.length > 0) {
    out.push({
      title: "Skills",
      rows: regularSkills.map((skill) => ({ kind: "skill" as const, skill, bucket: "skills" as const })),
    });
  }
  if (includeFilesSection) {
    out.push({
      title: "Files",
      rows: sortedFiles.map((entry) => ({ kind: "file" as const, entry, dirPath: fileDirPath })),
    });
  }
  if (filteredIssues.length > 0) {
    out.push({
      title: "Issues",
      rows: filteredIssues.map((item) => ({ kind: "issue" as const, item })),
    });
  }
  if (filteredCommands.length > 0) {
    out.push({
      title: "Commands",
      rows: filteredCommands.map((command) => ({ kind: "command" as const, command })),
    });
  }
  return out;
}

/** Heading over one group of rows in the dropdown. */
function SectionHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Text
      as="div"
      size="xs"
      tone="subtle"
      weight="medium"
      className={`px-3 pt-2 pb-1 ${className ?? ""}`}
    >
      {children}
    </Text>
  );
}

export function UnifiedContextDropdown({
  isOpen,
  trigger,
  bucket = null,
  filterText,
  workspacePath,
  projectId,
  commands,
  skills,
  isLoadingSkills = false,
  onSelectCommand,
  onSelectSkill,
  onSelectFile,
  onNavigateFile,
  onSelectIssue,
  onClose,
  dropdownRef,
  triggerRef,
}: UnifiedContextDropdownProps) {
  const pluginsOnly = bucket === "plugins";
  const isCombined = !pluginsOnly && (trigger === "@" || trigger === "/");
  const wantsSkills = isCombined || trigger === "$" || pluginsOnly;
  const wantsFiles = isCombined && Boolean(workspacePath);
  const wantsIssues = isCombined || (!pluginsOnly && trigger === "#");
  const wantsCommands = isCombined;

  const [fetchState, dispatchFetch] = useReducer(fetchReducer, {
    entries: [],
    loading: false,
    error: null,
  });

  useClickOutside(
    dropdownRef,
    () => {
      if (isOpen) onClose();
    },
    triggerRef,
  );

  const { dirPath, nameFilter } = useMemo(() => parseFileFilterText(filterText), [filterText]);

  const isWorkspaceFileSearch = dirPath === "" && nameFilter.length > 0;

  useEffect(() => {
    if (!isOpen || !workspacePath || !wantsFiles) return;

    if (!isWorkspaceFileSearch) {
      let cancelled = false;
      dispatchFetch({ type: "fetch_start" });

      const fullDirPath = dirPath
        ? `${workspacePath}/${dirPath.replace(/\/$/, "")}`
        : workspacePath;

      window.api.fileExplorer
        .listDir({ dirPath: fullDirPath })
        .then((response: { success: boolean; data?: DirEntry[]; error?: string }) => {
          if (cancelled) return;
          if (response.success && response.data) {
            dispatchFetch({ type: "fetch_success", entries: response.data });
          } else {
            dispatchFetch({ type: "fetch_error", error: response.error || "Failed to list directory" });
          }
        })
        .catch((err: Error) => {
          if (!cancelled) {
            dispatchFetch({ type: "fetch_error", error: err.message });
          }
        });

      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    dispatchFetch({ type: "fetch_start" });

    const timeoutId = window.setTimeout(() => {
      window.api.fileExplorer
        .searchFiles({
          rootPath: workspacePath,
          query: nameFilter,
          max: MAX_WORKSPACE_FILE_MATCHES,
        })
        .then((response: { success: boolean; data?: DirEntry[]; error?: string }) => {
          if (cancelled) return;
          if (response.success && response.data) {
            dispatchFetch({ type: "fetch_success", entries: response.data });
          } else {
            dispatchFetch({ type: "fetch_error", error: response.error || "Failed to search workspace" });
          }
        })
        .catch((err: Error) => {
          if (!cancelled) {
            dispatchFetch({ type: "fetch_error", error: err.message });
          }
        });
    }, WORKSPACE_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [isOpen, workspacePath, dirPath, nameFilter, isWorkspaceFileSearch, wantsFiles]);

  const { data: issues = [], isLoading: isLoadingIssues } = useListProjectIssuesQuery(projectId ?? "", {
    skip: !isOpen || !projectId || !wantsIssues,
  });

  const filteredIssues = useMemo(() => {
    if (!filterText) return issues;
    const lower = filterText.toLowerCase();
    return issues.filter((item) => {
      const num = item.issue.number != null ? String(item.issue.number) : "";
      return item.entity.title.toLowerCase().includes(lower) || num.includes(lower);
    });
  }, [issues, filterText]);

  const filteredCommands = useMemo(() => {
    const userFacing = commands.filter((cmd) => cmd.userFacing !== false);
    if (!filterText) return userFacing;
    const lower = filterText.toLowerCase();
    return userFacing.filter((cmd) => {
      const nameMatch = cmd.name.toLowerCase().includes(lower);
      const descMatch = cmd.description?.toLowerCase().includes(lower);
      return nameMatch || descMatch;
    });
  }, [commands, filterText]);

  const { pluginSkills, macSkills, regularSkills } = useMemo(() => {
    const plugins: SkillInfo[] = [];
    const mac: SkillInfo[] = [];
    const rest: SkillInfo[] = [];
    for (const s of skills) {
      const b = bucketSkill(s);
      if (b === "plugins") plugins.push(s);
      else if (b === "mac_apps") mac.push(s);
      else if (b === "skills") rest.push(s);
    }
    const lower = filterText.toLowerCase();
    const filterSkill = (list: SkillInfo[]) => {
      if (!filterText) return list;
      return list.filter((s) => {
        const nameMatch = s.name.toLowerCase().includes(lower);
        const displayMatch = s.displayName?.toLowerCase().includes(lower);
        const descMatch =
          s.shortDescription?.toLowerCase().includes(lower) || s.description?.toLowerCase().includes(lower);
        return nameMatch || displayMatch || descMatch;
      });
    };
    return {
      pluginSkills: filterSkill(plugins),
      macSkills: filterSkill(mac),
      regularSkills: filterSkill(rest),
    };
  }, [skills, filterText]);

  const filteredFileEntries = useMemo(() => {
    if (isWorkspaceFileSearch) return fetchState.entries;
    if (!nameFilter) return fetchState.entries;
    const lower = nameFilter.toLowerCase();
    return fetchState.entries.filter((e) => e.name.toLowerCase().includes(lower));
  }, [fetchState.entries, nameFilter, isWorkspaceFileSearch]);

  const sortedFiles = useMemo(() => {
    if (isWorkspaceFileSearch) {
      return [...filteredFileEntries].sort((a, b) =>
        workspaceRelativePath(a.fullPath, workspacePath ?? "").localeCompare(
          workspaceRelativePath(b.fullPath, workspacePath ?? ""),
        ),
      );
    }
    return [...filteredFileEntries].sort((a, b) => {
      if (a.type === "directory" && b.type !== "directory") return -1;
      if (a.type !== "directory" && b.type === "directory") return 1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredFileEntries, isWorkspaceFileSearch, workspacePath]);

  const sections = useMemo(() => {
    return buildSections(
      wantsSkills ? pluginSkills : [],
      wantsSkills && !pluginsOnly ? macSkills : [],
      wantsSkills && !pluginsOnly ? regularSkills : [],
      wantsFiles ? sortedFiles : [],
      dirPath,
      wantsFiles,
      wantsIssues ? filteredIssues : [],
      wantsCommands ? filteredCommands : [],
    );
  }, [
    wantsSkills,
    pluginsOnly,
    pluginSkills,
    macSkills,
    regularSkills,
    wantsFiles,
    sortedFiles,
    dirPath,
    wantsIssues,
    filteredIssues,
    wantsCommands,
    filteredCommands,
  ]);

  const flatRows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  const sectionBaseIndex = useMemo(() => {
    const bases: number[] = [];
    let acc = 0;
    for (let i = 0; i < sections.length; i++) {
      bases[i] = acc;
      acc += sections[i].rows.length;
    }
    return bases;
  }, [sections]);

  const selectRowAt = useCallback(
    (index: number) => {
      const row = flatRows[index];
      if (!row) return;
      switch (row.kind) {
        case "command":
          onSelectCommand(row.command);
          onClose();
          break;
        case "skill":
          onSelectSkill(row.skill);
          onClose();
          break;
        case "issue":
          onSelectIssue(row.item);
          onClose();
          break;
        case "file": {
          const { entry, dirPath: d } = row;
          if (entry.type === "directory") {
            onNavigateFile(d + entry.name + "/");
            return;
          }
          onSelectFile({
            name: entry.name,
            fullPath: entry.fullPath,
            type: entry.type,
            extension: entry.extension,
            size: entry.size,
          });
          onClose();
          break;
        }
      }
    },
    [flatRows, onClose, onNavigateFile, onSelectCommand, onSelectFile, onSelectIssue, onSelectSkill],
  );

  const { activeIndex, setActiveIndex } = useDropdownKeyboardNavigation({
    isOpen,
    itemCount: flatRows.length,
    disabled: flatRows.length === 0,
    resetKey: filterText,
    onSelectActive: selectRowAt,
  });

  if (!isOpen) return null;

  const isLoading =
    flatRows.length === 0 &&
    (trigger === "$" || pluginsOnly
      ? isLoadingSkills
      : trigger === "#"
        ? Boolean(projectId) && isLoadingIssues
        : fetchState.loading || (Boolean(projectId) && isLoadingIssues));

  const emptyText = pluginsOnly
    ? "No plugins installed"
    : trigger === "$"
      ? "No skills available"
      : trigger === "#"
        ? projectId
          ? "No matching issues"
          : "No project linked"
        : "No matches";

  return (
    <div ref={dropdownRef}>
      <DropdownWrapper
        isOpen={isOpen}
        aria-label="Context suggestions"
        openUpward={true}
        minWidth="min-w-[22rem]"
      >
        <div className="max-h-96 max-w-115 overflow-auto noscrollbar">
          {wantsFiles && dirPath && (
            <SectionHeading className="truncate">
              {dirPath}
            </SectionHeading>
          )}
          {isLoading ? (
            <Text as="div" tone="subtle" className="px-4 py-3">
              Loading...
            </Text>
          ) : flatRows.length === 0 &&
            !fetchState.loading &&
            !isLoadingIssues &&
            (wantsFiles ? !fetchState.error : true) ? (
            <Text as="div" tone="subtle" className="px-4 py-3">
              {emptyText}
            </Text>
          ) : (
            sections.map((section, sectionIndex) => {
              if (section.rows.length === 0 && section.title !== "Files") return null;
              if (section.title === "Files" && section.rows.length === 0 && !fetchState.loading && !fetchState.error) {
                return null;
              }
              const baseIdx = sectionBaseIndex[sectionIndex];
              return (
                <div key={`${section.title}-${sectionIndex}`}>
                  <SectionHeading>
                    {section.title}
                  </SectionHeading>
                  {section.title === "Files" && fetchState.loading && (
                    <Text as="div" size="xs" tone="subtle" className="px-4 py-2">
                      Loading files…
                    </Text>
                  )}
                  {section.title === "Files" && fetchState.error && (
                    <Text as="div" size="xs" tone="subtle" className="px-4 py-2">
                      {fetchState.error}
                    </Text>
                  )}
                  {section.title === "Files" &&
                    isWorkspaceFileSearch &&
                    sortedFiles.length >= MAX_WORKSPACE_FILE_MATCHES && (
                      <Text as="div" size="xxs" tone="subtle" className="px-3 pb-1">
                        Showing first {MAX_WORKSPACE_FILE_MATCHES} matches — narrow your search for more specific
                        results.
                      </Text>
                    )}
                  {section.rows.map((row, j) => {
                    const idx = baseIdx + j;
                    const active = idx === activeIndex;
                    const rowProps = {
                      active,
                      onHover: () => setActiveIndex(idx),
                      onSelect: () => selectRowAt(idx),
                    };
                    if (row.kind === "skill") {
                      const skill = row.skill;
                      const title = skill.displayName || skill.name;
                      const desc = skill.shortDescription || skill.description;
                      const scopeLabel = getScopeLabel(skill.scope || skill.source);
                      return (
                        <RowButton
                          key={`${row.bucket}-${skill.name}-${skill.path ?? ""}`}
                          {...rowProps}
                          className="text-xs"
                        >
                          <div className="flex items-start gap-2">
                            <SkillRowIcon skill={skill} />
                            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                              <Text as="div" size="inherit" tone="inherit" weight="medium" className="flex items-center gap-1.5">
                                <Text as="span" size="xs" className="truncate">
                                  {title}
                                </Text>
                                <div className="ml-auto gap-2 flex items-center shrink-0">
                                  {skill.argumentHint && (
                                    <Text as="span" size="xs" tone="subtle" weight="normal">
                                      {skill.argumentHint}
                                    </Text>
                                  )}
                                  {scopeLabel && (
                                    <Text
                                      as="span"
                                      size="t"
                                      tone="subtle"
                                      className="px-1.5 py-px rounded-full glass-outline bg-primary-200/50 dark:bg-primary-700/20"
                                    >
                                      {scopeLabel}
                                    </Text>
                                  )}
                                </div>
                              </Text>
                              {desc && (
                                <Text as="div" size="xs" tone="subtle" className="line-clamp-2">
                                  {desc}
                                </Text>
                              )}
                            </div>
                          </div>
                        </RowButton>
                      );
                    }
                    if (row.kind === "file") {
                      const { entry } = row;
                      return (
                        <RowButton key={entry.fullPath} {...rowProps}>
                          <div className="flex items-start gap-2 min-w-0">
                            <FileIconComponent
                              isDirectory={entry.type === "directory"}
                              extension={entry.extension}
                              fileName={entry.name}
                              className="size-4 shrink-0 mt-0.5"
                            />
                            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                              <Text as="span" size="xs" weight="medium" className="truncate">
                                {entry.name}
                              </Text>
                              {entry.type !== "directory" &&
                                (() => {
                                  const loc = formatFileLocation(entry.fullPath, workspacePath);
                                  return loc ? (
                                    <Text as="span" size="xs" tone="subtle" className="truncate">
                                      {loc}
                                    </Text>
                                  ) : null;
                                })()}
                            </div>
                            {entry.type === "directory" && (
                              <Text as="span" size="xs" tone="subtle" className="ml-auto shrink-0">
                                /
                              </Text>
                            )}
                          </div>
                        </RowButton>
                      );
                    }
                    if (row.kind === "issue") {
                      const item = row.item;
                      return (
                        <RowButton key={item.issue.entityId} {...rowProps}>
                          <div className="flex items-center gap-2 min-w-0">
                            <ProviderIcon
                              provider={item.issue.provider}
                              className="w-3.5 h-3.5 shrink-0"
                              fallback="text"
                            />
                            {item.issue.number != null && (
                              <Text as="span" size="xs" tone="subtle" className="shrink-0">
                                #{item.issue.number}
                              </Text>
                            )}
                            <Text as="span" size="xs" className="truncate">
                              {item.entity.title}
                            </Text>
                          </div>
                        </RowButton>
                      );
                    }
                    const cmd = row.command;
                    return (
                      <RowButton key={`cmd-${cmd.name}`} {...rowProps} className="text-xs">
                        <div className="flex flex-col gap-0.5">
                          <Text as="div" size="inherit" tone="inherit" weight="medium">/{cmd.name}</Text>
                          {cmd.description && (
                            <Text as="div" size="xs" tone="subtle" className="line-clamp-2">
                              {cmd.description}
                            </Text>
                          )}
                        </div>
                      </RowButton>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </DropdownWrapper>
    </div>
  );
}
