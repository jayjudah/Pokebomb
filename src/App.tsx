import { useState } from "react";
import ScanView from "./components/ScanView";
import CollectionView from "./components/CollectionView";
import DecksView from "./components/DecksView";
import SettingsView from "./components/SettingsView";

type Tab = "scan" | "collection" | "decks" | "settings";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "scan", label: "Scan", icon: "◎" },
  { id: "collection", label: "Collection", icon: "▦" },
  { id: "decks", label: "Decks", icon: "♛" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("scan");
  return (
    <div className="app">
      <main className="content">
        {tab === "scan" && <ScanView />}
        {tab === "collection" && <CollectionView />}
        {tab === "decks" && <DecksView />}
        {tab === "settings" && <SettingsView />}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
            <span className="tab-icon" aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
