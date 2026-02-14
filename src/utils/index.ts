import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { appConfigDir, appLogDir } from "@tauri-apps/api/path";
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

  try {
    await revealItemInDir(`${dir}/LimbusLocalizationManager.log`);
  } catch {
    await revealItemInDir(dir);
  }
}

export async function openConfigDir() {
  const dir = await appConfigDir();

  try {
    await revealItemInDir(`${dir}/config.toml`);
  } catch {
    await revealItemInDir(dir);
  }
}
