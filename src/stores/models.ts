export interface LocalizationSource {
  name: string;
  url: string;
}

export interface AppSettings {
  config_version: number;
  sources: Record<string, LocalizationSource>;
  selected_source: string | null;
  game_directory: string | null;
  language: string | null;
}

export interface InstalledLocalization {
  id: string;
  version: string;
  source: string;
}

export interface InstalledMetadata {
  installed: Record<string, InstalledLocalization>;
}

export interface AppState {
  settings: AppSettings;
  installed_metadata: InstalledMetadata | null;
}

export interface AvailableLocalizations {
  localizations: Localization[];
}

export const Format = {
  Compatible: "compatible",
  New: "new",
} as const;

export type Format = (typeof Format)[keyof typeof Format];

export interface Font {
  url: string;
  hash: string;
  name: string;
}

export interface Localization {
  id: string;
  version: string;
  name: string;
  flag: string;
  icon: string;
  description: string;
  authors: string[];
  url: string;
  fonts: Font[];
  format: Format;
}

export interface RemoteLocalizations {
  source: string;
  localizations: Localization[];
}

export const Status = {
  Idle: "idle",
  Installing: "installing",
  Uninstalling: "uninstalling",
  Updating: "updating",
  Repairing: "repairing",
} as const;

export type Status = (typeof Status)[keyof typeof Status];

export type Progress =
  | {
      type: "started";
    }
  | {
      type: "unknown_localization";
      localization: string;
    }
  | {
      type: "up_to_date";
      localization: string;
    }
  | {
      type: "updating";
      localization: string;
    }
  | {
      type: "update_finished";
      localization: string;
    }
  | {
      type: "starting_game";
    }
  | {
      type: "finished";
    };
