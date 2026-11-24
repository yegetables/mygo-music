import React from "react";
import { IS_NATIVE, PLATFORM, postNative } from "../api";
import { formatBytes } from "../i18n";
import type { UpdateDownloadProgress, UpdateRelease } from "../types";
import { Icon } from "./Icons";

interface UpdateModalProps {
  release: UpdateRelease | null;
  progress: UpdateDownloadProgress | null;
  onClose: () => void;
  onSkip: (version: string) => void;
  t: (k: string) => string;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ release, progress, onClose, onSkip, t }) => {
  if (!release) return null;

  const isDownloading = progress?.state === "downloading";
  const downloadUrl = release.downloadUrl || release.releaseUrl || "";

  const handlePrimaryAction = () => {
    if (!downloadUrl) return;
    if (IS_NATIVE && release.canDirectInstall) {
      postNative("downloadAndInstallUpdate", {
        url: downloadUrl,
        version: release.latestVersion,
      });
      return;
    }
    if (IS_NATIVE) {
      postNative("openExternal", { url: downloadUrl });
    } else {
      window.open(downloadUrl, "_blank");
    }
  };

  const primaryLabel = release.canDirectInstall
    ? t("Download and Install")
    : PLATFORM === "ios" && release.downloadUrl
    ? t("Download IPA")
    : t("Open Release Page");

  return (
    <div className="modal-mask" onClick={() => !isDownloading && onClose()}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="download" size={20} />
            <h3 style={{ margin: 0 }}>{t("New Version Available")}</h3>
          </div>
          <span className="badge">v{release.latestVersion}</span>
        </div>

        <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 12 }}>
          {t("Current Version")}: v{release.currentVersion} → v{release.latestVersion} ·{" "}
          {release.channel === "fork" ? `${t("My Fork")} (${release.repo})` : `${t("Official Upstream")} (${release.repo})`}
          {release.assetSize ? ` · ${formatBytes(release.assetSize)}` : ""}
        </div>

        {release.notes && (
          <div
            style={{
              maxHeight: 220,
              overflowY: "auto",
              padding: 12,
              borderRadius: 10,
              background: "var(--bg-soft)",
              fontSize: 13,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              marginBottom: 14,
              color: "var(--text-1)",
            }}
          >
            {release.notes}
          </div>
        )}

        {isDownloading && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-2)", marginBottom: 6 }}>
              <span>{t("Downloading...")}</span>
              <span>{progress?.percent ?? 0}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${progress?.percent ?? 0}%`,
                  height: "100%",
                  background: "var(--accent)",
                  transition: "width 0.15s linear",
                }}
              />
            </div>
          </div>
        )}

        {progress?.state === "error" && (
          <div style={{ fontSize: 12, color: "#ff6b6b", marginBottom: 12 }}>
            {progress.error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {downloadUrl && (
            <button className="btn btn-primary" disabled={isDownloading} onClick={handlePrimaryAction}>
              <Icon name="download" size={16} /> {primaryLabel}
            </button>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn"
              style={{ flex: 1 }}
              disabled={isDownloading}
              onClick={() => onSkip(release.latestVersion)}
            >
              {t("Skip This Version")}
            </button>
            <button className="btn" style={{ flex: 1 }} disabled={isDownloading} onClick={onClose}>
              {t("Remind Later")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
