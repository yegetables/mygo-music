import React, { useEffect, useState } from "react";
import { api, IS_NATIVE, postNative } from "../api";
import { formatBytes } from "../i18n";
import type { CacheStats, MobileSettings, PendingPlugin, SourceSummary } from "../types";
import { Icon } from "../components/Icons";

interface SettingsPageProps {
  settings: MobileSettings;
  sources: SourceSummary[];
  onUpdateSettings: (patch: Partial<MobileSettings>) => Promise<void>;
  onRefreshSources: () => Promise<void>;
  onOpenInstall: (pending?: PendingPlugin) => void;
  onToast: (msg: string) => void;
  t: (k: string) => string;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  sources,
  onUpdateSettings,
  onRefreshSources,
  onOpenInstall,
  onToast,
  t,
}) => {
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");

  const plugins = sources.filter((s) => !s.builtin);

  useEffect(() => {
    api.getCacheStats().then(setCacheStats).catch(() => {});
    api.getLocalFolders().then((r) => setFolders(r.folders || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const map: Record<string, string> = {};
    for (const p of plugins) {
      for (const st of p.info.settings || []) {
        map[`${p.info.id}:${st.key}`] = p.settings[st.key] ?? "";
      }
    }
    setDrafts(map);
  }, [sources]);

  const savePluginSetting = async (pluginId: string, key: string, value: string) => {
    try {
      await api.setSourceSetting(pluginId, key, value);
      await onRefreshSources();
      onToast("已保存设置");
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCheckUpdate = async (p: SourceSummary) => {
    setBusyId(p.info.id);
    try {
      const res = await api.checkPluginUpdate(p.info.id);
      if (!res.hasUpdate) {
        onToast(`${p.info.name}: 已是最新版本`);
        return;
      }
      if (res.repo) {
        const pending = await api.preparePluginGitHub(res.repo);
        onOpenInstall(pending);
      }
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  };

  const handleReload = async (p: SourceSummary) => {
    setBusyId(p.info.id);
    try {
      await api.reloadPlugin(p.info.id);
      await onRefreshSources();
      onToast(`已重载 ${p.info.name}`);
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  };

  const handleRemove = async (p: SourceSummary) => {
    if (!window.confirm(`确定移除插件 ${p.info.name}？其账号数据会保留。`)) return;
    setBusyId(p.info.id);
    try {
      await api.removePlugin(p.info.id);
      await onRefreshSources();
      onToast(`已移除 ${p.info.name}`);
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  };

  const handleImportAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    try {
      const res = await api.importLocalFiles(files);
      const fld = await api.getLocalFolders();
      setFolders(fld.folders || []);
      onToast(`已导入 ${res.imported.length} 个音频文件`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div>
      <div className="page-header" style={{ justifyContent: "space-between" }}>
        <h1>{t("Settings")}</h1>
        <button className="btn btn-primary" onClick={() => onOpenInstall()}>
          <Icon name="plus" size={16} /> {t("Install Plugin")}
        </button>
      </div>

      {/* Installed Plugins */}
      <div className="settings-group">
        <h3>{t("Plugins")}</h3>
        {plugins.length === 0 ? (
          <div style={{ color: "var(--text-2)", fontSize: 14, padding: "8px 0" }}>
            尚未安装任何插件。点击右上角「{t("Install Plugin")}」可导入本地 `.zip`（如网易云插件）或从 GitHub 安装。
          </div>
        ) : (
          plugins.map((p) => (
            <div
              key={p.info.id}
              style={{
                padding: "12px 0",
                borderTop: "1px solid var(--border)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    {p.info.name}{" "}
                    <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-2)" }}>
                      v{p.info.version || "dev"}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                    {p.info.id}
                    {p.origin?.repo ? ` · ${p.origin.repo}` : " · Local ZIP"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {p.origin?.repo && (
                    <button className="btn" disabled={busyId === p.info.id} onClick={() => handleCheckUpdate(p)}>
                      {t("Check Update")}
                    </button>
                  )}
                  <button className="btn" disabled={busyId === p.info.id} onClick={() => handleReload(p)}>
                    {t("Reload")}
                  </button>
                  <button className="btn btn-danger" disabled={busyId === p.info.id} onClick={() => handleRemove(p)}>
                    {t("Remove")}
                  </button>
                </div>
              </div>

              {/* Dynamic plugin settings */}
              {(p.info.settings || []).map((st) => {
                const dk = `${p.info.id}:${st.key}`;
                const val = drafts[dk] ?? "";
                return (
                  <div key={st.key} style={{ paddingLeft: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 160, flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{st.label}</div>
                        {st.help && (
                          <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>{st.help}</div>
                        )}
                        {st.link && (
                          <button
                            style={{ fontSize: 12, color: "var(--accent)", marginTop: 2 }}
                            onClick={() => {
                              if (IS_NATIVE) postNative("openExternal", { url: st.link });
                              else window.open(st.link, "_blank");
                            }}
                          >
                            {st.link}
                          </button>
                        )}
                      </div>

                      {st.type === "boolean" ? (
                        <input
                          type="checkbox"
                          checked={val === "true"}
                          style={{ width: 20, height: 20, accentColor: "var(--accent)" }}
                          onChange={(e) => {
                            const next = e.target.checked ? "true" : "false";
                            setDrafts((d) => ({ ...d, [dk]: next }));
                            savePluginSetting(p.info.id, st.key, next);
                          }}
                        />
                      ) : st.type === "select" && st.options?.length ? (
                        <select
                          className="form-select"
                          value={val}
                          onChange={(e) => {
                            const next = e.target.value;
                            setDrafts((d) => ({ ...d, [dk]: next }));
                            savePluginSetting(p.info.id, st.key, next);
                          }}
                        >
                          <option value="">--</option>
                          {st.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type={st.type === "password" ? "password" : "text"}
                            className="form-input"
                            value={val}
                            onChange={(e) => setDrafts((d) => ({ ...d, [dk]: e.target.value }))}
                            onBlur={() => {
                              if (val !== (p.settings[st.key] ?? "")) {
                                savePluginSetting(p.info.id, st.key, val);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") savePluginSetting(p.info.id, st.key, val);
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Playback & Appearance */}
      <div className="settings-group">
        <h3>{t("Audio Quality")} & {t("Theme")}</h3>
        <div className="setting-row">
          <span>{t("Audio Quality")}</span>
          <select
            className="form-select"
            value={settings.quality}
            onChange={(e) => onUpdateSettings({ quality: e.target.value })}
          >
            <option value="standard">{t("Standard")}</option>
            <option value="high">{t("High")}</option>
            <option value="lossless">{t("Lossless")}</option>
          </select>
        </div>
        <div className="setting-row">
          <span>{t("Theme")}</span>
          <select
            className="form-select"
            value={settings.theme}
            onChange={(e) => onUpdateSettings({ theme: e.target.value })}
          >
            <option value="system">{t("System")}</option>
            <option value="dark">{t("Dark")}</option>
            <option value="light">{t("Light")}</option>
          </select>
        </div>
        <div className="setting-row">
          <span>{t("Language")}</span>
          <select
            className="form-select"
            value={settings.language}
            onChange={(e) => onUpdateSettings({ language: e.target.value })}
          >
            <option value="system">{t("System")}</option>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {/* Local Music */}
      <div className="settings-group">
        <h3>{t("Local Music")}</h3>
        <div className="setting-row" style={{ flexWrap: "wrap" }}>
          <label className="btn btn-primary" style={{ cursor: "pointer" }}>
            <Icon name="folder" size={16} />
            {t("Import Audio Files")}
            <input
              type="file"
              multiple
              accept=".mp3,.flac,.m4a,.aac,.ogg,.wav,audio/*"
              style={{ display: "none" }}
              onChange={handleImportAudio}
            />
          </label>
          <button
            className="btn"
            onClick={() => api.rescanLocal().then(() => onToast("正在扫描本地音乐..."))}
          >
            {t("Rescan")}
          </button>
        </div>
        {folders.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-2)" }}>
            {folders.map((f) => (
              <div key={f} style={{ padding: "4px 0", wordBreak: "break-all" }}>
                {f}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Storage & Cache */}
      <div className="settings-group">
        <h3>{t("Storage")}</h3>
        <div className="setting-row">
          <span>{t("Cache Limit")}</span>
          <select
            className="form-select"
            value={settings.cacheLimitMB}
            onChange={(e) => onUpdateSettings({ cacheLimitMB: Number(e.target.value) })}
          >
            <option value={128}>128 MB</option>
            <option value={256}>256 MB</option>
            <option value={512}>512 MB</option>
            <option value={1024}>1 GB</option>
            <option value={2048}>2 GB</option>
          </select>
        </div>
        <div className="setting-row">
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>
            {cacheStats
              ? `${formatBytes(cacheStats.totalBytes)} / ${cacheStats.limitMB} MB`
              : "..."}
          </span>
          <button
            className="btn btn-danger"
            onClick={() =>
              api.clearCache().then((st) => {
                setCacheStats(st);
                onToast("缓存已清理");
              })
            }
          >
            {t("Clear Cache")}
          </button>
        </div>
      </div>
    </div>
  );
};
