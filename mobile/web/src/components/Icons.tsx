import React from "react";

interface IconProps {
  name: string;
  size?: number;
  filled?: boolean;
}

export const Icon: React.FC<IconProps> = ({ name, size = 18, filled = false }) => {
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: filled ? "currentColor" : "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (name) {
    case "home":
      return <svg {...p}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5.5v-6.5h-5V21H4a1 1 0 0 1-1-1z" /></svg>;
    case "search":
      return <svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
    case "heart":
      return <svg {...p}><path d="M12 20.5s-7.5-4.8-9.2-9C1.4 8 3.6 4.5 7.2 4.5c2 0 3.7 1.1 4.8 2.7 1.1-1.6 2.8-2.7 4.8-2.7 3.6 0 5.8 3.5 4.4 7-1.7 4.2-9.2 9-9.2 9z" /></svg>;
    case "album":
      return <svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.5" /></svg>;
    case "artist":
      return <svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg>;
    case "playlist":
      return <svg {...p}><path d="M4 6h12M4 12h12M4 18h8" /><circle cx="18.5" cy="17.5" r="2.5" /><path d="M21 17.5V10" /></svg>;
    case "radio":
      return <svg {...p}><circle cx="12" cy="12" r="2" /><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13" /></svg>;
    case "podcast":
      return <svg {...p}><circle cx="12" cy="11" r="2" /><path d="M12 13v8M8.5 14.5a5 5 0 1 1 7 0M5.5 17a8.5 8.5 0 1 1 13 0" /></svg>;
    case "chart":
      return <svg {...p}><path d="M4 20V11M10 20V5M16 20v-7M22 20H2" /></svg>;
    case "calendar":
      return <svg {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></svg>;
    case "star":
      return <svg {...p}><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9z" /></svg>;
    case "settings":
      return <svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1z" /></svg>;
    case "play":
      return <svg {...p} fill="currentColor" stroke="none"><path d="M7 4.8v14.4c0 .9 1 1.5 1.8 1l11.4-7.2c.7-.4.7-1.6 0-2L8.8 3.8C8 3.3 7 3.9 7 4.8z" /></svg>;
    case "pause":
      return <svg {...p} fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16" rx="1.2" /><rect x="14" y="4" width="4" height="16" rx="1.2" /></svg>;
    case "next":
      return <svg {...p} fill="currentColor" stroke="none"><path d="M5 5.5v13l9.5-6.5L5 5.5zM16 5.5h3v13h-3v-13z" /></svg>;
    case "prev":
      return <svg {...p} fill="currentColor" stroke="none"><path d="M19 5.5v13L9.5 12 19 5.5zM5 5.5h3v13H5v-13z" /></svg>;
    case "shuffle":
      return <svg {...p}><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>;
    case "repeat":
      return <svg {...p}><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>;
    case "queue":
      return <svg {...p}><path d="M4 6h16M4 12h16M4 18h10" /></svg>;
    case "lyrics":
      return <svg {...p}><path d="M5 7h14M5 12h10M5 17h12" /></svg>;
    case "comment":
      return <svg {...p}><path d="M21 12a8 8 0 0 1-8 8H4l2.5-3A8 8 0 1 1 21 12z" /></svg>;
    case "plus":
      return <svg {...p}><path d="M12 5v14M5 12h14" /></svg>;
    case "close":
      return <svg {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>;
    case "back":
      return <svg {...p}><path d="m15 18-6-6 6-6" /></svg>;
    case "chevron-down":
      return <svg {...p}><path d="m6 9 6 6 6-6" /></svg>;
    case "check":
      return <svg {...p}><path d="M20 6 9 17l-5-5" /></svg>;
    case "download":
      return <svg {...p}><path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 19h16" /></svg>;
    case "plugin":
      return <svg {...p}><path d="M12 2v5M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v6" /></svg>;
    case "folder":
      return <svg {...p}><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
    case "clock":
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "more":
      return <svg {...p} fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>;
    case "note":
    default:
      return <svg {...p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>;
  }
};
