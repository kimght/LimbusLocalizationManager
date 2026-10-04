import { useLanguage } from "@/hooks/use-app-state";
import styles from "./page.module.css";

function Page() {
  const language = useLanguage();
  const src = new URL(import.meta.env.VITE_APP_PARKOUR_URL);
  src.searchParams.set("lang", language);

  return (
    <iframe src={src.href} title="Parkour game" className={styles.frame} />
  );
}

export default Page;
