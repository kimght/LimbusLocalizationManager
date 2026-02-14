import { toast, ToastContentProps } from "react-toastify";
import styles from "./toast.module.css";
import { X } from "lucide-react";
import { cn, openLogDir } from "@/utils";
import i18n from "@/i18n";

interface ToastData {
  message: string;
  action?: { label: string; onClick: () => void };
}

function Toast({ closeToast, toastProps }: ToastContentProps) {
  const data = toastProps.data as ToastData;

  return (
    <div
      className={cn(styles.toast, toastProps.type === "error" && styles.error)}
    >
      <h1>{data.message}</h1>
      <div className={styles.actions}>
        {data.action && (
          <button className={styles.action} onClick={data.action.onClick}>
            {data.action.label}
          </button>
        )}
        <button onClick={closeToast}>
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function toastError(message: string) {
  toast(Toast, {
    className: cn(styles.container, styles.error),
    data: {
      message,
      action: {
        label: i18n.t("error.openLogs"),
        onClick: openLogDir,
      },
    },
  });
}

export function toastSuccess(message: string) {
  toast(Toast, {
    className: styles.container,
    type: "success",
    data: {
      message,
    },
  });
}

export function toastInfo(message: string) {
  toast(Toast, {
    className: styles.container,
    type: "info",
    data: {
      message,
    },
  });
}
