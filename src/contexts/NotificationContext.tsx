"use client";

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AppNotificationType = "success" | "error" | "warning";

type AppNotification = {
  id: string;
  type: AppNotificationType;
  message: string;
  title?: string;
  durationMs?: number;
};

type NotifyOptions = {
  title?: string;
  durationMs?: number;
};

type NotificationContextValue = {
  notify: (
    input: Omit<AppNotification, "id">,
  ) => string;
  success: (message: string, options?: NotifyOptions) => string;
  error: (message: string, options?: NotifyOptions) => string;
  warning: (message: string, options?: NotifyOptions) => string;
  dismiss: (id: string) => void;
  clear: () => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);
const DEFAULT_DURATION_MS = 4000;

const TOAST_STYLES: Record<
  AppNotificationType,
  {
    icon: typeof CheckCircle2;
    title: string;
    cardClassName: string;
    iconClassName: string;
  }
> = {
  success: {
    icon: CheckCircle2,
    title: "Success",
    cardClassName:
      "border-emerald-200/90 bg-white text-slate-700 shadow-[0_18px_40px_rgba(16,185,129,0.16)]",
    iconClassName: "text-emerald-600",
  },
  error: {
    icon: AlertCircle,
    title: "Error",
    cardClassName:
      "border-red-200/90 bg-white text-slate-700 shadow-[0_18px_40px_rgba(239,68,68,0.16)]",
    iconClassName: "text-red-600",
  },
  warning: {
    icon: AlertTriangle,
    title: "Warning",
    cardClassName:
      "border-amber-200/90 bg-white text-slate-700 shadow-[0_18px_40px_rgba(245,158,11,0.18)]",
    iconClassName: "text-amber-600",
  },
};

function buildNotificationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function NotificationToast({
  notification,
  onDismiss,
}: {
  notification: AppNotification;
  onDismiss: (id: string) => void;
}) {
  const style = TOAST_STYLES[notification.type];
  const Icon = style.icon;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      onDismiss(notification.id);
    }, notification.durationMs ?? DEFAULT_DURATION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [notification.durationMs, notification.id, onDismiss]);

  return (
    <div
      role="status"
      aria-live={notification.type === "success" ? "polite" : "assertive"}
      className={`pointer-events-auto w-full rounded-2xl border p-4 backdrop-blur-sm ${style.cardClassName}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-50 ${style.iconClassName}`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-950">
            {notification.title?.trim() || style.title}
          </p>
          <p className="mt-1 text-sm leading-5 text-slate-600">
            {notification.message}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(notification.id)}
          className="app-icon-button h-8 w-8 shrink-0"
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const dismiss = useCallback((id: string) => {
    setNotifications((current) =>
      current.filter((notification) => notification.id !== id),
    );
  }, []);

  const clear = useCallback(() => {
    setNotifications([]);
  }, []);

  const notify = useCallback(
    ({ type, message, title, durationMs }: Omit<AppNotification, "id">) => {
      const nextId = buildNotificationId();

      setNotifications((current) => [
        ...current,
        {
          id: nextId,
          type,
          message,
          title,
          durationMs,
        },
      ]);

      return nextId;
    },
    [],
  );

  const success = useCallback(
    (message: string, options?: NotifyOptions) =>
      notify({
        type: "success",
        message,
        title: options?.title,
        durationMs: options?.durationMs,
      }),
    [notify],
  );

  const error = useCallback(
    (message: string, options?: NotifyOptions) =>
      notify({
        type: "error",
        message,
        title: options?.title,
        durationMs: options?.durationMs,
      }),
    [notify],
  );

  const warning = useCallback(
    (message: string, options?: NotifyOptions) =>
      notify({
        type: "warning",
        message,
        title: options?.title,
        durationMs: options?.durationMs,
      }),
    [notify],
  );

  const value = useMemo<NotificationContextValue>(
    () => ({
      notify,
      success,
      error,
      warning,
      dismiss,
      clear,
    }),
    [clear, dismiss, error, notify, success, warning],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[120000] flex flex-col gap-3 px-4 sm:left-auto sm:right-4 sm:w-full sm:max-w-sm">
        {notifications.map((notification) => (
          <NotificationToast
            key={notification.id}
            notification={notification}
            onDismiss={dismiss}
          />
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export function useAppNotifications() {
  const context = useContext(NotificationContext);

  if (!context) {
    throw new Error(
      "useAppNotifications must be used within a NotificationProvider",
    );
  }

  return context;
}
