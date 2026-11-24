import React, { useState } from "react";
import { api, IS_NATIVE, postNative, qrImageUrl } from "../api";
import type { PendingPlugin, SignInPromptPayload } from "../types";
import { Icon } from "./Icons";

interface PluginInstallModalProps {
  open: boolean;
  initialPending?: PendingPlugin | null;
  onClose: () => void;
  onInstalled: (pluginId: string) => void;
  t: (k: string) => string;
}

export const PluginInstallModal: React.FC<PluginInstallModalProps> = ({
  open,
  initialPending,
  onClose,
  onInstalled,
  t,
}) => {
  const [tab, setTab] = useState<"zip" | "github" | "url">("zip");
  const [repo, setRepo] = useState("");
  const [archiveUrl, setArchiveUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingPlugin | null>(initialPending || null);

  React.useEffect(() => {
    if (initialPending) setPending(initialPending);
  }, [initialPending]);

  if (!open) return null;

  const handleClose = () => {
    if (pending) {
      api.discardPlugin(pending.pendingId).catch(() => {});
      setPending(null);
    }
    setError("");
    onClose();
  };

  const handleZipSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.preparePluginUpload(file);
      setPending(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const handleGitHub = async () => {
    if (!repo.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.preparePluginGitHub(repo.trim());
      setPending(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleURL = async () => {
    if (!archiveUrl.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.preparePluginURL(archiveUrl.trim());
      setPending(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!pending) return;
    setBusy(true);
    setError("");
    try {
      const installed = await api.confirmPlugin(pending.pendingId, true);
      setPending(null);
      onInstalled(installed.info.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>{t("Install Plugin")}</h3>
          <button className="icon-btn" onClick={handleClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        {!pending ? (
          <>
            <div className="pill-row">
              <button className={`pill ${tab === "zip" ? "active" : ""}`} onClick={() => setTab("zip")}>
                {t("From Local ZIP")}
              </button>
              <button className={`pill ${tab === "github" ? "active" : ""}`} onClick={() => setTab("github")}>
                {t("From GitHub")}
              </button>
              <button className={`pill ${tab === "url" ? "active" : ""}`} onClick={() => setTab("url")}>
                {t("From URL")}
              </button>
            </div>

            {tab === "zip" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <label className="btn btn-primary" style={{ cursor: "pointer" }}>
                  <Icon name="plugin" size={16} />
                  {busy ? "..." : t("Choose .zip plugin archive")}
                  <input
                    type="file"
                    accept=".zip,application/zip,application/x-zip-compressed"
                    style={{ display: "none" }}
                    onChange={handleZipSelect}
                    disabled={busy}
                  />
                </label>
                <div style={{ fontSize: 12, color: "var(--text-2)" }}>
                  支持直接选择 `mygo-music-netease-cloud-music-*.zip` 或任意 MyGo Music 插件压缩包。
                </div>
              </div>
            )}

            {tab === "github" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input
                  className="form-input"
                  placeholder="owner/repo 或 https://github.com/owner/repo"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleGitHub()}
                />
                <button className="btn btn-primary" disabled={busy || !repo.trim()} onClick={handleGitHub}>
                  {busy ? "..." : t("Install")}
                </button>
              </div>
            )}

            {tab === "url" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input
                  className="form-input"
                  placeholder="http://192.168.x.x:8080/plugin.zip"
                  value={archiveUrl}
                  onChange={(e) => setArchiveUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleURL()}
                />
                <button className="btn btn-primary" disabled={busy || !archiveUrl.trim()} onClick={handleURL}>
                  {busy ? "..." : t("Install")}
                </button>
              </div>
            )}
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ padding: 14, borderRadius: 12, background: "var(--bg-card)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 17, fontWeight: 700 }}>{pending.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>
                ID: {pending.id} · v{pending.version || "dev"}
                {pending.repo ? ` · ${pending.repo}` : ""}
              </div>
              {pending.permissions.network && pending.permissions.network.length > 0 && (
                <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 8 }}>
                  Network: {pending.permissions.network.join(", ")}
                </div>
              )}
              {pending.processWarning && (
                <div style={{ fontSize: 12, color: "#fbbf24", marginTop: 8 }}>
                  {t("Process permission warning")}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn" onClick={handleClose} disabled={busy}>
                {t("Cancel")}
              </button>
              <button className="btn btn-primary" onClick={handleConfirm} disabled={busy}>
                {busy ? "..." : pending.updating ? t("Update") : t("Install")}
              </button>
            </div>
          </div>
        )}

        {error && <div style={{ color: "#f87171", fontSize: 13, marginTop: 12 }}>{error}</div>}
      </div>
    </div>
  );
};

interface SignInModalProps {
  prompt: SignInPromptPayload | null;
  statusText: string;
  onClose: () => void;
  t: (k: string) => string;
}

export const SignInModal: React.FC<SignInModalProps> = ({ prompt, statusText, onClose, t }) => {
  if (!prompt && !statusText) return null;
  const qrUrl = prompt?.qr ? qrImageUrl(prompt.qr) : "";

  const handleSaveQR = () => {
    if (!qrUrl) return;
    if (IS_NATIVE) {
      postNative("saveImage", { url: qrUrl, filename: "mygo-signin-qr.png" });
    } else {
      const a = document.createElement("a");
      a.href = qrUrl;
      a.download = "mygo-signin-qr.png";
      a.click();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{t("Sign In")}</h3>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        {qrUrl && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, margin: "12px 0" }}>
            <img
              src={qrUrl}
              alt="QR Code"
              style={{ width: 220, height: 220, borderRadius: 12, background: "#fff", padding: 10 }}
            />
            <button className="btn" onClick={handleSaveQR}>
              {t("Save QR Code")}
            </button>
          </div>
        )}

        <div style={{ fontSize: 14, color: "var(--text-2)", margin: "10px 0" }}>
          {prompt?.text || statusText}
        </div>
      </div>
    </div>
  );
};
