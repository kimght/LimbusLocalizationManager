import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { appLogDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatEnkephalin(number?: number | null, defaultText?: string) {
  if (number === undefined || number === null || !isFinite(number)) {
    return defaultText ?? "0";
  }

  return number.toLocaleString("ru-RU", {
    maximumFractionDigits: 0,
  });
}

export async function openLogDir() {
  const dir = await appLogDir();
  await revealItemInDir(dir);
}
