import { screen, systemPreferences, type BrowserWindow, type Rectangle } from "electron";
import { createWindowPresentationLifecycle } from "../../shared/window-lifecycle";

interface WorkspaceWindowState {
  bounds: Rectangle;
  maximized: boolean;
  fullscreen: boolean;
  resizable: boolean;
  maximizable: boolean;
  fullscreenable: boolean;
}

/** macOS completes fullscreen changes asynchronously, including their bounds. */
async function setFullscreen(window: BrowserWindow, fullscreen: boolean): Promise<void> {
  if (window.isDestroyed() || window.isFullScreen() === fullscreen) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.removeListener("enter-full-screen", done);
      window.removeListener("leave-full-screen", done);
      window.removeListener("closed", done);
    };
    const done = () => { cleanup(); resolve(); };
    if (fullscreen) window.once("enter-full-screen", done);
    else window.once("leave-full-screen", done);
    window.once("closed", done);
    try { window.setFullScreen(fullscreen); }
    catch (error) { cleanup(); reject(error); }
  });
}

async function restoreBounds(window: BrowserWindow, bounds: Rectangle): Promise<void> {
  if (window.isDestroyed()) return;
  const current = window.getBounds();
  const animate = process.platform === "darwin" && window.isVisible() &&
    !systemPreferences.getAnimationSettings().prefersReducedMotion &&
    (current.width !== bounds.width || current.height !== bounds.height);
  if (!animate) {
    window.setBounds(bounds, false);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(fallback);
      window.removeListener("resized", done);
      window.removeListener("closed", done);
    };
    const done = () => { cleanup(); resolve(); };
    const fallback = setTimeout(done, 1500);
    window.once("resized", done);
    window.once("closed", done);
    try { window.setBounds(bounds, true); }
    catch (error) { cleanup(); reject(error); }
  });
}

/** Owns the temporary native bounds; renderer reloads must keep the snapshot. */
export function createOnboardingWindowState(window: BrowserWindow, savedMaximized = false) {
  const lifecycle = createWindowPresentationLifecycle<WorkspaceWindowState>();
  window.once("closed", lifecycle.close);

  return {
    isTemporary: lifecycle.temporary,
    setOnboarding(onboarding: boolean): Promise<void> {
      return lifecycle.enqueue(async () => {
        if (window.isDestroyed()) return;
        if (!onboarding) {
          const initialized = lifecycle.initialized();
          const previous = lifecycle.restore();
          if (previous) {
            window.setResizable(previous.resizable);
            window.setMaximizable(previous.maximizable);
            window.setFullScreenable(previous.fullscreenable);
            await restoreBounds(window, previous.bounds);
            if (window.isDestroyed()) return;
            if (previous.maximized) window.maximize();
            await setFullscreen(window, previous.fullscreen);
          } else if (!initialized && savedMaximized) {
            window.maximize();
          }
          lifecycle.restored(previous);
          return;
        }
        // StrictMode, HMR, and crash recovery can send the same mode again.
        const workspace = lifecycle.enter((first) => ({
          bounds: window.getNormalBounds(),
          maximized: window.isMaximized() || (first && savedMaximized),
          fullscreen: window.isFullScreen(),
          resizable: window.isResizable(),
          maximizable: window.isMaximizable(),
          fullscreenable: window.isFullScreenable(),
        }));
        if (!workspace) return;
        await setFullscreen(window, false);
        if (window.isDestroyed()) return;
        if (window.isMaximized()) window.unmaximize();
        window.setResizable(false);
        window.setMaximizable(false);
        window.setFullScreenable(false);
        const area = screen.getDisplayMatching(workspace.bounds).workArea;
        const width = Math.min(1080, area.width);
        const height = Math.min(740, area.height);
        window.setBounds({
          x: Math.round(area.x + (area.width - width) / 2),
          y: Math.round(area.y + (area.height - height) / 2),
          width,
          height,
        }, false);
        lifecycle.entered(workspace);
      });
    },
  };
}
