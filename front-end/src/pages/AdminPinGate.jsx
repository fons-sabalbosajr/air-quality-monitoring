/**
 * AdminPinGate — wraps all /admin routes with PIN authentication.
 *
 * Flow:
 *   1. Fetch /api/admin/auth/status
 *   2a. sessionStorage has a valid token → render children immediately
 *   2b. pinSet = false  → show first-time PIN setup UI
 *   2c. pinSet = true   → show PIN login UI
 *   2d. "Forgot PIN?"   → email → OTP → new PIN flow
 */
import { useState, useEffect, useCallback } from "react";
import Swal from "sweetalert2";
import { getApiBase } from "../util/apiBase";

const SESSION_KEY = "admin-pin-token";

/* ── Dark mode detection (mirrors App.jsx: watches .dark on <html>) ── */
function useDark() {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains("dark"))
    );
    obs.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

/* ── API helpers ──────────────────────────────────────────────── */
function api(path, opts = {}) {
  const base = getApiBase();
  return fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    ...opts,
  });
}

/* ── PIN input component ──────────────────────────────────────── */
function PinInput({ value, onChange, label, placeholder = "Enter 6-digit PIN", autoFocus }) {
  const dark = useDark();
  const inputBorder = dark ? "#334155" : "#d1d5db";
  return (
    <div style={{ marginBottom: 18 }}>
      {label && (
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: dark ? "#cbd5e1" : "#374151", marginBottom: 6 }}>
          {label}
        </label>
      )}
      <input
        type="password"
        inputMode="numeric"
        pattern="\d{6}"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{
          width: "100%",
          padding: "10px 14px",
          fontSize: 22,
          letterSpacing: "0.25em",
          borderRadius: 8,
          border: `1.5px solid ${inputBorder}`,
          outline: "none",
          textAlign: "center",
          fontFamily: "monospace",
          background: dark ? "#0f172a" : "#f9fafb",
          color: dark ? "#e2e8f0" : "inherit",
          transition: "border-color 0.2s",
        }}
        onFocus={(e) => (e.target.style.borderColor = dark ? "#69b1ff" : "#1677ff")}
        onBlur={(e) => (e.target.style.borderColor = inputBorder)}
      />
    </div>
  );
}

/* ── Card shell ───────────────────────────────────────────────── */
function GateCard({ title, subtitle, children }) {
  const dark = useDark();
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: dark ? "#0f172a" : "linear-gradient(135deg,#f0f5ff 0%,#e8f4fd 100%)",
    }}>
      <div style={{
        background: dark ? "#1e293b" : "#fff",
        borderRadius: 16,
        padding: "44px 40px 36px",
        width: 420,
        maxWidth: "92vw",
        boxShadow: dark ? "0 8px 40px rgba(0,0,0,0.5)" : "0 8px 40px rgba(0,60,180,0.10)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🔐</div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: dark ? "#e2e8f0" : "#1e3a5f" }}>{title}</h2>
          {subtitle && <p style={{ margin: "8px 0 0", fontSize: 14, color: dark ? "#94a3b8" : "#6b7280" }}>{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Submit button ────────────────────────────────────────────── */
function SubmitBtn({ loading, children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      style={{
        width: "100%",
        padding: "11px 0",
        fontSize: 15,
        fontWeight: 600,
        borderRadius: 8,
        border: "none",
        background: loading || disabled ? "#93c5fd" : "#1677ff",
        color: "#fff",
        cursor: loading || disabled ? "not-allowed" : "pointer",
        transition: "background 0.2s",
      }}
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}

/* ── Main gate component ──────────────────────────────────────── */
export default function AdminPinGate({ children }) {
  const dark = useDark();
  // status: 'loading' | 'setup' | 'verify' | 'forgot-email' | 'forgot-otp' | 'forgot-newpin' | 'authenticated'
  const [status, setStatus] = useState("loading");
  const [busy, setBusy]     = useState(false);

  // form fields
  const [pin, setPin]           = useState("");
  const [pin2, setPin2]         = useState("");
  const [email, setEmail]       = useState("");
  const [otp, setOtp]           = useState("");
  const [recEmail, setRecEmail] = useState("");

  /* ── On mount: check status + session ───────────────────────── */
  useEffect(() => {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) { setStatus("authenticated"); return; }

    api("/api/admin/auth/status")
      .then((r) => r.json())
      .then(({ pinSet }) => setStatus(pinSet ? "verify" : "setup"))
      .catch(() => setStatus("verify")); // assume PIN set if unreachable
  }, []);

  /* ── Helpers ─────────────────────────────────────────────────── */
  const storeToken = (token) => {
    sessionStorage.setItem(SESSION_KEY, token);
    setStatus("authenticated");
  };

  const err = useCallback((msg) => {
    Swal.fire({ icon: "error", title: "Error", text: msg, confirmButtonColor: "#1677ff" });
  }, []);

  /* ── First-time setup ────────────────────────────────────────── */
  async function handleSetup() {
    if (pin.length !== 6) return err("PIN must be exactly 6 digits.");
    if (pin !== pin2)   return err("PINs do not match.");
    setBusy(true);
    try {
      const r = await api("/api/admin/auth/setup", {
        method: "POST",
        body: JSON.stringify({ pin, recoveryEmail: recEmail.trim() || undefined }),
      });
      const data = await r.json();
      if (!r.ok) return err(data.error ?? "Setup failed");
      await Swal.fire({ icon: "success", title: "PIN Created", text: "Your admin PIN has been set.", confirmButtonColor: "#1677ff" });
      storeToken(data.token);
    } catch { err("Network error. Please try again."); }
    finally { setBusy(false); }
  }

  /* ── Login ───────────────────────────────────────────────────── */
  async function handleVerify() {
    if (!pin) return err("Please enter your PIN.");
    setBusy(true);
    try {
      const r = await api("/api/admin/auth/verify", {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
      const data = await r.json();
      if (!r.ok) return err(data.error ?? "Incorrect PIN");
      storeToken(data.token);
    } catch { err("Network error. Please try again."); }
    finally { setBusy(false); }
  }

  /* ── Forgot PIN: request OTP ─────────────────────────────────── */
  async function handleResetRequest() {
    if (!email.trim()) return err("Please enter your recovery email.");
    setBusy(true);
    try {
      const r = await api("/api/admin/auth/reset-request", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!r.ok) { const d = await r.json(); return err(d.error ?? "Request failed"); }
      await Swal.fire({
        icon: "info",
        title: "Check Your Email",
        text: "If your email matches the registered recovery address, a 6-digit OTP has been sent.",
        confirmButtonColor: "#1677ff",
      });
      setStatus("forgot-otp");
    } catch { err("Network error. Please try again."); }
    finally { setBusy(false); }
  }

  /* ── Forgot PIN: confirm OTP + new PIN ───────────────────────── */
  async function handleResetConfirm() {
    if (otp.length !== 6) return err("Please enter the 6-digit OTP.");
    if (pin.length !== 6) return err("New PIN must be exactly 6 digits.");
    if (pin !== pin2)     return err("PINs do not match.");
    setBusy(true);
    try {
      const r = await api("/api/admin/auth/reset-confirm", {
        method: "POST",
        body: JSON.stringify({ otp, newPin: pin }),
      });
      const data = await r.json();
      if (!r.ok) return err(data.error ?? "Reset failed");
      await Swal.fire({ icon: "success", title: "PIN Reset", text: "Your PIN has been changed. Please log in.", confirmButtonColor: "#1677ff" });
      setPin(""); setPin2(""); setOtp("");
      setStatus("verify");
    } catch { err("Network error. Please try again."); }
    finally { setBusy(false); }
  }

  /* ── Handle Enter key press ──────────────────────────────────── */
  const onKeyDown = (handler) => (e) => { if (e.key === "Enter") handler(); };

  /* ── Render states ───────────────────────────────────────────── */
  if (status === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: dark ? "#0f172a" : "#f0f5ff" }}>
        <span style={{ fontSize: 15, color: dark ? "#94a3b8" : "#6b7280" }}>Checking authentication…</span>
      </div>
    );
  }

  if (status === "authenticated") return <>{children}</>;

  if (status === "setup") {
    return (
      <GateCard
        title="Create Admin PIN"
        subtitle="Set a 6-digit numeric PIN to protect this admin panel."
      >
        <PinInput label="New PIN" value={pin} onChange={setPin} autoFocus />
        <PinInput label="Confirm PIN" value={pin2} onChange={setPin2} placeholder="Re-enter PIN" />
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: dark ? "#cbd5e1" : "#374151", marginBottom: 6 }}>
            Recovery Email <span style={{ fontWeight: 400, color: dark ? "#64748b" : "#9ca3af" }}>(optional, for PIN reset)</span>
          </label>
          <input
            type="email"
            value={recEmail}
            onChange={(e) => setRecEmail(e.target.value)}
            placeholder="your@email.com"
            onKeyDown={onKeyDown(handleSetup)}
            style={{
              width: "100%", padding: "9px 12px", fontSize: 14, borderRadius: 8,
              border: `1.5px solid ${dark ? "#334155" : "#d1d5db"}`, outline: "none",
              background: dark ? "#0f172a" : "#f9fafb",
              color: dark ? "#e2e8f0" : "inherit",
            }}
          />
        </div>
        <SubmitBtn loading={busy} onClick={handleSetup}>Set PIN &amp; Enter Admin</SubmitBtn>
      </GateCard>
    );
  }

  if (status === "verify") {
    return (
      <GateCard
        title="Admin Login"
        subtitle="Enter your PIN to access the admin panel."
      >
        <PinInput value={pin} onChange={setPin} autoFocus />
        <div onKeyDown={onKeyDown(handleVerify)}>
          <SubmitBtn loading={busy} onClick={handleVerify}>Unlock Admin</SubmitBtn>
        </div>
        <button
          onClick={() => { setStatus("forgot-email"); setPin(""); }}
          style={{
            display: "block", width: "100%", marginTop: 14,
            background: "none", border: "none", color: dark ? "#94a3b8" : "#6b7280",
            fontSize: 13, cursor: "pointer", textDecoration: "underline",
          }}
        >
          Forgot PIN?
        </button>
      </GateCard>
    );
  }

  if (status === "forgot-email") {
    return (
      <GateCard
        title="Reset PIN"
        subtitle="Enter the recovery email registered with your PIN."
      >
        <div style={{ marginBottom: 18 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: dark ? "#cbd5e1" : "#374151", marginBottom: 6 }}>
            Recovery Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            autoFocus
            onKeyDown={onKeyDown(handleResetRequest)}
            style={{
              width: "100%", padding: "9px 12px", fontSize: 14, borderRadius: 8,
              border: `1.5px solid ${dark ? "#334155" : "#d1d5db"}`, outline: "none",
              background: dark ? "#0f172a" : "#f9fafb",
              color: dark ? "#e2e8f0" : "inherit",
            }}
          />
        </div>
        <SubmitBtn loading={busy} onClick={handleResetRequest}>Send OTP</SubmitBtn>
        <button
          onClick={() => setStatus("verify")}
          style={{
            display: "block", width: "100%", marginTop: 14,
            background: "none", border: "none", color: dark ? "#94a3b8" : "#6b7280",
            fontSize: 13, cursor: "pointer", textDecoration: "underline",
          }}
        >
          ← Back to login
        </button>
      </GateCard>
    );
  }

  if (status === "forgot-otp") {
    return (
      <GateCard
        title="Enter OTP &amp; New PIN"
        subtitle="Check your email for the 6-digit code."
      >
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: dark ? "#cbd5e1" : "#374151", marginBottom: 6 }}>
            6-Digit OTP
          </label>
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            autoFocus
            placeholder="______"
            style={{
              width: "100%", padding: "10px 14px", fontSize: 26, textAlign: "center",
              letterSpacing: "0.3em", borderRadius: 8,
              border: `1.5px solid ${dark ? "#334155" : "#d1d5db"}`, outline: "none",
              fontFamily: "monospace",
              background: dark ? "#0f172a" : "#f9fafb",
              color: dark ? "#e2e8f0" : "inherit",
            }}
          />
        </div>
        <PinInput label="New PIN" value={pin} onChange={setPin} />
        <PinInput label="Confirm New PIN" value={pin2} onChange={setPin2} placeholder="Re-enter new PIN" />
        <SubmitBtn loading={busy} onClick={handleResetConfirm}>Reset PIN</SubmitBtn>
        <button
          onClick={() => setStatus("verify")}
          style={{
            display: "block", width: "100%", marginTop: 14,
            background: "none", border: "none", color: dark ? "#94a3b8" : "#6b7280",
            fontSize: 13, cursor: "pointer", textDecoration: "underline",
          }}
        >
          ← Back to login
        </button>
      </GateCard>
    );
  }

  return null;
}
