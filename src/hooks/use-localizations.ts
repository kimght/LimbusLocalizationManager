import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Localization } from "@/stores/models";
import { useMemo } from "react";

const getFlag = async (localization: Localization) => {
  const name = localization.flag.replace(/\.[^.]+$/, "");
  const parts = localization.flag.split(".");
  const extension = parts.length > 1 ? parts.pop() : "svg";

  try {
    const flag = await import(`../assets/flags/${name}.${extension}`);
    return { flag: flag.default, id: localization.id };
  } catch {
    return {
      flag: `https://purecatamphetamine.github.io/country-flag-icons/3x2/${name}.svg`,
      id: localization.id,
    };
  }
};

export function useLocalizations() {
  const query = useQuery({
    queryKey: ["localizations"],
    queryFn: async () => {
      const localizations = await invoke<Localization[]>(
        "get_available_localizations"
      );

      const flagResults = await Promise.all(localizations.map(getFlag));
      const flags = flagResults.reduce(
        (acc, { flag, id }) => {
          acc[id] = flag;
          return acc;
        },
        {} as Record<string, string>
      );

      return { localizations, flags };
    },
  });

  const byId = useMemo(() => {
    if (!query.data) return {};
    return query.data.localizations.reduce(
      (acc, localization) => {
        acc[localization.id] = localization;
        return acc;
      },
      {} as Record<string, Localization>
    );
  }, [query.data]);

  const sorted = useMemo(() => {
    if (!query.data) return [];
    return [...query.data.localizations].sort((a, b) => {
      let comparison = a.flag.localeCompare(b.flag);
      if (comparison === 0) {
        comparison = a.name.localeCompare(b.name);
      }
      return comparison;
    });
  }, [query.data]);

  return {
    ...query,
    byId,
    all: sorted,
    flags: query.data?.flags ?? {},
  };
}
