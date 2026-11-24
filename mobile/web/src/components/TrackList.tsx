import React, { useState } from "react";
import { imageProxyUrl } from "../api";
import { formatDuration } from "../i18n";
import type { Playlist, Track } from "../types";
import { Icon } from "./Icons";

interface TrackListProps {
  tracks: Track[];
  currentTrackId?: string;
  likedMap: Record<string, boolean>;
  canLike: boolean;
  playlists: Playlist[];
  canAddToPlaylist: boolean;
  onPlay: (tracks: Track[], index: number) => void;
  onToggleLike: (track: Track) => void;
  onAddToQueue: (track: Track) => void;
  onAddToPlaylist: (playlistId: string, track: Track) => void;
  onOpenArtist?: (artistId: string) => void;
  onOpenAlbum?: (albumId: string) => void;
  t: (k: string) => string;
}

export const TrackList: React.FC<TrackListProps> = ({
  tracks,
  currentTrackId,
  likedMap,
  canLike,
  playlists,
  canAddToPlaylist,
  onPlay,
  onToggleLike,
  onAddToQueue,
  onAddToPlaylist,
  onOpenArtist,
  onOpenAlbum,
  t,
}) => {
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const myPlaylists = playlists.filter((p) => p.mine && !p.fixed);

  return (
    <>
      <div className="track-list">
        {tracks.map((track, idx) => {
          const isPlaying = currentTrackId === track.id;
          const liked = !!likedMap[track.id];
          const art = imageProxyUrl(track.album?.imageUrl, 120);
          return (
            <div
              key={`${track.id}-${idx}`}
              className={`track-row ${isPlaying ? "playing" : ""} ${track.unavailable ? "unavailable" : ""}`}
            >
              <div className="track-thumb" onClick={() => !track.unavailable && onPlay(tracks, idx)}>
                {art ? <img src={art} loading="lazy" alt="" /> : <Icon name="note" size={18} />}
              </div>
              <div className="track-meta" onClick={() => !track.unavailable && onPlay(tracks, idx)}>
                <div className="track-name">{track.name}</div>
                <div className="track-sub">
                  {(track.artists || []).map((a) => a.name).join(", ")}
                  {track.album?.name ? ` · ${track.album.name}` : ""}
                </div>
              </div>
              {canLike && (
                <button
                  className={`icon-btn ${liked ? "accent" : ""}`}
                  aria-label="Like"
                  onClick={() => onToggleLike(track)}
                >
                  <Icon name="heart" size={16} filled={liked} />
                </button>
              )}
              <span className="track-dur">{formatDuration(track.duration)}</span>
              <button className="icon-btn" aria-label="More" onClick={() => setMenuTrack(track)}>
                <Icon name="more" size={16} />
              </button>
            </div>
          );
        })}
      </div>

      {menuTrack && (
        <div className="modal-backdrop" onClick={() => setMenuTrack(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {menuTrack.name}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-2)" }}>
                  {(menuTrack.artists || []).map((a) => a.name).join(", ")}
                </div>
              </div>
              <button className="icon-btn" onClick={() => setMenuTrack(null)}>
                <Icon name="close" size={18} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                className="btn"
                onClick={() => {
                  onAddToQueue(menuTrack);
                  setMenuTrack(null);
                }}
              >
                <Icon name="queue" size={16} /> {t("Add to Queue")}
              </button>

              {onOpenArtist && menuTrack.artists?.[0]?.id && (
                <button
                  className="btn"
                  onClick={() => {
                    onOpenArtist(menuTrack.artists![0].id);
                    setMenuTrack(null);
                  }}
                >
                  <Icon name="artist" size={16} /> {menuTrack.artists[0].name}
                </button>
              )}

              {onOpenAlbum && menuTrack.album?.id && (
                <button
                  className="btn"
                  onClick={() => {
                    onOpenAlbum(menuTrack.album.id);
                    setMenuTrack(null);
                  }}
                >
                  <Icon name="album" size={16} /> {menuTrack.album.name}
                </button>
              )}

              {canAddToPlaylist && myPlaylists.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="nav-section-title" style={{ paddingLeft: 0 }}>
                    {t("Add to Playlist")}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
                    {myPlaylists.map((pl) => (
                      <button
                        key={pl.id}
                        className="nav-btn"
                        onClick={() => {
                          onAddToPlaylist(pl.id, menuTrack);
                          setMenuTrack(null);
                        }}
                      >
                        <Icon name="playlist" size={15} />
                        <span className="truncate">{pl.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
