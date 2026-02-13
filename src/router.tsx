import { Navigate, type RouteObject, createMemoryRouter } from "react-router";
import { WindowLayout } from "@/layouts/window";
import { HomePage } from "@/pages/home";
import { LocalizationsPage } from "@/pages/localizations";
import { SettingsPage } from "@/pages/settings";
import { AboutPage } from "@/pages/about";
import { LocalizationPage } from "@/pages/localization";
import { MainLayout } from "./layouts/main";
import Fallback from "@/components/fallback/fallback";
import ErrorBoundary from "@/components/error-boundary/error-boundary";
import { GlupoPage } from "@/pages/glupo";
import { GlupoShopPage } from "@/pages/glupo-shop";
import { GlupoLightPage } from "@/pages/glupo-light";
import { queryClient } from "@/lib/query-client";
import { invoke } from "@tauri-apps/api/core";
import { AppState } from "@/stores/models";

export const routes: RouteObject[] = [
  {
    element: <WindowLayout />,
    children: [
      {
        element: <MainLayout />,
        errorElement: <ErrorBoundary />,
        loader: () =>
          queryClient.ensureQueryData({
            queryKey: ["appState"],
            queryFn: () => invoke<AppState>("get_app_state"),
          }),
        hydrateFallbackElement: <Fallback />,
        children: [
          {
            index: true,
            element: <Navigate to="/home" />,
          },
          {
            path: "/home",
            element: <HomePage />,
          },
          {
            path: "/localizations",
            element: <LocalizationsPage />,
            children: [
              {
                path: ":id",
                element: <LocalizationPage />,
              },
              {
                index: true,
                element: <LocalizationPage />,
              },
            ],
          },
          {
            path: "/settings",
            element: <SettingsPage />,
          },
          {
            path: "/about",
            element: <AboutPage />,
          },

          {
            path: "/about/glupo",
            element: <GlupoPage />,
          },
          {
            path: "/about/glupo/shop",
            element: <GlupoShopPage />,
          },
          {
            path: "/about/glupo/light",
            element: <GlupoLightPage />,
          },
        ],
      },
    ],
  },
];

export const router = createMemoryRouter(routes);
