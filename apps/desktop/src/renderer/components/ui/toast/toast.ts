import type {
  Toast,
  ToastOptions,
  ToastListener,
  ToastStore,
  ToastType,
  PromiseOptions,
} from "./types";

const DEFAULT_DURATION = 2500;

let toastIdCounter = 0;

function generateId(): string {
  return `toast-${++toastIdCounter}-${Date.now()}`;
}

function createToastStore(): ToastStore {
  let toasts: Toast[] = [];
  const listeners = new Set<ToastListener>();

  const notify = () => {
    const snapshot = [...toasts];
    listeners.forEach((listener) => listener(snapshot));
  };

  return {
    get toasts() {
      return toasts;
    },

    subscribe(listener: ToastListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return toasts;
    },

    add(toast: Toast) {
      toasts = [toast, ...toasts];
      notify();
      return toast.id;
    },

    update(id: string, updates: Partial<Toast>) {
      toasts = toasts.map((t) => (t.id === id ? { ...t, ...updates } : t));
      notify();
    },

    dismiss(id: string) {
      const toast = toasts.find((t) => t.id === id);
      if (toast?.onDismiss) {
        toast.onDismiss(id);
      }
      toasts = toasts.filter((t) => t.id !== id);
      notify();
    },

    dismissAll() {
      toasts.forEach((toast) => {
        if (toast.onDismiss) {
          toast.onDismiss(toast.id);
        }
      });
      toasts = [];
      notify();
    },
  };
}

export const toastStore = createToastStore();

function createToast(
  message: string,
  type: ToastType,
  options: ToastOptions = {},
): string {
  const id = options.id ?? generateId();

  const toast: Toast = {
    id,
    message,
    type,
    duration:
      options.duration ?? (type === "loading" ? Infinity : DEFAULT_DURATION),
    icon: options.icon,
    action: options.action,
    dismissible: options.dismissible ?? true,
    createdAt: Date.now(),
    onDismiss: options.onDismiss,
  };

  // If toast with same id exists, update it instead
  const existing = toastStore.toasts.find((t) => t.id === id);
  if (existing) {
    toastStore.update(id, toast);
  } else {
    toastStore.add(toast);
  }

  return id;
}

function toast(message: string, options?: ToastOptions): string {
  return createToast(message, "default", options);
}

toast.success = (message: string, options?: ToastOptions): string => {
  return createToast(message, "success", options);
};

toast.error = (message: string, options?: ToastOptions): string => {
  return createToast(message, "error", options);
};

toast.loading = (message: string, options?: ToastOptions): string => {
  return createToast(message, "loading", { ...options, duration: Infinity });
};

toast.promise = <T>(
  promise: Promise<T>,
  options: PromiseOptions<T>,
): Promise<T> => {
  const id = generateId();

  createToast(options.loading, "loading", { id, duration: Infinity });

  promise
    .then((data) => {
      const successMessage =
        typeof options.success === "function"
          ? options.success(data)
          : options.success;
      toastStore.update(id, {
        message: successMessage,
        type: "success",
        duration: DEFAULT_DURATION,
        createdAt: Date.now(),
      });
    })
    .catch((error) => {
      const errorMessage =
        typeof options.error === "function"
          ? options.error(error)
          : options.error;
      toastStore.update(id, {
        message: errorMessage,
        type: "error",
        duration: DEFAULT_DURATION,
        createdAt: Date.now(),
      });
    });

  return promise;
};

toast.dismiss = (id: string): void => {
  toastStore.dismiss(id);
};

toast.dismissAll = (): void => {
  toastStore.dismissAll();
};

export { toast };
