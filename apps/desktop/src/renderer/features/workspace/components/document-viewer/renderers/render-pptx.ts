import { nearestSlideIndex } from "@/lib/document-viewer";

// `pptx-preview` renders every slide into ordinary DOM. We keep that single
// render as the source of truth, then clone scaled, inert snapshots into the
// navigator instead of parsing the presentation a second time.

const THUMBNAIL_MAX_WIDTH = 112;
const THUMBNAIL_MAX_HEIGHT = 68;

export interface PptxRenderController {
  slideCount: number;
  setZoom: (zoom: number) => void;
  destroy: () => void;
}

function presentationSlides(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(".pptx-preview-slide-wrapper"),
  );
}

/** Prefix cloned SVG/HTML ids so a thumbnail cannot steal references from the
 * full-size slide living in the same shadow root. */
function isolateCloneIds(root: HTMLElement, prefix: string): void {
  const withIds: Element[] = [
    root,
    ...Array.from(root.querySelectorAll("[id]")),
  ];
  const replacements = new Map<string, string>();

  for (const element of withIds) {
    const id = element.getAttribute("id");
    if (!id) continue;
    const nextId = `${prefix}-${id}`;
    replacements.set(id, nextId);
    element.setAttribute("id", nextId);
  }

  if (replacements.size === 0) return;
  const descendants: Element[] = [
    root,
    ...Array.from(root.querySelectorAll("*")),
  ];
  for (const element of descendants) {
    for (const attribute of Array.from(element.attributes)) {
      let nextValue = attribute.value;
      for (const [from, to] of replacements) {
        nextValue = nextValue.split(`#${from}`).join(`#${to}`);
      }
      if (nextValue !== attribute.value) {
        element.setAttribute(attribute.name, nextValue);
      }
    }
  }

  for (const style of Array.from(root.querySelectorAll("style"))) {
    let css = style.textContent ?? "";
    for (const [from, to] of replacements) {
      css = css.split(`#${from}`).join(`#${to}`);
    }
    style.textContent = css;
  }
}

function thumbnailClone(
  slide: HTMLElement,
  index: number,
): {
  clone: HTMLElement;
  width: number;
  height: number;
} {
  const sourceWidth = Number.parseFloat(slide.style.width) || slide.offsetWidth;
  const sourceHeight =
    Number.parseFloat(slide.style.height) || slide.offsetHeight;
  const scale = Math.min(
    THUMBNAIL_MAX_WIDTH / sourceWidth,
    THUMBNAIL_MAX_HEIGHT / sourceHeight,
  );

  const clone = slide.cloneNode(true) as HTMLElement;
  isolateCloneIds(clone, `pptx-thumb-${index}`);
  clone.className = "pptx-thumbnail-slide";
  clone.setAttribute("aria-hidden", "true");
  clone.style.width = `${sourceWidth}px`;
  clone.style.height = `${sourceHeight}px`;
  clone.style.margin = "0";
  clone.style.transform = `scale(${scale})`;
  clone.style.transformOrigin = "top left";
  clone.style.pointerEvents = "none";

  for (const interactive of Array.from(
    clone.querySelectorAll<HTMLElement>("a, button, input, select, textarea"),
  )) {
    interactive.tabIndex = -1;
  }

  return {
    clone,
    width: sourceWidth * scale,
    height: sourceHeight * scale,
  };
}

export async function renderPptx(
  buf: ArrayBuffer,
  container: HTMLElement,
  size: { width: number; zoom: number },
): Promise<PptxRenderController> {
  const stage = document.createElement("div");
  stage.className = "pptx-stage";

  const scroller = document.createElement("div");
  scroller.className = "pptx-stage-scroller";
  scroller.tabIndex = 0;
  scroller.setAttribute("aria-label", "Presentation slides");

  const surface = document.createElement("div");
  surface.className = "pptx-stage-surface";

  const renderRoot = document.createElement("div");
  renderRoot.className = "pptx-render-root";
  surface.append(renderRoot);
  scroller.append(surface);

  const rail = document.createElement("nav");
  rail.className = "pptx-thumbnail-rail";
  rail.setAttribute("aria-label", "Slide navigator");

  const track = document.createElement("div");
  track.className = "pptx-thumbnail-track";
  rail.append(track);
  stage.append(scroller, rail);
  container.replaceChildren(stage);

  // Omitting `height` is intentional: the library otherwise creates its own
  // fixed-height nested scroller, which is what made the old viewer crop decks.
  const viewportWidth = Math.max(320, Math.round(size.width - 64));
  const { init } = await import("pptx-preview");
  const previewer = init(renderRoot, { width: viewportWidth, mode: "list" });

  try {
    await previewer.preview(buf);
  } catch (error) {
    previewer.destroy();
    container.replaceChildren();
    throw error;
  }

  let slides = presentationSlides(renderRoot);
  if (slides.length === 0) {
    previewer.destroy();
    container.replaceChildren();
    throw new Error("PPTX renderer produced no slides");
  }

  const previewWrapper = renderRoot.querySelector<HTMLElement>(
    ".pptx-preview-wrapper",
  );
  if (!previewWrapper) {
    previewer.destroy();
    container.replaceChildren();
    throw new Error("PPTX renderer produced no preview wrapper");
  }
  previewWrapper.style.setProperty("zoom", String(size.zoom));

  let destroyed = false;
  let activeIndex = -1;
  let scrollFrame = 0;
  let thumbnailTimer: number | null = null;
  const buttons: HTMLButtonElement[] = [];
  const viewports: HTMLSpanElement[] = [];

  const revealThumbnail = (index: number, behavior: ScrollBehavior) => {
    const button = buttons[index];
    if (!button) return;
    rail.scrollTo({
      left: button.offsetLeft - (rail.clientWidth - button.offsetWidth) / 2,
      behavior,
    });
  };

  const setActiveSlide = (
    index: number,
    options: { reveal?: boolean; behavior?: ScrollBehavior } = {},
  ) => {
    if (index < 0 || index >= buttons.length || index === activeIndex) return;
    if (activeIndex >= 0) {
      buttons[activeIndex]?.classList.remove("is-active");
      buttons[activeIndex]?.removeAttribute("aria-current");
    }
    activeIndex = index;
    buttons[index].classList.add("is-active");
    buttons[index].setAttribute("aria-current", "page");
    if (options.reveal !== false) {
      revealThumbnail(index, options.behavior ?? "smooth");
    }
  };

  const goToSlide = (index: number, behavior: ScrollBehavior) => {
    const slide = slides[index];
    if (!slide) return;
    setActiveSlide(index, { behavior });

    const scrollerRect = scroller.getBoundingClientRect();
    const slideRect = slide.getBoundingClientRect();
    scroller.scrollTo({
      top:
        scroller.scrollTop +
        slideRect.top -
        scrollerRect.top -
        (scroller.clientHeight - slideRect.height) / 2,
      left:
        scroller.scrollLeft +
        slideRect.left -
        scrollerRect.left -
        (scroller.clientWidth - slideRect.width) / 2,
      behavior,
    });
  };

  const preferredScrollBehavior = (): ScrollBehavior =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";

  const rebuildThumbnails = () => {
    const previouslyActive = activeIndex;
    slides = presentationSlides(renderRoot);
    track.replaceChildren();
    buttons.length = 0;
    viewports.length = 0;
    activeIndex = -1;

    slides.forEach((_, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pptx-thumbnail-button";
      button.setAttribute("aria-label", `Go to slide ${index + 1}`);

      const viewport = document.createElement("span");
      viewport.className = "pptx-thumbnail-viewport";

      const number = document.createElement("span");
      number.className = "pptx-thumbnail-number";
      number.textContent = String(index + 1);
      button.append(viewport, number);
      button.addEventListener("click", () => {
        goToSlide(index, preferredScrollBehavior());
      });
      button.addEventListener("keydown", (event) => {
        let nextIndex = index;
        if (event.key === "ArrowLeft") nextIndex = Math.max(0, index - 1);
        else if (event.key === "ArrowRight") {
          nextIndex = Math.min(slides.length - 1, index + 1);
        } else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = slides.length - 1;
        else return;

        event.preventDefault();
        buttons[nextIndex]?.focus();
        goToSlide(nextIndex, preferredScrollBehavior());
      });

      track.append(button);
      buttons.push(button);
      viewports.push(viewport);
    });

    if (slides.length > 0) {
      setActiveSlide(
        Math.min(Math.max(previouslyActive, 0), slides.length - 1),
        {
          reveal: false,
        },
      );
    }
  };

  const refreshThumbnailImages = () => {
    slides = presentationSlides(renderRoot);
    if (slides.length !== buttons.length) rebuildThumbnails();

    slides.forEach((slide, index) => {
      const viewport = viewports[index];
      if (!viewport) return;
      const thumbnail = thumbnailClone(slide, index);
      viewport.style.width = `${thumbnail.width}px`;
      viewport.style.height = `${thumbnail.height}px`;
      viewport.replaceChildren(thumbnail.clone);
    });

    if (activeIndex < 0) setActiveSlide(0, { reveal: false });
  };

  const scheduleThumbnailRefresh = () => {
    if (destroyed) return;
    if (thumbnailTimer !== null) window.clearTimeout(thumbnailTimer);
    // Charts can mutate dozens of SVG attributes per frame. Wait until that
    // burst settles so thumbnail generation never joins the animation loop.
    thumbnailTimer = window.setTimeout(() => {
      thumbnailTimer = null;
      if (!destroyed) refreshThumbnailImages();
    }, 120);
  };

  const updateStageInsets = () => {
    const firstSlide = slides[0];
    if (!firstSlide) return;
    const verticalInset = Math.max(
      28,
      (scroller.clientHeight - firstSlide.getBoundingClientRect().height) / 2,
    );
    surface.style.paddingTop = `${verticalInset}px`;
    surface.style.paddingBottom = `${verticalInset}px`;
  };

  const updateActiveFromScroll = () => {
    scrollFrame = 0;
    if (destroyed) return;
    const viewport = scroller.getBoundingClientRect();
    const viewportCenter = viewport.top + viewport.height / 2;
    const centers = slides.map((slide) => {
      const rect = slide.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    setActiveSlide(nearestSlideIndex(centers, viewportCenter));
  };

  const scheduleActiveUpdate = () => {
    if (destroyed || scrollFrame) return;
    scrollFrame = window.requestAnimationFrame(updateActiveFromScroll);
  };

  rebuildThumbnails();
  refreshThumbnailImages();
  updateStageInsets();
  goToSlide(0, "auto");
  scroller.addEventListener("scroll", scheduleActiveUpdate, { passive: true });

  // Some charts and images arrive after `preview()` resolves. Refresh only the
  // small snapshots when that happens; the main slide DOM remains untouched.
  const mutationObserver = new MutationObserver(scheduleThumbnailRefresh);
  mutationObserver.observe(previewWrapper, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });

  const resizeObserver = new ResizeObserver(() => {
    updateStageInsets();
    goToSlide(Math.max(0, activeIndex), "auto");
  });
  resizeObserver.observe(scroller);

  return {
    slideCount: previewer.slideCount,
    setZoom(nextZoom) {
      previewWrapper.style.setProperty("zoom", String(nextZoom));
      const indexToKeep = Math.max(0, activeIndex);
      window.requestAnimationFrame(() => {
        if (!destroyed) {
          updateStageInsets();
          goToSlide(indexToKeep, "auto");
        }
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      scroller.removeEventListener("scroll", scheduleActiveUpdate);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      if (thumbnailTimer !== null) window.clearTimeout(thumbnailTimer);
      previewer.destroy();
      container.replaceChildren();
    },
  };
}
