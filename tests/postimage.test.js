import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  currentImage, generatedImage, designPatch, generatedPatch, keepGeneratedPatch, filePatch,
  currentVideo, keepStoryboardPatch, storyboardPatch, rememberFile, recentFiles, forgetRecentFiles,
} from "../src/lib/postimage.js";

/* One post, one picture. These rules describe which picture publishing will
 * send and how choosing another one replaces it — never adds beside it. The
 * rule itself lives in collectMedia (protected); the last test checks the two
 * still agree. */

const apply = (a, patch) => ({ ...a, ...patch });
const GEN = { id: "g1", kind: "svg", svg: "<svg viewBox=\"0 0 1200 630\"><text>Generated</text></svg>", strategy: { label: "Occasion graphic" } };
const FILE = { name: "team.png", data: "data:image/png;base64,AAAA", type: "image/png", bytes: 3 };
const EMPTY = { images: [], video: null, upload: null, canvaDesign: null };

beforeEach(() => forgetRecentFiles());

describe("the post's picture", () => {
  it("is nothing until something is made", () => {
    expect(currentImage(EMPTY)).toBeNull();
  });

  it("is the generated picture when that is all there is", () => {
    const c = currentImage({ ...EMPTY, images: [GEN] });
    expect(c.kind).toBe("generated");
    expect(c.label).toBe("Occasion graphic");
    expect(c.src.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("is an attached file over anything in images[] — as publishing decides", () => {
    const c = currentImage({ ...EMPTY, images: [GEN], upload: FILE });
    expect(c.kind).toBe("upload");
    expect(c.src).toBe(FILE.data);
  });

  it("knows a file brought back from Canva by its file name, not by a stale flag", () => {
    const canva = { label: "Unison · Happy Navratri", designId: "D1", file: "canva-design-1.png" };
    expect(currentImage({ ...EMPTY, upload: { ...FILE, name: "canva-design-1.png" }, canvaDesign: canva }).kind).toBe("canva");
    /* an upload made after the Canva one is the user's file, whatever canvaDesign still says */
    expect(currentImage({ ...EMPTY, upload: FILE, canvaDesign: canva }).kind).toBe("upload");
  });

  it("ignores an attached video on an image post", () => {
    expect(currentImage({ ...EMPTY, images: [GEN], upload: { ...FILE, type: "video/mp4" } }).kind).toBe("generated");
  });
});

describe("choosing replaces, never stacks", () => {
  it("a design becomes images[0] as an SVG, clears any file, and keeps the generated picture aside", () => {
    let a = { ...EMPTY, images: [GEN] };
    a = apply(a, designPatch(a, { key: "style:elegant", label: "Elegant traditional", svg: "<svg viewBox=\"0 0 1200 630\"/>", sig: 7 }));
    expect(a.images).toHaveLength(1);
    expect(a.images[0]).toMatchObject({ kind: "svg", source: "studio", designKey: "style:elegant", sig: 7 });
    expect(a.upload).toBeNull();
    expect(currentImage(a)).toMatchObject({ kind: "design", key: "style:elegant", label: "Elegant traditional" });
    expect(generatedImage(a)).toBe(GEN);
  });

  it("switching designs keeps exactly one picture and does not lose the generated one", () => {
    let a = { ...EMPTY, images: [GEN] };
    a = apply(a, designPatch(a, { key: "style:a", label: "A", svg: "<svg/>", sig: 1 }));
    a = apply(a, designPatch(a, { key: "style:b", label: "B", svg: "<svg/>", sig: 2 }));
    expect(a.images).toHaveLength(1);
    expect(a.images[0].designKey).toBe("style:b");
    expect(generatedImage(a)).toBe(GEN);
  });

  it("the generated picture can be chosen again", () => {
    let a = { ...EMPTY, images: [GEN] };
    a = apply(a, designPatch(a, { key: "style:a", label: "A", svg: "<svg/>", sig: 1 }));
    a = apply(a, generatedPatch(a));
    expect(currentImage(a).kind).toBe("generated");
    expect(a.images).toEqual([GEN]);
  });

  it("a file replacing the picture keeps the generated one for later (attachUpload clears images[])", () => {
    let a = { ...EMPTY, images: [GEN] };
    a = apply(a, keepGeneratedPatch(a));
    a = apply(a, { upload: FILE, images: [], video: null });          // what attachUpload does
    expect(currentImage(a).kind).toBe("upload");
    expect(generatedImage(a)).toBe(GEN);
    a = apply(a, generatedPatch(a));
    expect(currentImage(a).kind).toBe("generated");
    expect(a.upload).toBeNull();
  });

  it("a file used earlier can be put back exactly as it was", () => {
    rememberFile("w1:image", { upload: FILE });
    rememberFile("w1:image", { upload: FILE });                      // the same file once, not twice
    const [entry] = recentFiles("w1:image");
    expect(recentFiles("w1:image")).toHaveLength(1);
    let a = { ...EMPTY, images: [GEN] };
    a = apply(a, filePatch(entry));
    expect(a.upload).toBe(FILE);
    expect(a.images).toEqual([]);
    expect(recentFiles("w2:image")).toEqual([]);                       // other posts never see it
  });

  it("keeps a handful of earlier files, newest first", () => {
    for (let i = 0; i < 6; i++) rememberFile("w1:image", { upload: { ...FILE, name: `f${i}.png`, data: `data:image/png;base64,${i}` } });
    const list = recentFiles("w1:image");
    expect(list).toHaveLength(4);
    expect(list[0].label).toBe("f5.png");
  });
});

describe("the same rule for a video post", () => {
  const BOARD = { storyboard: [{ label: "Open" }], seconds: 8, url: "blob:x", blob: {} };
  it("an attached video file wins over the storyboard", () => {
    expect(currentVideo({ ...EMPTY, video: BOARD }).kind).toBe("storyboard");
    expect(currentVideo({ ...EMPTY, upload: { ...FILE, type: "video/mp4", name: "clip.mp4" } }).kind).toBe("upload");
  });
  it("the storyboard is set aside without its dead blob, and can be put back", () => {
    let a = { ...EMPTY, video: BOARD };
    a = apply(a, keepStoryboardPatch(a));
    expect(a.generatedVideo).toMatchObject({ seconds: 8, url: null, blob: null });
    a = apply(a, { upload: { ...FILE, type: "video/mp4" }, images: [], video: null });
    a = apply(a, storyboardPatch(a));
    expect(currentVideo(a).kind).toBe("storyboard");
    expect(a.upload).toBeNull();
  });
});

describe("agreement with publishing", () => {
  it("collectMedia still sends the attached file first, then images[0] — the rule currentImage mirrors", () => {
    const app = readFileSync(resolve(process.cwd(), "src/App.jsx"), "utf8");
    const body = app.slice(app.indexOf("async function collectMedia("), app.indexOf("async function collectMedia(") + 4000);
    const upload = body.indexOf("if (assets.upload) {");
    const image = body.indexOf('if (postType === "image" && assets.images[0])');
    expect(upload).toBeGreaterThan(0);
    expect(image).toBeGreaterThan(upload);
    /* and a studio design reaches it in the shape it already converts: an SVG with a viewBox */
    expect(body).toMatch(/viewBox="0 0 \(\\d\+\) \(\\d\+\)"/);
  });
});
