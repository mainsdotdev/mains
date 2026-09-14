import { ReactNode } from "react";

export type ToastType = "default" | "success" | "error" | "loading";

export interface ToastItemProps {
  toast: Toast;
  index: number;
  onDismiss: (id: string) => void;
}

export interface ToastOptions {
  id?: string;
  duration?: number;
  icon?: ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  dismissible?: boolean;
  onDismiss?: (id: string) => void;
}

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  icon?: ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  dismissible: boolean;
  createdAt: number;
  onDismiss?: (id: string) => void;
}

export interface PromiseOptions<T> {
  loading: string;
  success: string | ((data: T) => string);
  error: string | ((error: unknown) => string);
}

export type ToastListener = (toasts: Toast[]) => void;

export interface ToastStore {
  toasts: Toast[];
  subscribe: (listener: ToastListener) => () => void;
  getSnapshot: () => Toast[];
  add: (toast: Toast) => string;
  update: (id: string, updates: Partial<Toast>) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}
