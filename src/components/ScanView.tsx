import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CardScanner, computeGuide, type Rect, type ScanStatus } from "../lib/scanner";
import { addCard, adjustQty, enrichCard, getCollection } from "../lib/collection";
import { indexSize, loadIndex } from "../lib/cardIndex";
import { imageUrl, type Match } from "../lib/cardDb";
import { getSettings, useSettings } from "../lib/settings";
import { chirp } from "../lib/feedback";
import type { CardInfo } from "../lib/types";
import CardSearch from "./CardSearch";

interface Recent {
  key: number;
  card: CardInfo;
}

const STATUS_TEXT: Record<ScanStatus, string> = {
  starting: "Starting camera…",
  waiting: "Slide a card into the frame",
  reading: "Reading…",
  matched: "Added",
  unsure: "Is this it?",
  error: "Something went wrong",
};

export default function ScanView() {
  const settings = useSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<CardScanner | null>(null);
  const [guide, setGuide] = useState<Rect | null>(null);
  const [status, setStatus] = useState<{ s: ScanStatus; detail?: string }>({ s: "starting" });
  const [recent, setRecent] = useState<Recent[]>([]);
  const [suggestion, setSuggestion] = useState<Match | null>(null);
  const [torch, setTorch] = useState(false);
  const [searching, setSearching] = useState(false);
  const [indexed, setIndexed] = useState(indexSize());

  function added(card: CardInfo) {
    const owned = addCard(card);
    if (owned.price === undefined) void enrichCard(card.id);
    setRecent((r) => [{ key: Date.now() + Math.random(), card }, ...r].slice(0, 30));
    if (getSettings().sound) chirp(true);
  }

  useEffect(() => {
    const video = videoRef.current!;
    const scanner = new CardScanner(
      video,
      {
        onStatus: (s, detail) => setStatus({ s, detail }),
        onMatch: (m) => {
          setSuggestion(null);
          added(m.card);
        },
        onSuggest: (m) => {
          setSuggestion(m);
          if (getSettings().sound) chirp(false);
        },
      },
      { engine: getSettings().engine, claudeApiKey: getSettings().claudeApiKey },
    );
    scannerRef.current = scanner;
    void scanner.start();
    return () => scanner.stop();
  }, []);

  useEffect(() => {
    if (scannerRef.current) scannerRef.current.options = { engine: settings.engine, claudeApiKey: settings.claudeApiKey };
    if (settings.engine === "free") void loadIndex().then(() => setIndexed(indexSize()));
  }, [settings.engine, settings.claudeApiKey]);

  // Keep the on-screen frame in sync with the region the scanner reads.
  useLayoutEffect(() => {
    const video = videoRef.current!;
    const update = () => {
      const w = wrapRef.current;
      if (!w || !video.videoWidth) return;
      setGuide(computeGuide(w.clientWidth, w.clientHeight, video.videoWidth, video.videoHeight).el);
    };
    video.addEventListener("loadedmetadata", update);
    window.addEventListener("resize", update);
    return () => {
      video.removeEventListener("loadedmetadata", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  function undo(r: Recent) {
    const owned = getCollection().find((c) => c.id === r.card.id);
    if (owned) adjustQty(owned.id, -1);
    setRecent((list) => list.filter((x) => x.key !== r.key));
  }

  return (
    <div className="scan">
      <div className="camera" ref={wrapRef}>
        <video ref={videoRef} muted playsInline autoPlay />
        {guide && (
          <div
            className={`guide guide-${status.s}`}
            style={{ left: guide.x, top: guide.y, width: guide.w, height: guide.h }}
          />
        )}
        <div className="scan-top">
          <div className="engine-chip">
            {settings.engine === "claude"
              ? "AI scan"
              : indexed
                ? `${indexed.toLocaleString()} cards on device`
                : "Text reading only"}
          </div>
          <div className="scan-tools">
            <button
              className="icon-btn"
              aria-label="Torch"
              onClick={async () => {
                const ok = await scannerRef.current?.setTorch(!torch);
                if (ok) setTorch(!torch);
              }}
            >
              {torch ? "🔦" : "💡"}
            </button>
            <button className="icon-btn" aria-label="Rescan" onClick={() => scannerRef.current?.rescan()}>
              ↻
            </button>
            <button className="icon-btn" aria-label="Search" onClick={() => setSearching(true)}>
              ⌕
            </button>
          </div>
        </div>
        <div className={`status status-${status.s}`}>
          {status.s === "matched" ? `Added ${status.detail}` : status.detail ?? STATUS_TEXT[status.s]}
        </div>

        {suggestion && (
          <div className="suggest">
            {imageUrl(suggestion.card) && <img src={imageUrl(suggestion.card)} alt="" />}
            <div>
              <div className="suggest-q">Is this it?</div>
              <strong>{suggestion.card.name}</strong>
              <div className="muted">
                {suggestion.card.setName} · #{suggestion.card.localId}
              </div>
              <div className="row">
                <button
                  className="primary"
                  onClick={() => {
                    added(suggestion.card);
                    setSuggestion(null);
                  }}
                >
                  Add
                </button>
                <button onClick={() => setSuggestion(null)}>Skip</button>
                <button
                  onClick={() => {
                    setSuggestion(null);
                    setSearching(true);
                  }}
                >
                  Search…
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="tray">
        <div className="tray-head">
          <span>This session: {recent.length} cards</span>
          {recent.length > 0 && (
            <button className="link" onClick={() => setRecent([])}>
              Clear list
            </button>
          )}
        </div>
        <div className="tray-strip">
          {recent.map((r) => (
            <div key={r.key} className="tray-card">
              {imageUrl(r.card) ? <img src={imageUrl(r.card)} alt={r.card.name} /> : <div className="noimg">{r.card.name}</div>}
              <button className="undo" aria-label={`Remove ${r.card.name}`} onClick={() => undo(r)}>
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {searching && (
        <CardSearch
          onClose={() => setSearching(false)}
          onPick={(card) => {
            added(card);
            setSearching(false);
          }}
        />
      )}
    </div>
  );
}
