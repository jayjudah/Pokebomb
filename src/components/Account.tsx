import { useState } from "react";
import { cloudEnabled, sendCode, signOut, syncNow, useCloud, verifyCode } from "../lib/cloud";
import { unsyncedChanges } from "../lib/collection";

function ago(t: number) {
  if (!t) return "not yet";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return "just now";
  if (s < 90) return `${s}s ago`;
  return `${Math.round(s / 60)} min ago`;
}

export function SyncChip() {
  const c = useCloud();
  if (!cloudEnabled || !c.email) return null;
  const label =
    c.sync === "syncing"
      ? "Syncing…"
      : c.sync === "offline"
        ? `Offline${c.pending ? ` · ${c.pending} waiting` : ""}`
        : c.sync === "error"
          ? "Sync problem"
          : c.pending
            ? `${c.pending} waiting`
            : "Synced";
  return <span className={`sync-chip sync-${c.sync}`}>☁ {label}</span>;
}

export default function Account() {
  const c = useCloud();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  if (!cloudEnabled) {
    return (
      <p className="muted">
        Accounts aren't set up for this copy of the app yet, so the collection is saved on this device only. Use Export
        backup to keep a copy.
      </p>
    );
  }
  if (!c.ready) return <p className="muted">Checking sign-in…</p>;

  if (c.email) {
    return (
      <>
        <p>
          Signed in as <b>{c.email}</b>. Your collection syncs to every device you sign in on, and only this account
          can see or change it.
        </p>
        {c.merged > 0 && <p className="muted small">Added {c.merged} cards from this device to your account.</p>}
        <p className="muted small">
          {c.sync === "error" ? `Sync problem: ${c.error}` : c.sync === "offline" ? "Offline: changes are saved here and will sync when you're back online." : `Last synced ${ago(c.lastSynced)}`}
          {c.pending > 0 ? ` · ${c.pending} changes waiting` : ""}
        </p>
        <div className="row wrap">
          <button onClick={syncNow}>Sync now</button>
          <button
            onClick={() => {
              const waiting = unsyncedChanges();
              if (
                waiting &&
                !confirm(`${waiting} changes haven't synced yet and will be lost if you sign out now. Sign out anyway?`)
              )
                return;
              void signOut();
            }}
          >
            Sign out
          </button>
        </div>
        <p className="muted small">Signing out removes the collection from this device. It stays safe in your account.</p>
      </>
    );
  }

  return (
    <form
      className="signin"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg("");
        try {
          if (step === "email") {
            await sendCode(email);
            setStep("code");
            setMsg(`We emailed a 6-digit code to ${email}.`);
          } else {
            await verifyCode(email, code);
          }
        } catch (err) {
          setMsg((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="muted">
        Sign in to keep your collection in sync across your phone, tablet and computer. Cards already on this device
        are added to your account.
      </p>
      {step === "email" ? (
        <label className="field">
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      ) : (
        <label className="field">
          6-digit code
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6,10}"
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
        </label>
      )}
      {msg && <p className="muted small">{msg}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>
          {busy ? "…" : step === "email" ? "Email me a code" : "Sign in"}
        </button>
        {step === "code" && (
          <button type="button" onClick={() => setStep("email")}>
            Use a different email
          </button>
        )}
      </div>
    </form>
  );
}
