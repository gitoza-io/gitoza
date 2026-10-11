import { describe, expect, it } from "vitest";
import {
  breadcrumbLabelForCasePath,
  buildConfirmChangelistEntries,
  discardTargetFromChangelistEntry,
  discardTargetFromSection,
  findFirstSelectableEntry,
} from "./confirmChangesChangelist.js";

describe("breadcrumbLabelForCasePath", () => {
  it("formats project suite case breadcrumb", () => {
    expect(
      breadcrumbLabelForCasePath(".gitoza/test/cases/auth/login/login.yaml"),
    ).toBe("auth › login › login");
  });
});

describe("buildConfirmChangelistEntries", () => {
  it("sorts case rows by path and adds section header", () => {
    const entries = buildConfirmChangelistEntries({
      caseChanges: [
        { path: ".gitoza/test/cases/p/b.yaml", status: "M" },
        { path: ".gitoza/test/cases/p/a.yaml", status: "A" },
      ],
    });
    expect(entries[0]).toMatchObject({
      kind: "sectionHeader",
      sectionId: "cases",
      title: "Cases",
      count: 2,
    });
    expect(entries[1].kind).toBe("case");
    expect(entries[1].file_path).toBe(".gitoza/test/cases/p/a.yaml");
    expect(entries[2].file_path).toBe(".gitoza/test/cases/p/b.yaml");
  });

  it("includes tickets runs templates and config sections when present", () => {
    const entries = buildConfirmChangelistEntries({
      runGroups: [
        {
          runDir: ".gitoza/test/runs/sprint_1",
          runId: "sprint_1",
          paths: [".gitoza/test/runs/sprint_1/head.yaml"],
        },
      ],
      ticketFiles: [".gitoza/tasks/tickets/auth/Auth-1.yaml"],
      ticketChanges: [{ path: ".gitoza/tasks/tickets/auth/Auth-1.yaml", status: "A" }],
      templateFiles: [".gitoza/test/templates/t.md"],
      configFiles: [".gitoza/config.json"],
    });
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain("sectionHeader");
    expect(kinds).toContain("runGroup");
    expect(kinds).toContain("ticket");
    expect(kinds).toContain("template");
    expect(kinds).toContain("config");
    const ticket = entries.find((e) => e.kind === "ticket");
    expect(ticket).toMatchObject({
      path: ".gitoza/tasks/tickets/auth/Auth-1.yaml",
      status: "A",
      title: "Auth-1",
      ticket_id: "Auth-1",
      type: "task",
      label: "Auth-1",
    });
  });

  it("includes wiki section after tickets with status metadata", () => {
    const path = ".gitoza/wiki/architecture/data/model.yaml";
    const entries = buildConfirmChangelistEntries({
      ticketFiles: [".gitoza/tasks/tickets/auth/Auth-1.yaml"],
      wikiFiles: [path],
      wikiChanges: [{ path, status: "M" }],
    });
    const sectionIds = entries
      .filter((e) => e.kind === "sectionHeader")
      .map((e) => e.sectionId);
    expect(sectionIds.indexOf("wiki")).toBeGreaterThan(sectionIds.indexOf("tickets"));
    const wikiHeader = entries.find(
      (e) => e.kind === "sectionHeader" && e.sectionId === "wiki",
    );
    expect(wikiHeader).toMatchObject({ title: "Wiki", count: 1 });
    const wiki = entries.find((e) => e.kind === "wiki");
    expect(wiki).toMatchObject({
      path,
      status: "M",
      title: "model",
      page_id: "model",
      label: "model",
    });
  });

  it("uses hydrated wiki title and page_id when meta is provided", () => {
    const path = ".gitoza/wiki/architecture/data/model.yaml";
    const entries = buildConfirmChangelistEntries({
      wikiFiles: [path],
      wikiChanges: [{ path, status: "A" }],
      wikiMetaByPath: {
        [path]: { title: "Data model", page_id: "model" },
      },
    });
    const wiki = entries.find((e) => e.kind === "wiki");
    expect(wiki).toMatchObject({
      path,
      title: "Data model",
      page_id: "model",
      label: "Data model",
    });
  });

  it("uses hydrated ticket title and type when meta is provided", () => {
    const path = ".gitoza/tasks/tickets/auth/Auth-1.yaml";
    const entries = buildConfirmChangelistEntries({
      ticketFiles: [path],
      ticketChanges: [{ path, status: "M" }],
      ticketMetaByPath: {
        [path]: { title: "Login flow", type: "bug", ticket_id: "Auth-1" },
      },
    });
    const ticket = entries.find((e) => e.kind === "ticket");
    expect(ticket).toMatchObject({
      path,
      title: "Login flow",
      type: "bug",
      ticket_id: "Auth-1",
      label: "Login flow",
    });
  });

  it("includes runs templates and config sections when present", () => {
    const entries = buildConfirmChangelistEntries({
      runGroups: [
        {
          runDir: ".gitoza/test/runs/sprint_1",
          runId: "sprint_1",
          paths: [".gitoza/test/runs/sprint_1/head.yaml"],
        },
      ],
      templateFiles: [".gitoza/test/templates/t.md"],
      configFiles: [".gitoza/config.json"],
    });
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain("sectionHeader");
    expect(kinds).toContain("runGroup");
    expect(kinds).toContain("template");
    expect(kinds).toContain("config");
  });

  it("returns empty for no changes", () => {
    expect(buildConfirmChangelistEntries({})).toEqual([]);
  });

  it("does not treat nested substring paths as cases", () => {
    const entries = buildConfirmChangelistEntries({
      caseChanges: [
        { path: "other-project/.gitoza/test/cases/a.yaml", status: "M" },
        { path: ".gitoza/test/cases/p/a.yaml", status: "M" },
      ],
    });
    const cases = entries.filter((e) => e.kind === "case");
    expect(cases).toHaveLength(1);
    expect(cases[0].file_path).toBe(".gitoza/test/cases/p/a.yaml");
  });

  it("puts outside yaml and nested false-positive paths in Other", () => {
    const entries = buildConfirmChangelistEntries({
      caseChanges: [{ path: ".gitoza/test/cases/p/a.yaml", status: "M" }],
      otherFiles: [
        "specs/login.yaml",
        "other-project/.gitoza/test/cases/nested.yaml",
        "other-project/.gitoza/test/runs/r1/head.yaml",
        "other-project/.gitoza/test/templates/t.md",
      ],
    });
    const otherHeader = entries.find(
      (e) => e.kind === "sectionHeader" && e.sectionId === "other",
    );
    expect(otherHeader).toMatchObject({ title: "Other", count: 4, canDiscard: false });
    const others = entries.filter((e) => e.kind === "other");
    expect(others.map((e) => e.path)).toEqual([
      "other-project/.gitoza/test/cases/nested.yaml",
      "other-project/.gitoza/test/runs/r1/head.yaml",
      "other-project/.gitoza/test/templates/t.md",
      "specs/login.yaml",
    ]);
    expect(others.every((e) => e.label === e.path)).toBe(true);
    expect(others.every((e) => e.discardable === false)).toBe(true);
  });

  it("marks Other entries under .gitoza as discardable", () => {
    const entries = buildConfirmChangelistEntries({
      otherFiles: [".gitoza/notes.txt", "README.md"],
    });
    const others = entries.filter((e) => e.kind === "other");
    expect(others.find((e) => e.path === ".gitoza/notes.txt")?.discardable).toBe(true);
    expect(others.find((e) => e.path === "README.md")?.discardable).toBe(false);
    const header = entries.find((e) => e.kind === "sectionHeader" && e.sectionId === "other");
    expect(header?.canDiscard).toBe(true);
  });
});

describe("findFirstSelectableEntry", () => {
  it("prefers first case row", () => {
    const entries = buildConfirmChangelistEntries({
      caseChanges: [{ path: ".gitoza/test/cases/p/a.yaml", status: "M" }],
      runGroups: [
        {
          runDir: ".gitoza/test/runs/r1",
          runId: "r1",
          paths: [".gitoza/test/runs/r1/head.yaml"],
        },
      ],
    });
    expect(findFirstSelectableEntry(entries)).toEqual({
      selectionKind: "caseFolder",
      selectedFilePath: ".gitoza/test/cases/p/a.yaml",
      selectedRunDir: null,
    });
  });

  it("selects run when no cases", () => {
    const entries = buildConfirmChangelistEntries({
      runGroups: [
        {
          runDir: ".gitoza/test/runs/r1",
          runId: "r1",
          paths: [".gitoza/test/runs/r1/head.yaml"],
        },
      ],
    });
    expect(findFirstSelectableEntry(entries)?.selectionKind).toBe("runGroup");
  });

  it("selects wiki when it is the only change", () => {
    const path = ".gitoza/wiki/intro.yaml";
    const entries = buildConfirmChangelistEntries({
      wikiFiles: [path],
      wikiChanges: [{ path, status: "A" }],
    });
    expect(findFirstSelectableEntry(entries)).toEqual({
      selectionKind: "other",
      selectedFilePath: path,
      selectedRunDir: null,
    });
  });

  it("selects Other when it is the only change", () => {
    const path = "specs/login.yaml";
    const entries = buildConfirmChangelistEntries({
      otherFiles: [path],
    });
    expect(findFirstSelectableEntry(entries)).toEqual({
      selectionKind: "other",
      selectedFilePath: path,
      selectedRunDir: null,
    });
  });
});

describe("discardTargetFromChangelistEntry", () => {
  it("returns case path with status metadata", () => {
    const entries = buildConfirmChangelistEntries({
      caseChanges: [
        {
          path: ".gitoza/test/cases/p/a.yaml",
          status: "R",
          old_path: ".gitoza/test/cases/p/old.yaml",
        },
      ],
    });
    const caseEntry = entries.find((e) => e.kind === "case");
    expect(discardTargetFromChangelistEntry(caseEntry)).toEqual({
      paths: [".gitoza/test/cases/p/a.yaml"],
      changes: [
        {
          path: ".gitoza/test/cases/p/a.yaml",
          status: "R",
          old_path: ".gitoza/test/cases/p/old.yaml",
        },
      ],
      label: expect.any(String),
    });
  });

  it("returns all run shard paths for a run group", () => {
    const entries = buildConfirmChangelistEntries({
      runGroups: [
        {
          runDir: ".gitoza/test/runs/r1",
          runId: "r1",
          paths: [
            ".gitoza/test/runs/r1/head.yaml",
            ".gitoza/test/runs/r1/cases.yaml",
            ".gitoza/test/runs/r1/results.yaml",
          ],
        },
      ],
    });
    const runEntry = entries.find((e) => e.kind === "runGroup");
    const target = discardTargetFromChangelistEntry(runEntry);
    expect(target?.paths).toEqual([
      ".gitoza/test/runs/r1/head.yaml",
      ".gitoza/test/runs/r1/cases.yaml",
      ".gitoza/test/runs/r1/results.yaml",
    ]);
  });

  it("returns null discard target for Other outside .gitoza", () => {
    const entries = buildConfirmChangelistEntries({
      otherFiles: ["specs/login.yaml"],
    });
    const otherEntry = entries.find((e) => e.kind === "other");
    expect(discardTargetFromChangelistEntry(otherEntry)).toBeNull();
  });

  it("returns discard target for Other under .gitoza", () => {
    const entries = buildConfirmChangelistEntries({
      otherFiles: [".gitoza/notes.txt"],
      otherChanges: [{ path: ".gitoza/notes.txt", status: "M" }],
    });
    const otherEntry = entries.find((e) => e.kind === "other");
    expect(discardTargetFromChangelistEntry(otherEntry)).toEqual({
      paths: [".gitoza/notes.txt"],
      changes: [{ path: ".gitoza/notes.txt", status: "M", old_path: null }],
      label: ".gitoza/notes.txt",
    });
  });
});

describe("discardTargetFromSection", () => {
  it("collects all case paths in the cases section", () => {
    const entries = buildConfirmChangelistEntries({
      caseChanges: [
        { path: ".gitoza/test/cases/p/a.yaml", status: "M" },
        { path: ".gitoza/test/cases/p/b.yaml", status: "A" },
      ],
      runGroups: [
        {
          runDir: ".gitoza/test/runs/r1",
          runId: "r1",
          paths: [".gitoza/test/runs/r1/head.yaml"],
        },
      ],
    });
    const target = discardTargetFromSection(entries, "cases");
    expect(target?.paths).toEqual([
      ".gitoza/test/cases/p/a.yaml",
      ".gitoza/test/cases/p/b.yaml",
    ]);
    expect(target?.itemCount).toBe(2);
    expect(target?.label).toBe("Cases");
  });

  it("collects all shard paths for runs section", () => {
    const entries = buildConfirmChangelistEntries({
      runGroups: [
        {
          runDir: ".gitoza/test/runs/r1",
          runId: "r1",
          paths: [
            ".gitoza/test/runs/r1/head.yaml",
            ".gitoza/test/runs/r1/results.yaml",
          ],
        },
      ],
    });
    const target = discardTargetFromSection(entries, "runs");
    expect(target?.paths).toEqual([
      ".gitoza/test/runs/r1/head.yaml",
      ".gitoza/test/runs/r1/results.yaml",
    ]);
    expect(target?.itemCount).toBe(1);
  });

  it("collects all wiki paths in the wiki section", () => {
    const entries = buildConfirmChangelistEntries({
      wikiFiles: [
        ".gitoza/wiki/intro.yaml",
        ".gitoza/wiki/architecture/overview.yaml",
      ],
      wikiChanges: [
        { path: ".gitoza/wiki/intro.yaml", status: "A" },
        { path: ".gitoza/wiki/architecture/overview.yaml", status: "M" },
      ],
    });
    const target = discardTargetFromSection(entries, "wiki");
    expect(target?.paths).toEqual([
      ".gitoza/wiki/architecture/overview.yaml",
      ".gitoza/wiki/intro.yaml",
    ]);
    expect(target?.itemCount).toBe(2);
    expect(target?.label).toBe("Wiki");
  });
});
