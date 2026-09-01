/** Tests for the pure transforms shared by the message, upload and query paths. */

import { describe, expect, it } from "vitest";

import {
  buildStorageKey,
  currentTimestamp,
  timestampAfterHours,
  detectDevice,
  forceDownloadContentType,
  isExpired,
  normalizeMessageRow,
} from "./data";

describe("detectDevice", () => {
  it.each([
    ["Mozilla/5.0 (iPad; CPU OS 17_0)", "iPad"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", "iPhone"],
    ["Mozilla/5.0 (Linux; Android 14)", "Android"],
    ["Mozilla/5.0 (X11; CrOS x86_64)", "Chromebook"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "Mac"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64)", "PC"],
    ["Mozilla/5.0 (X11; Linux x86_64)", "Linux"],
    ["", "unknown"],
  ])("labels %s as %s", (userAgent, expected) => {
    expect(detectDevice(userAgent)).toBe(expected);
  });

  it("prefers iPad over Mac, since iPadOS claims to be a Macintosh", () => {
    const iPadOnDesktopMode = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)";

    expect(detectDevice(iPadOnDesktopMode)).toBe("iPad");
  });

  it("prefers Android over Linux, since Android user agents contain both", () => {
    expect(detectDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("Android");
  });
});

describe("buildStorageKey", () => {
  it("strips characters Supabase Storage rejects in an object key", () => {
    // A real failure: "Screenshot 2026-08-28 at 14.02.11 (1).png" was refused
    // outright, so some uploads worked and others silently did not.
    const key = buildStorageKey("file", "Screenshot 2026-08-28 at 14.02.11 (1).png");

    expect(key).toMatch(/^file_\d+_[A-Za-z0-9._-]+\.png$/);
    expect(key).not.toContain(" ");
    expect(key).not.toContain("(");
  });

  it("keeps the extension so the browser still knows the file type", () => {
    expect(buildStorageKey("file", "report.pdf")).toMatch(/\.pdf$/);
  });

  it("survives a name made entirely of rejected characters", () => {
    const key = buildStorageKey("file", "★★★.png");

    expect(key).toMatch(/^file_\d+_file\.png$/);
  });

  it("truncates a very long name rather than failing the upload", () => {
    const key = buildStorageKey("file", "a".repeat(300) + ".txt");

    expect(key.length).toBeLessThan(140);
    expect(key).toMatch(/\.txt$/);
  });

  it("produces a different key each time so uploads never collide", () => {
    expect(buildStorageKey("img", "a.png")).not.toBe(buildStorageKey("img", "a.png"));
  });
});

describe("forceDownloadContentType", () => {
  it.each([
    ["page.html", "text/html"],
    ["vector.svg", "image/svg+xml"],
    ["script.js", "text/javascript"],
    ["data.xml", "application/xml"],
  ])("neutralises %s so the browser downloads it instead of rendering it", (name, type) => {
    // A shared file is a payload, not a page. Serving HTML or SVG inline from
    // the storage domain would let an uploaded file run script in that origin.
    expect(forceDownloadContentType(name, type)).toBe("application/octet-stream");
  });

  it("leaves an ordinary document type alone", () => {
    expect(forceDownloadContentType("report.pdf", "application/pdf")).toBe("application/pdf");
  });

  it("neutralises by extension even when the browser claims a harmless type", () => {
    expect(forceDownloadContentType("sneaky.svg", "text/plain")).toBe("application/octet-stream");
  });
});

describe("isExpired", () => {
  const now = "2026-09-01T12:00:00";

  it("is false for a message with no expiry", () => {
    expect(isExpired({ expires_at: null }, now)).toBe(false);
  });

  it("is true once the expiry has passed", () => {
    expect(isExpired({ expires_at: "2026-09-01T11:59:59" }, now)).toBe(true);
  });

  it("is false while the expiry is still in the future", () => {
    expect(isExpired({ expires_at: "2026-09-01T12:00:01" }, now)).toBe(false);
  });
});

describe("normalizeMessageRow", () => {
  it("replaces every null column with an empty string for the UI", () => {
    const row = {
      id: "abc",
      sender: "PC",
      text: null,
      image_url: null,
      file_url: null,
      file_name: null,
      timestamp: "2026-09-01T12:00:00",
      starred: null,
    };

    expect(normalizeMessageRow(row)).toEqual({
      id: "abc",
      sender: "PC",
      text: "",
      image_url: "",
      file_url: "",
      file_name: "",
      timestamp: "2026-09-01T12:00:00",
      starred: false,
    });
  });

  it("preserves a starred flag", () => {
    expect(normalizeMessageRow({ id: "a", starred: true }).starred).toBe(true);
  });
});

describe("currentTimestamp", () => {
  it("matches the second-precision format already in the database", () => {
    // Rows are ordered and date-filtered by text comparison, so a new format
    // would sort inconsistently against every message written before the port.
    const timestamp = currentTimestamp(Date.UTC(2026, 8, 1, 12, 30, 45, 123));

    expect(timestamp).toBe("2026-09-01T12:30:45");
  });

  it("carries no milliseconds or timezone suffix", () => {
    expect(currentTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it("sorts chronologically as plain text", () => {
    const earlier = currentTimestamp(Date.UTC(2026, 8, 1, 12, 0, 0));
    const later = currentTimestamp(Date.UTC(2026, 8, 1, 12, 0, 1));

    expect(earlier < later).toBe(true);
  });
});

describe("timestampAfterHours", () => {
  it("offsets forward while keeping the stored format", () => {
    const expiry = timestampAfterHours(2, Date.UTC(2026, 8, 1, 12, 0, 0));

    expect(expiry).toBe("2026-09-01T14:00:00");
  });
});
