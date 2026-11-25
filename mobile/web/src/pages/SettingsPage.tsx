import React, { useEffect, useState } from "react";
import { api, IS_NATIVE, postNative } from "../api";
import { formatBytes } from "../i18n";
import type {
  CacheStats,
  GitHubProxyMode,
  MobileSettings,
  PendingPlugin,
  PlayerStyle,
  SourceSummary,
  UpdateChannel,
  UpdateRelease,
  UpdateStatus,
} from "../types";
import { Icon } from "../components/Icons";

interface SettingsPageProps {
  settings: MobileSettings;
  sources: SourceSummary[];
  updateStatus: UpdateStatus | null;
  checkingUpdate: boolean;
  onUpdateSettings: (patch: Partial<MobileSettings>) => Promise<void>;
  onRefreshSources: () => Promise<void>;
  onOpenInstall: (pending?: PendingPlugin) => void;
  onCheckAppUpdate: () => Promise<UpdateRelease | null>;
  onToast: (msg: string) => void;
  t: (k: string) => string;
}

const Switch: React.FC<{ checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }> = ({
  checked,
  disabled,
  onChange,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    className={`oc-switch-btn ${checked ? "on" : ""}`}
    onClick={() => !disabled && onChange(!checked)}
  >
    <span className="oc-switch-knob" />
  </button>
);

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  sources,
  updateStatus,
  checkingUpdate,
  onUpdateSettings,
  onRefreshSources,
  onOpenInstall,
  onCheckAppUpdate,
  onToast,
  t,
}) => {
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [customProxyDraft, setCustomProxyDraft] = useState(settings.githubProxyCustomUrl || "");
  const [savingProxy, setSavingProxy] = useState(false);
  const [busyId, setBusyId] = useState("");

  const plugins = sources.filter((s) => !s.builtin);
  const enabledCount = sources.filter((s) => !s.disabled).length;
  const anyComments = sources.some((s) => !s.disabled && s.capabilities.comments);

  useEffect(() => {
    api.getCacheStats().then(setCacheStats).catch(() => {});
    api.getLocalFolders().then((r) => setFolders(r.folders || [])).catch(() => {});
  }, [settings.cacheLimitMB]);

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

  const handleToggleSourceEnabled = async (src: SourceSummary, enable: boolean) => {
    const disabledSet = new Set(settings.disabledPlugins || []);
    if (enable) {
      disabledSet.delete(src.info.id);
    } else {
      if (enabledCount <= 1) return;
      disabledSet.add(src.info.id);
    }
    const nextDisabled = Array.from(disabledSet);
    const patch: Partial<MobileSettings> = { disabledPlugins: nextDisabled };
    if (!enable && settings.activeSource === src.info.id) {
      const fallback = sources.find((s) => s.info.id !== src.info.id && !disabledSet.has(s.info.id));
      if (fallback) patch.activeSource = fallback.info.id;
    }
    await onUpdateSettings(patch);
    await onRefreshSources();
  };

  const handleCheckPluginUpdate = async (p: SourceSummary) => {
    setBusyId(p.info.id);
    try {
      const res = await api.checkPluginUpdate(p.info.id);
      if (!res.hasUpdate) {
        onToast(`${p.info.name}: ${t("Up to date")}`);
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

  useEffect(() => {
    setCustomProxyDraft(settings.githubProxyCustomUrl || "");
  }, [settings.githubProxyCustomUrl]);

  const handleSaveCustomProxy = async () => {
    const trimmed = customProxyDraft.trim();
    setSavingProxy(true);
    try {
      await onUpdateSettings({
        githubProxyMode: "custom",
        githubProxyCustomUrl: trimmed,
      });
      onToast("已保存设置");
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingProxy(false);
    }
  };

  const proxyOptions: { id: GitHubProxyMode; title: string; sub: string }[] = [
    { id: "gh-proxy.com", title: "gh-proxy.com", sub: "https://gh-proxy.com" },
    { id: "gh-proxy.org", title: "gh-proxy.org", sub: "https://gh-proxy.org" },
    {
      id: "custom",
      title: t("Custom Proxy"),
      sub: (settings.githubProxyCustomUrl || "").trim() || t("Custom Proxy Sub"),
    },
  ];

  const channels = updateStatus?.channels || [
    { id: "fork" as UpdateChannel, repo: "yegetables/mygo-music", supported: true },
    { id: "official" as UpdateChannel, repo: "egoist/mygo-music", supported: false, reason: t("Unsupported on this platform") },
  ];

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="page-header" style={{ justifyContent: "space-between" }}>
        <h1>{t("Settings")}</h1>
        <button className="btn btn-primary" onClick={() => onOpenInstall()}>
          <Icon name="plus" size={16} /> {t("Install Plugin")}
        </button>
      </div>

      {/* 1. General */}
      <div className="settings-group">
        <h3>{t("General")}</h3>

        <div className="setting-row">
          <div className="setting-meta">
            <div className="setting-label">{t("Language")}</div>
          </div>
          <select
            className="form-select"
            value={settings.language}
            onChange={(e) => onUpdateSettings({ language: e.target.value })}
          >
            <option value="system">{t("Follow System")}</option>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>

        <div className="setting-row">
          <div className="setting-meta">
            <div className="setting-label">{t("Appearance")}</div>
          </div>
          <div className="segmented">
            {(
              [
                ["system", "System"],
                ["light", "Light"],
                ["dark", "Dark"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={`segmented-item ${settings.theme === val ? "active" : ""}`}
                onClick={() => onUpdateSettings({ theme: val })}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-meta">
            <div className="setting-label">{t("Now Playing Style")}</div>
            <div className="setting-desc">{t("Now Playing Style Help")}</div>
          </div>
          <select
            className="form-select"
            value={settings.playerStyle}
            onChange={(e) => onUpdateSettings({ playerStyle: e.target.value as PlayerStyle })}
          >
            <option value="">{t("Cover")}</option>
            <option value="vinyl">{t("Vinyl")}</option>
            <option value="cassette">{t("Cassette")}</option>
          </select>
        </div>
      </div>

      {/* 2. Playback */}
      <div className="settings-group">
        <h3>{t("Playback")}</h3>

        <div className="setting-row">
          <div className="setting-meta">
            <div className="setting-label">{t("Quality")}</div>
          </div>
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

        {anyComments && (
          <div className="setting-row">
            <div className="setting-meta">
              <div className="setting-label">{t("Top Comments in Quiet Parts")}</div>
              <div className="setting-desc">{t("Top Comments Help")}</div>
            </div>
            <Switch
              checked={settings.hotComments}
              onChange={(v) => onUpdateSettings({ hotComments: v })}
            />
          </div>
        )}

        <div className="setting-row">
          <div className="setting-meta">
            <div className="setting-label">{t("Even Out Loudness")}</div>
            <div className="setting-desc">{t("Even Out Loudness Help")}</div>
          </div>
          <Switch
            checked={settings.normalize}
            onChange={(v) => onUpdateSettings({ normalize: v })}
          />
        </div>
      </div>

      {/* 3. Experiments */}
      <div className="settings-group">
        <h3>{t("Experiments")}</h3>

        <div className="setting-row">
          <div className="setting-meta">
            <div className="setting-label">{t("Smoke on the Progress Bar")}</div>
            <div className="setting-desc">{t("Smoke Help")}</div>
          </div>
          <Switch
            checked={settings.smoke}
            onChange={(v) => onUpdateSettings({ smoke: v })}
          />
        </div>

        <div className="setting-row">
          <div className="setting-meta">
            <div className="setting-label">{t("Fog Backdrop")}</div>
            <div className="setting-desc">{t("Fog Help")}</div>
          </div>
          <Switch
            checked={settings.fog}
            onChange={(v) => onUpdateSettings({ fog: v })}
          />
        </div>

        <div className="setting-row">
          <div className="setting-meta">
            <div className="setting-label">{t("Grow From the Cover")}</div>
            <div className="setting-desc">{t("Grow From Cover Help")}</div>
          </div>
          <Switch
            checked={settings.growFromCover}
            onChange={(v) => onUpdateSettings({ growFromCover: v })}
          />
        </div>
      </div>

      {/* 4. Cache */}
      <div className="settings-group">
        <h3>{t("Cache")}</h3>
        <div className="setting-row">
          <div className="setting-meta">
            <div className="setting-label">{t("Song Cache")}</div>
          </div>
          <select
            className="form-select"
            value={settings.cacheLimitMB}
            onChange={(e) => onUpdateSettings({ cacheLimitMB: Number(e.target.value) })}
          >
            <option value={0}>{t("Off")}</option>
            {settings.cacheLimitMB > 0 &&
              ![1024, 2048, 5120, 10240].includes(settings.cacheLimitMB) && (
                <option value={settings.cacheLimitMB}>{settings.cacheLimitMB} MB</option>
              )}
            <option value={1024}>1 GB</option>
            <option value={2048}>2 GB</option>
            <option value={5120}>5 GB</option>
            <option value={10240}>10 GB</option>
          </select>
        </div>
        <div className="setting-row">
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>
            {cacheStats
              ? `${formatBytes(cacheStats.totalBytes)} / ${
                  cacheStats.limitMB === 0 ? t("Off") : `${cacheStats.limitMB} MB`
                }`
              : "..."}
          </span>
          <button
            className="btn btn-danger"
            disabled={!cacheStats || cacheStats.totalBytes <= 0}
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

      {/* 4.5 Network / GitHub Proxy */}
      <div className="settings-group">
        <h3>{t("Network")}</h3>

        <div className="setting-row">
          <div className="setting-meta">
            <div className="setting-label">{t("GitHub Proxy")}</div>
            <div className="setting-desc">{t("GitHub Proxy Help")}</div>
          </div>
          <Switch
            checked={!!settings.githubProxyEnabled}
            onChange={(v) =>
              onUpdateSettings({
                githubProxyEnabled: v,
                githubProxyMode: settings.githubProxyMode || "gh-proxy.com",
              }).catch((e) => onToast(e instanceof Error ? e.message : String(e)))
            }
          />
        </div>

        {settings.githubProxyEnabled && (
          <>
            <div className="setting-row setting-row-stack">
              <div className="setting-meta">
                <div className="setting-label">{t("Proxy Service")}</div>
              </div>
              <div className="proxy-picker" role="radiogroup" aria-label={t("Proxy Service")}>
                {proxyOptions.map((opt) => {
                  const selected = (settings.githubProxyMode || "gh-proxy.com") === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`channel-option ${selected ? "selected" : ""}`}
                      onClick={() => {
                        if (!selected) {
                          onUpdateSettings({ githubProxyMode: opt.id }).catch((e) =>
                            onToast(e instanceof Error ? e.message : String(e))
                          );
                        }
                      }}
                    >
                      <div className="channel-title">
                        {opt.title}
                        {selected && <span className="badge" style={{ marginLeft: 6 }}>✓</span>}
                      </div>
                      <div className="channel-sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {opt.sub}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {settings.githubProxyMode === "custom" && (
              <div className="setting-row setting-row-stack" style={{ gap: 8 }}>
                <div className="setting-meta">
                  <div className="setting-label">{t("Custom Proxy URL")}</div>
                  <div className="setting-desc">{t("Custom Proxy Help")}</div>
                </div>
                <div className="proxy-custom-row">
                  <input
                    className="form-input"
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    placeholder="https://your-proxy.example.com"
                    value={customProxyDraft}
                    onChange={(e) => setCustomProxyDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveCustomProxy();
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={savingProxy}
                    onClick={handleSaveCustomProxy}
                  >
                    {t("Save Setting")}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 5. Updates (Fork default + Official channel greyed out on unsupported mobile platforms) */}
      <div className="settings-group">
        <h3>{t("Updates")}</h3>

        <div className="setting-row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
          <div className="setting-meta">
            <div className="setting-label">{t("Update Channel")}</div>
            <div className="setting-desc">{t("Update Channel Help")}</div>
          </div>
          <div className="channel-picker" role="radiogroup" aria-label={t("Update Channel")}>
            {channels.map((ch) => {
              const selected = (updateStatus?.channel || settings.updateChannel) === ch.id;
              const disabled = !ch.supported;
              return (
                <button
                  key={ch.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  title={disabled ? ch.reason || t("Unsupported on this platform") : ch.repo}
                  className={`channel-option ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}`}
                  onClick={() => {
                    if (!disabled && !selected) {
                      onUpdateSettings({ updateChannel: ch.id }).catch((e) =>
                        onToast(e instanceof Error ? e.message : String(e))
                      );
                    }
                  }}
                >
                  <div className="channel-title">
                    {ch.id === "fork" ? t("My Fork") : t("Official Upstream")}
                    {selected && <span className="badge" style={{ marginLeft: 6 }}>✓</span>}
                  </div>
                  <div className="channel-sub">{ch.repo}</div>
                  {disabled && (
                    <div className="channel-unavail">
                      {ch.reason ? t(ch.reason) : t("Unsupported on this platform")}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-meta">
            <div className="setting-label">{t("Check for Updates Automatically")}</div>
          </div>
          <Switch
            checked={settings.autoCheckUpdates}
            onChange={(v) => onUpdateSettings({ autoCheckUpdates: v })}
          />
        </div>

        <div className="setting-row">
          <div className="setting-meta">
            <div className="setting-label">
              {t("Current Version")}: v{updateStatus?.currentVersion || "0.1.25"}
            </div>
            {settings.lastUpdateCheck && (
              <div className="setting-desc">
                {new Date(settings.lastUpdateCheck).toLocaleString()}
              </div>
            )}
          </div>
          <button
            className="btn"
            disabled={checkingUpdate}
            onClick={() => onCheckAppUpdate()}
          >
            {checkingUpdate ? t("Checking...") : t("Check for Updates")}
          </button>
        </div>
      </div>

      {/* 6. Plugins */}
      <div className="settings-group">
        <h3>{t("Plugins")}</h3>
        {plugins.length === 0 ? (
          <div style={{ color: "var(--text-2)", fontSize: 14, padding: "8px 0" }}>
            尚未安装任何插件。点击右上角「{t("Install Plugin")}」可导入本地 `.zip`（如网易云音乐插件）或 GitHub 仓库。
          </div>
        ) : (
          plugins.map((p) => (
            <div
              key={p.info.id}
              style={{
                borderTop: "1px solid var(--border)",
                padding: "14px 0",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                opacity: p.disabled ? 0.65 : 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    {p.info.name}
                    {p.info.version && (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        v{p.info.version}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-2)" }}>
                    ID: {p.info.id}
                    {p.origin?.repo ? ` · ${p.origin.repo}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Switch
                    checked={!p.disabled}
                    disabled={!p.disabled && enabledCount <= 1}
                    onChange={(v) => handleToggleSourceEnabled(p, v)}
                  />
                  {p.origin?.repo && (
                    <button className="btn" disabled={busyId === p.info.id} onClick={() => handleCheckPluginUpdate(p)}>
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
                            style={{ fontSize: 12, color: "var(--accent)", marginTop: 2, wordBreak: "break-all", textAlign: "left" }}
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
                        <Switch
                          checked={val === "true"}
                          onChange={(v) => {
                            const next = v ? "true" : "false";
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
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", maxWidth: "100%", flex: "1 1 160px" }}>
                          <input
                            type={st.type === "password" ? "password" : "text"}
                            className="form-input"
                            style={{ flex: 1, minWidth: 0 }}
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

      {/* 7. Local Music */}
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
    </div>
  );
};
