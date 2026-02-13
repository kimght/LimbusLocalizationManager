import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { locale } from "@tauri-apps/plugin-os";
import type { LanguageDetectorAsyncModule } from "i18next";

// Part I: Importing Language Files
import en from "./locales/en.json";
import ru_RU from "./locales/ru-RU.json";
import zh_Hant from "./locales/zh-Hant.json";
import es_MX from "./locales/es-MX.json";
import zh_Hans from "./locales/zh-Hans.json";
import pt_BR from "./locales/pt-BR.json";
import th_TH from "./locales/th-TH.json";
import it_IT from "./locales/it-IT.json";

// Part II: Resource definition
const resources = {
  en: { translation: en },
  ru_RU: { translation: ru_RU },
  zh_Hant: { translation: zh_Hant },
  es_MX: { translation: es_MX },
  zh_Hans: { translation: zh_Hans },
  pt_BR: { translation: pt_BR },
  th_TH: { translation: th_TH },
  it_IT: { translation: it_IT },
};

// Part III: Language display name
export const languageNames = {
  en: "English",
  ru_RU: "Русский",
  zh_Hant: "繁體中文",
  es_MX: "Español",
  zh_Hans: "简体中文",
  pt_BR: "Português",
  th_TH: "ภาษาไทย",
  it_IT: "Italiano",
} as const;

const languageDetector: LanguageDetectorAsyncModule = {
  type: "languageDetector",
  async: true,
  detect: (callback) => {
    locale()
      .then((language) => {
        callback(language ?? "en");
      })
      .catch(() => callback("en"));
  },
};

i18n
  .use(initReactI18next)
  .use(languageDetector)
  .init({
    fallbackLng: {
      "zh-CN": ["zh_Hans", "en"],
      "zh-TW": ["zh_Hant", "en"],
      "zh-HK": ["zh_Hant", "en"],
      "ru-RU": ["ru_RU", "en"],
      "ru-*": ["ru_RU", "en"],
      "es-MX": ["es_MX", "en"],
      "es-*": ["es_MX", "en"],
      "pt-BR": ["pt_BR", "en"],
      "pt-*": ["pt_BR", "en"],
      "th-TH": ["th_TH", "en"],
      "it-IT": ["it_IT", "en"],
      "it-*": ["it_IT", "en"],
      default: ["en"],
    },
    resources,
    nonExplicitSupportedLngs: true,
  });

export default i18n;
