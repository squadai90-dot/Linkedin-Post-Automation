import { describe, it, expect } from "vitest";
import { readMakeReply, MAKE_CONFIG, makeLinkedInService } from "../src/lib/publish.js";
import { normalizeFormats, toggleFormat, stagesFor, visualOf, labelFor, composeFormat, normalizeFormat, compactAssets, EMPTY_ASSETS, MAX_PERSISTED_UPLOAD } from "../src/lib/formats.js";

describe("readMakeReply", () => {
  it("does not claim published just because the webhook said ok", () => {
    // Make's default reply is "Accepted"; that means delivered, nothing more.
    expect(readMakeReply({ status: "ok" }).published).toBe(false);
    expect(readMakeReply({ status: "success" }).published).toBe(false);
    expect(readMakeReply("Accepted").published).toBe(false);
    expect(readMakeReply(null).published).toBe(false);
  });

  it("does not mistake our own post id for a LinkedIn urn", () => {
    const r = readMakeReply({ status: "ok", postId: "p-w-abc123" });
    expect(r.published).toBe(false);
    expect(r.urn).toBe(null);
  });

  it("accepts a real LinkedIn urn as proof", () => {
    const r = readMakeReply({ urn: "urn:li:share:7123456789" });
    expect(r.published).toBe(true);
    expect(r.urn).toBe("urn:li:share:7123456789");
  });

  it("accepts an explicit published status", () => {
    expect(readMakeReply({ status: "published" }).published).toBe(true);
  });

  it("accepts a linkedin.com post url", () => {
    const r = readMakeReply({ url: "https://www.linkedin.com/feed/update/urn:li:share:7" });
    expect(r.published).toBe(true);
    expect(r.url).toContain("linkedin.com");
  });

  it("ignores a non-http url", () => {
    expect(readMakeReply({ url: "not a url" }).url).toBe(null);
  });

  it("unwraps the relay's { make: ... } envelope", () => {
    expect(readMakeReply({ delivered: true, make: { status: "published" } }).published).toBe(true);
  });
});

describe("publish configuration", () => {
  it("only accepts a Make webhook host", () => {
    const original = MAKE_CONFIG.url;
    MAKE_CONFIG.url = "https://evil.example.com/hook";
    expect(makeLinkedInService.configured()).toBe(false);
    MAKE_CONFIG.url = "https://hook.eu1.make.com/abc123";
    expect(makeLinkedInService.configured()).toBe(true);
    MAKE_CONFIG.url = original;
  });

  it("knows which post types the scenario handles", () => {
    expect(makeLinkedInService.supports("image")).toBe(true);
    expect(makeLinkedInService.supports("reel")).toBe(false);
  });
});

describe("formats", () => {
  it("always includes text", () => {
    expect(normalizeFormats([])).toEqual(["text"]);
    expect(normalizeFormats("image")).toEqual(["text", "image"]);
  });

  it("allows only one visual at a time", () => {
    let list = normalizeFormats(["image"]);
    list = toggleFormat(list, "video");
    expect(list).toContain("video");
    expect(list).not.toContain("image");
  });

  it("keeps a poll alongside a visual", () => {
    const list = toggleFormat(normalizeFormats(["image"]), "poll");
    expect(list).toEqual(expect.arrayContaining(["text", "image", "poll"]));
  });

  it("cannot remove text", () => {
    expect(toggleFormat(["text"], "text")).toEqual(["text"]);
  });

  it("turns a component off again", () => {
    expect(toggleFormat(["text", "poll"], "poll")).toEqual(["text"]);
  });

  it("orders stages consistently regardless of pick order", () => {
    const a = stagesFor(["text", "poll", "image"]);
    const b = stagesFor(["text", "image", "poll"]);
    expect(a).toEqual(b);
    expect(a.indexOf("research")).toBeLessThan(a.indexOf("approval"));
    expect(a.indexOf("approval")).toBeLessThan(a.indexOf("schedule"));
  });

  it("names the attachment type", () => {
    expect(visualOf(["text", "poll", "video"])).toBe("video");
    expect(visualOf(["text", "poll"])).toBe(null);
  });

  it("labels a combination for the UI", () => {
    expect(labelFor(["text"])).toBe("Text");
    expect(labelFor(["text", "image", "poll"])).toBe("Image + Poll");
  });

  it("migrates old saved format labels", () => {
    expect(normalizeFormat("Image + Text")).toBe("image");
    expect(normalizeFormat("nonsense")).toBe("text");
  });

  it("builds a stable composite id", () => {
    expect(composeFormat(["text", "poll"]).id).toBe("text+poll");
  });
});

describe("compactAssets", () => {
  const dataUrl = (bytes) => "data:image/jpeg;base64," + "A".repeat(bytes);

  it("keeps a small uploaded image so it survives a reload", () => {
    const out = compactAssets({ ...EMPTY_ASSETS, upload: { name: "a.jpg", type: "image/jpeg", data: dataUrl(1000) } });
    expect(out.upload).not.toBe(null);
    expect(out.uploadDropped).toBe(null);
  });

  it("drops an oversized upload but records that it did", () => {
    const out = compactAssets({ ...EMPTY_ASSETS, upload: { name: "huge.jpg", type: "image/jpeg", data: dataUrl(MAX_PERSISTED_UPLOAD + 10) } });
    expect(out.upload).toBe(null);
    expect(out.uploadDropped).toEqual({ name: "huge.jpg", type: "image/jpeg" });
  });

  it("never persists a video upload", () => {
    const out = compactAssets({ ...EMPTY_ASSETS, upload: { name: "clip.mp4", type: "video/mp4", data: dataUrl(100) } });
    expect(out.upload).toBe(null);
    expect(out.uploadDropped.name).toBe("clip.mp4");
  });

  it("strips the blob and object URL from a video but keeps the storyboard", () => {
    const out = compactAssets({ ...EMPTY_ASSETS, video: { storyboard: [{ line: "a" }], url: "blob:x", blob: {}, seconds: 9 } });
    expect(out.video.url).toBe(null);
    expect(out.video.blob).toBe(null);
    expect(out.video.storyboard).toHaveLength(1);
  });
});
