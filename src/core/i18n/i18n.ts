import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en_common from "./locales/en/common.json";
import en_settings from "./locales/en/settings.json";
import en_explorer from "./locales/en/explorer.json";
import en_tabs from "./locales/en/tabs.json";
import en_commands from "./locales/en/commands.json";
import es_common from "./locales/es/common.json";
import es_settings from "./locales/es/settings.json";
import es_explorer from "./locales/es/explorer.json";
import es_tabs from "./locales/es/tabs.json";
import es_commands from "./locales/es/commands.json";

i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: en_common,
      settings: en_settings,
      explorer: en_explorer,
      tabs: en_tabs,
      commands: en_commands,
    },
    es: {
      common: es_common,
      settings: es_settings,
      explorer: es_explorer,
      tabs: es_tabs,
      commands: es_commands,
    },
  },
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  interpolation: { escapeValue: false },
  debug: process.env.NODE_ENV === "development",
});

export default i18n;
