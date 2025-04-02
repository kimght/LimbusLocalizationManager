import { makeAutoObservable, runInAction } from "mobx";
import { Localization } from "./models";

export class LocalizationsStore {
  public byId: Record<string, Localization> = {};
  public isLoading: boolean = false;
  public error: string | null = null;

  constructor() {
    makeAutoObservable(this, {}, {autoBind: true});

    this.fetchLocalizations();
  }

  async fetchLocalizations() {
    this.isLoading = true;
    this.error = null;

    const localizations: Localization[] = [
      {
        id: "english-default",
        version: "1.0.0",
        name: "Test localization",
        country: "US",
        icon: "https://avatars.githubusercontent.com/u/129521269",
        description: "# English Localization\n\nThis is a comprehensive English localization package for Limbus Company.\n\n## Features\n\n- Complete translation of all game text\n- Localized UI elements\n- Voice acting subtitles\n- Consistent terminology with official sources\n\n## Installation\n\nSimply click the install button and the localization will be automatically applied to your game.\n\n![English Localization](https://avatars.githubusercontent.com/u/129521269)\n\n> Note: This localization is maintained by a dedicated team of volunteers and is updated regularly to match the latest game content.",
        authors: ["John Doe", "Jane Doe", "John Smith", "Jane Smith", "John Johnson", "Jane Johnson"],  
        urls: ["https://github.com/Crescent-Corporation/LimbusCompanyBusRUS/releases/download/v0.4.3-quick-fix/LimbusCompanyRUS.zip"],
        format: "compatible",
      },
    ]

    await new Promise(resolve => setTimeout(resolve, 1000));

    runInAction(() => {
      this.isLoading = false;
      this.byId = localizations.reduce((acc, localization) => {
        acc[localization.id] = localization;
        return acc;
      }, {} as Record<string, Localization>);
    });
  }

  public get all() {
    return Object.values(this.byId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
} 