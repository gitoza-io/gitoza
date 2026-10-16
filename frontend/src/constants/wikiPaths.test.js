import { describe, expect, it } from "vitest";
import {
  WIKI_ROOT,
  findWikiFolderNode,
  isArchivedWikiFolderPath,
  isArchivedWikiPath,
  isWikiGitkeepPath,
  isWikiTrackedPath,
  isWikiDocPath,
  wikiCreateTargetFolder,
  wikiFolderFocusLabel,
  wikiGitkeepFolderLabel,
  wikiParentFolder,
} from "./wikiPaths.js";

describe("wikiCreateTargetFolder", () => {
  it("defaults to wiki root when no folder is selected", () => {
    expect(wikiCreateTargetFolder(null)).toBe(WIKI_ROOT);
    expect(wikiCreateTargetFolder("")).toBe(WIKI_ROOT);
    expect(wikiCreateTargetFolder(undefined)).toBe(WIKI_ROOT);
  });

  it("keeps an explicit folder path", () => {
    expect(wikiCreateTargetFolder(".gitoza/wiki/architecture")).toBe(".gitoza/wiki/architecture");
    expect(wikiCreateTargetFolder(WIKI_ROOT)).toBe(WIKI_ROOT);
  });
});

describe("wiki tracked paths", () => {
  it("detects wiki docs and gitkeep under wiki root", () => {
    expect(isWikiDocPath(".gitoza/wiki/a/page.md")).toBe(true);
    expect(isWikiGitkeepPath(".gitoza/wiki/a/.gitkeep")).toBe(true);
    expect(isWikiTrackedPath(".gitoza/wiki/a/.gitkeep")).toBe(true);
    expect(isWikiDocPath(".gitoza/wiki/a/.gitkeep")).toBe(false);
    expect(isWikiGitkeepPath(".gitoza/wiki/a/page.md")).toBe(false);
  });

  it("labels gitkeep as folder breadcrumb", () => {
    expect(wikiGitkeepFolderLabel(".gitoza/wiki/architecture/.gitkeep")).toBe("architecture");
    expect(wikiGitkeepFolderLabel(".gitoza/wiki/a/b/.gitkeep")).toBe("a › b");
  });
});

describe("wiki archive paths", () => {
  it("detects archived files and folders", () => {
    expect(isArchivedWikiPath(".gitoza/wiki/.archive/W-ABC123.md")).toBe(true);
    expect(isArchivedWikiPath(".gitoza/wiki/docs/W-ABC123.md")).toBe(false);
    expect(isArchivedWikiFolderPath(".gitoza/wiki/.archive/docs")).toBe(true);
    expect(isArchivedWikiFolderPath(".gitoza/wiki/docs")).toBe(false);
  });
});

describe("wiki open folder helpers", () => {
  it("pops parent until wiki root", () => {
    expect(wikiParentFolder(".gitoza/wiki/a/b")).toBe(".gitoza/wiki/a");
    expect(wikiParentFolder(".gitoza/wiki/a")).toBe(null);
    expect(wikiFolderFocusLabel(".gitoza/wiki/a/b")).toBe("a/b");
    expect(wikiFolderFocusLabel(".gitoza/wiki/.archive/docs/api")).toBe("docs/api");
  });

  it("finds nested folder nodes", () => {
    const tree = [
      {
        name: "a",
        directory_path: ".gitoza/wiki/a",
        children: [{ name: "b", directory_path: ".gitoza/wiki/a/b", children: [] }],
      },
    ];
    expect(findWikiFolderNode(tree, ".gitoza/wiki/a/b")?.name).toBe("b");
    expect(findWikiFolderNode(tree, ".gitoza/wiki/missing")).toBe(null);
  });
});
