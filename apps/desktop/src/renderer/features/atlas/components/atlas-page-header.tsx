import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { AtlasItem, AtlasMetadataPatch } from "@mains/contracts/atlas";
import {
  ATLAS_COVER_GROUPS,
  ATLAS_COVER_PRESETS,
  ATLAS_COVER_SOURCE_PREFIX,
} from "@mains/contracts/atlas-covers";
import {
  Button,
  Input,
  Modal,
  ModalHeader,
  Muted,
  Slider,
  Text,
  toast,
} from "@/components/ui";
import { Picture, Plus } from "@/components/ui/icons";
import {
  IconPickerPanel,
  type IconPickerMode,
} from "@/components/layout/sidebar/icon-picker-panel";
import { useClickOutside } from "@/hooks/use-click-outside";
import { useAtlasFilePath } from "../hooks/use-atlas-file-path";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { cn } from "@/lib/cn";
import {
  DEFAULT_ICON_COLOR,
  formatIcon,
  splitStoredIcon,
} from "@/lib/icon-registry";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  useListAtlasQuery,
  useSetAtlasCoverPresetMutation,
  useUpdateAtlasItemMutation,
  useUploadAtlasFileMutation,
} from "@/lib/redux/api/atlasApi";
import { setAtlasCoverPosition } from "@/lib/redux/slices/atlasSlice";
import { useAtlasOwnerKey } from "../hooks/use-atlas-tabs";
import { atlasError } from "../hooks/use-save-to-atlas";
import { coverThumbnail, coverTitle } from "../lib/cover-thumbnails";
import { pageFileData } from "../lib/page-upload";
import { AtlasPageIcon } from "./atlas-page-icon";

function CoverChoice({
  item,
  disabled,
  onSelect,
}: {
  item: AtlasItem;
  disabled: boolean;
  onSelect: () => void;
}) {
  const path = useAtlasFilePath(item.accountId, item.id, item.path);
  const url = useLocalImageUrl(path, 768);
  return (
    <Button
      disabled={disabled}
      onClick={onSelect}
      title={item.title}
      aria-label={`Use ${item.title} as cover`}
      className="overflow-hidden rounded-xl border border-primary-200 dark:border-primary-800 focus-visible:ring-2"
    >
      <div className="aspect-[2/1] bg-primary-100 dark:bg-primary-900">
        {url && (
          <img
            src={url}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        )}
      </div>
    </Button>
  );
}

function CoverPresetChoice({
  id,
  description,
  disabled,
  onSelect,
}: {
  id: string;
  description: string;
  disabled: boolean;
  onSelect: () => void;
}) {
  const title = coverTitle(id);
  const url = coverThumbnail(id);
  return (
    <Button
      disabled={disabled}
      onClick={onSelect}
      title={`${title}: ${description}`}
      aria-label={`Use ${title} as cover`}
      className="overflow-hidden rounded-xl border border-primary-200 dark:border-primary-800 focus-visible:ring-2"
    >
      <div className="aspect-[2/1] bg-primary-100 dark:bg-primary-900">
        {url && (
          <img
            src={url}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        )}
      </div>
    </Button>
  );
}

/** Saved images shown before "Show more", and how many each click reveals. */
const IMAGES_PAGE_SIZE = 12;

function CoverSectionTitle({ id, children }: { id: string; children: string }) {
  return (
    <Text
      as="h3"
      id={id}
      variant="muted"
      tone="faint"
      size="xs"
      weight="medium"
      className="mb-2"
    >
      {children}
    </Text>
  );
}

export function AtlasPageHeader({
  item,
  children,
}: {
  item: AtlasItem;
  children?: ReactNode;
}) {
  const { accountId, id, metadata } = item;
  const dispatch = useAppDispatch();
  const ownerKey = useAtlasOwnerKey(accountId);
  const storedPosition = useAppSelector(
    (state) => state.atlas.coverPositions[ownerKey]?.[id],
  );
  const images = useListAtlasQuery({ accountId });
  const [update, updating] = useUpdateAtlasItemMutation();
  const [upload, uploading] = useUploadAtlasFileMutation();
  const [setPreset, settingPreset] = useSetAtlasCoverPresetMutation();
  const [readingFile, setReadingFile] = useState(false);
  const disabled =
    !!item.trashedAt ||
    readingFile ||
    updating.isLoading ||
    uploading.isLoading ||
    settingPreset.isLoading;
  const coverId = metadata?.coverFileId;
  const cover = images.data?.find((image) => image.id === coverId);
  const coverPath = useAtlasFilePath(cover?.accountId, cover?.id, cover?.path);
  const coverUrl = useLocalImageUrl(coverPath, 2048);
  const position =
    coverId && storedPosition?.coverFileId === coverId
      ? storedPosition.coverPositionY
      : 50;
  const [draftPosition, setDraftPosition] = useState<{
    coverFileId: string;
    coverPositionY: number;
  } | null>(null);
  const repositioning = !!coverId && draftPosition?.coverFileId === coverId;
  const positionY = repositioning ? draftPosition.coverPositionY : position;
  const imageRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ y: number; position: number; overflow: number } | null>(
    null,
  );
  const [choosingCover, setChoosingCover] = useState(false);
  const [visibleImages, setVisibleImages] = useState(IMAGES_PAGE_SIZE);
  // Bundled gallery covers are saved to Atlas as images but are not the user's own files.
  const savedImages = (images.data ?? []).filter(
    (image) =>
      image.kind === "image" &&
      !image.trashedAt &&
      image.path &&
      !image.sourceKey?.startsWith(ATLAS_COVER_SOURCE_PREFIX),
  );
  const uploadRef = useRef<HTMLInputElement>(null);
  const iconParts = splitStoredIcon(metadata?.icon);
  const [iconOpen, setIconOpen] = useState(false);
  const [iconMode, setIconMode] = useState<IconPickerMode>(iconParts.mode);
  const [iconColor, setIconColor] = useState(iconParts.color);
  const iconRef = useRef<HTMLDivElement>(null);
  useClickOutside(iconRef, () => setIconOpen(false));

  const saveMetadata = async (patch: AtlasMetadataPatch) => {
    await update({ accountId, id, metadata: patch }).unwrap();
  };
  const selectIcon = (icon: string | null) => {
    if (disabled) return;
    void saveMetadata({ icon })
      .then(() => setIconOpen(false))
      .catch((error: unknown) => toast.error(atlasError(error)));
  };
  const selectCover = async (coverFileId: string) => {
    await saveMetadata({ coverFileId });
    finishCover(coverFileId);
  };
  const selectPreset = async (preset: string) => {
    const saved = await setPreset({ accountId, id, preset }).unwrap();
    if (saved.metadata?.coverFileId) finishCover(saved.metadata.coverFileId);
  };
  const finishCover = (coverFileId: string) => {
    // A new cover starts centered; framing is stored only on this device.
    if (coverFileId !== coverId)
      dispatch(
        setAtlasCoverPosition({
          ownerKey,
          id,
          coverFileId,
          coverPositionY: 50,
        }),
      );
    setDraftPosition(null);
    closeCoverPicker();
  };
  const closeCoverPicker = () => {
    setChoosingCover(false);
    setVisibleImages(IMAGES_PAGE_SIZE);
  };
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    const image = imageRef.current;
    if (!repositioning || !image?.naturalWidth || event.button !== 0) return;
    const { width, height } = event.currentTarget.getBoundingClientRect();
    const overflow =
      Math.max(height, (width * image.naturalHeight) / image.naturalWidth) -
      height;
    if (overflow <= 0) return;
    event.preventDefault();
    drag.current = { y: event.clientY, position: positionY, overflow };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !coverId || !repositioning) return;
    const next =
      drag.current.position -
      ((event.clientY - drag.current.y) * 100) / drag.current.overflow;
    setDraftPosition({
      coverFileId: coverId,
      coverPositionY: Math.max(0, Math.min(100, next)),
    });
  };

  const iconPicker = iconOpen && (
    <div
      role="dialog"
      aria-label="Page icon"
      aria-busy={updating.isLoading}
      className={disabled ? "pointer-events-none opacity-70" : undefined}
    >
      <IconPickerPanel
        icon={iconParts.value}
        iconMode={iconMode}
        isOpen
        iconColor={iconColor}
        onSwitchMode={setIconMode}
        onSelectEmoji={(emoji) => selectIcon(formatIcon("emoji", emoji))}
        onSelectIcon={(icon) => selectIcon(formatIcon("icon", icon, iconColor))}
        onSelectColor={(color) => {
          setIconColor(color);
          if (iconParts.mode === "icon" && iconParts.value)
            selectIcon(formatIcon("icon", iconParts.value, color));
        }}
        onClear={() => selectIcon(null)}
        className="absolute left-0 top-full mt-2 w-72 rounded-xl"
      />
    </div>
  );

  return (
    <>
      {coverId && (
        <div
          className="group/cover relative"
          onKeyDown={(event) => {
            if (repositioning && event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              drag.current = null;
              setDraftPosition(null);
            }
          }}
        >
          <div
            className={cn(
              "h-52 w-full overflow-hidden bg-primary-100 dark:bg-primary-900 md:h-64",
              repositioning && "touch-none cursor-grab active:cursor-grabbing",
            )}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          >
            {coverUrl ? (
              <img
                ref={imageRef}
                src={coverUrl}
                alt="Page cover"
                decoding="async"
                draggable={false}
                className="size-full select-none object-cover"
                style={{ objectPosition: `50% ${positionY}%` }}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Muted>
                  {images.error
                    ? "Could not load cover"
                    : images.isLoading
                      ? "Loading cover…"
                      : "Cover image unavailable"}
                </Muted>
              </div>
            )}
          </div>
          {!item.trashedAt && (
            <div
              className={cn(
                "absolute right-4 top-4 flex items-center gap-1 rounded-2xl glass-surface p-0.5 opacity-0 pointer-events-none transition-opacity duration-150 group-hover/cover:opacity-100 group-hover/cover:pointer-events-auto group-focus-within/cover:opacity-100 group-focus-within/cover:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto md:right-6",
                repositioning && "opacity-100 pointer-events-auto",
              )}
            >
              {repositioning ? (
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    dispatch(
                      setAtlasCoverPosition({
                        ownerKey,
                        id,
                        coverFileId: coverId,
                        coverPositionY: positionY,
                      }),
                    );
                    drag.current = null;
                    setDraftPosition(null);
                  }}
                >
                  Save
                </Button>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => setChoosingCover(true)}
                  >
                    Change cover
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={disabled || !coverUrl}
                    onClick={() =>
                      setDraftPosition({
                        coverFileId: coverId,
                        coverPositionY: position,
                      })
                    }
                  >
                    Reposition
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => {
                      void saveMetadata({ coverFileId: null }).catch(
                        (error: unknown) => toast.error(atlasError(error)),
                      );
                    }}
                  >
                    Remove
                  </Button>
                </>
              )}
            </div>
          )}
          {repositioning && (
            <>
              <div className="absolute bottom-4 right-4 top-16 rounded-xl glass-surface p-0.5 md:right-6">
                <Slider
                  aria-label="Cover vertical position"
                  orientation="vertical"
                  className="h-full"
                  autoFocus
                  value={positionY}
                  onChange={(coverPositionY) =>
                    setDraftPosition({ coverFileId: coverId, coverPositionY })
                  }
                  showValue={false}
                  disabled={disabled}
                />
              </div>
              <Muted className="pointer-events-none absolute left-4 top-4 max-w-[calc(100%-7rem)] rounded-xl glass-surface px-3 py-1.5 text-xs md:left-6">
                Drag to reposition · Esc to cancel
              </Muted>
            </>
          )}
        </div>
      )}
      <div className="px-8 md:px-16">
        <div
          className={cn(
            "group/page-heading relative mx-auto max-w-3xl",
            coverId ? "pt-12" : "pt-10",
          )}
        >
          {metadata?.icon && (
            <div
              ref={iconRef}
              className={cn(
                "relative mb-5 w-fit",
                coverId && metadata?.icon && "-mt-21",
              )}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setIconOpen(false);
                }
              }}
            >
              <Button
                disabled={disabled}
                aria-label="Change page icon"
                aria-expanded={iconOpen}
                className="flex size-20 items-center justify-center rounded-3xl bg-primary-50  hover:bg-primary-100 dark:bg-primary-950 dark:hover:bg-primary-900 focus-visible:ring-2 focus-visible:ring-accent"
                onClick={() => {
                  setIconMode(iconParts.mode);
                  setIconColor(iconParts.color);
                  setIconOpen(!iconOpen);
                }}
              >
                <AtlasPageIcon
                  icon={metadata.icon}
                  className="size-17 text-6xl"
                />
              </Button>
              {iconPicker}
            </div>
          )}
          {!item.trashedAt && (!metadata?.icon || !coverId) && (
            <div
              className={cn(
                "-ml-2 mb-2 flex min-h-8 w-fit items-center gap-1 opacity-0 pointer-events-none transition-opacity duration-150 group-hover/page-heading:opacity-100 group-hover/page-heading:pointer-events-auto group-focus-within/page-heading:opacity-100 group-focus-within/page-heading:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto",
                (iconOpen || choosingCover) &&
                  "opacity-100 pointer-events-auto",
              )}
            >
              {!metadata?.icon && (
                <div
                  ref={iconRef}
                  className="relative flex"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setIconOpen(false);
                    }
                  }}
                >
                  <Button
                    variant="bare"
                    disabled={disabled}
                    aria-label="Add page icon"
                    aria-expanded={iconOpen}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-s text-primary-500 hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-900 dark:hover:text-primary-300 focus-visible:ring-2 focus-visible:ring-accent/40"
                    onClick={() => {
                      setIconMode("emoji");
                      setIconColor(DEFAULT_ICON_COLOR);
                      setIconOpen(!iconOpen);
                    }}
                  >
                    <Plus className="size-4 shrink-0" />
                    Add icon
                  </Button>
                  {iconPicker}
                </div>
              )}
              {!coverId && (
                <Button
                  variant="bare"
                  disabled={disabled}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-s text-primary-500 hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-900 dark:hover:text-primary-300 focus-visible:ring-2 focus-visible:ring-accent/40"
                  onClick={() => {
                    setIconOpen(false);
                    setChoosingCover(true);
                  }}
                >
                  <Picture className="size-4 shrink-0" />
                  Add cover
                </Button>
              )}
            </div>
          )}
          {children}
        </div>
      </div>
      <Input
        ref={uploadRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.gif,.avif,.svg"
        className="hidden"
        aria-label="Upload page cover"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file || disabled) return;
          setReadingFile(true);
          void (async () => {
            const saved = await upload({
              accountId,
              pageId: id,
              fileName: file.name,
              data: await pageFileData(file),
            }).unwrap();
            await selectCover(saved.id);
          })()
            .catch((error: unknown) => toast.error(atlasError(error)))
            .finally(() => setReadingFile(false));
        }}
      />
      <Modal
        isOpen={choosingCover}
        onClose={closeCoverPicker}
        aria-label="Choose page cover"
        className="max-w-2xl rounded-3xl"
      >
        <ModalHeader onClose={closeCoverPicker}>
          <Text weight="medium">Page cover</Text>
          <Button
            variant="primary"
            className="ml-auto"
            disabled={disabled}
            onClick={() => uploadRef.current?.click()}
          >
            {readingFile || uploading.isLoading ? "Uploading…" : "Upload image"}
          </Button>
        </ModalHeader>
        <div className="max-h-[65vh] space-y-6 overflow-y-auto px-6 pb-6">
          {images.error != null && (
            <Text role="alert">{atlasError(images.error)}</Text>
          )}
          {images.isLoading && <Muted>Loading images…</Muted>}
          {savedImages.length > 0 && (
            <section aria-labelledby="atlas-cover-images">
              <CoverSectionTitle id="atlas-cover-images">
                Your images
              </CoverSectionTitle>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {savedImages.slice(0, visibleImages).map((image) => (
                  <CoverChoice
                    key={image.id}
                    item={image}
                    disabled={disabled}
                    onSelect={() => {
                      void selectCover(image.id).catch((error: unknown) =>
                        toast.error(atlasError(error)),
                      );
                    }}
                  />
                ))}
              </div>
              {savedImages.length > visibleImages && (
                <Button
                  variant="ghost"
                  className="mt-3"
                  onClick={() =>
                    setVisibleImages((count) => count + IMAGES_PAGE_SIZE)
                  }
                >
                  Show more
                </Button>
              )}
            </section>
          )}
          {ATLAS_COVER_GROUPS.map((group) => (
            <section
              key={group.id}
              aria-labelledby={`atlas-cover-${group.id}`}
            >
              <CoverSectionTitle id={`atlas-cover-${group.id}`}>
                {group.title}
              </CoverSectionTitle>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {ATLAS_COVER_PRESETS.filter(
                  (cover) => cover.group === group.id,
                ).map((cover) => (
                  <CoverPresetChoice
                    key={cover.id}
                    id={cover.id}
                    description={cover.description}
                    disabled={disabled}
                    onSelect={() => {
                      void selectPreset(cover.id).catch((error: unknown) =>
                        toast.error(atlasError(error)),
                      );
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </Modal>
    </>
  );
}
