import Navbar from "@/components/navbar/navbar";
import { Outlet } from "react-router";
import styles from "./main.module.css";
import { useTauriQuerySync, useLanguageSync } from "@/hooks/use-tauri-events";

function Main() {
  useTauriQuerySync();
  useLanguageSync();

  return (
    <div className={styles.container}>
      <Navbar />
      <div className={styles.page}>
        <Outlet />
      </div>
    </div>
  );
}

export default Main;
