import { describe, expect, it } from "vitest";
import {
  buildChangeStatusByPath,
  changeStatusLabel,
  formatRenameTooltip,
} from "./confirmChangesFileStatus";

describe("confirmChangesFileStatus", () => {
  it("maps changes by path", () => {
    const map = buildChangeStatusByPath([
      { path: ".gitoza/test/cases/p/a.md", status: "M" },
      {
        path: ".gitoza/test/cases/p/b.md",
        status: "R",
        old_path: ".gitoza/test/cases/p/old_b.md",
      },
      { path: ".gitoza/test/cases/p/removed.md", status: "D" },
    ]);
    expect(map.get(".gitoza/test/cases/p/a.md")).toEqual({ status: "M" });
    expect(map.get(".gitoza/test/cases/p/b.md")).toEqual({
      status: "R",
      old_path: ".gitoza/test/cases/p/old_b.md",
    });
    expect(map.get(".gitoza/test/cases/p/removed.md")).toEqual({ status: "D" });
  });

  it("formats rename tooltip with leaf names", () => {
    expect(
      formatRenameTooltip(
        ".gitoza/test/cases/proj/old_suite/case_a.md",
        ".gitoza/test/cases/proj/new_suite/case_a.md",
      ),
    ).toBe(
      ".gitoza/test/cases/proj/old_suite/case_a.md → .gitoza/test/cases/proj/new_suite/case_a.md",
    );
    expect(
      formatRenameTooltip(
        ".gitoza/test/cases/proj/login.md",
        ".gitoza/test/cases/proj/sign_in.md",
      ),
    ).toBe("login → sign_in");
  });

  it("returns human-readable status labels", () => {
    expect(changeStatusLabel("A")).toBe("Added");
    expect(changeStatusLabel("m")).toBe("Modified");
    expect(changeStatusLabel("R")).toBe("Renamed");
    expect(changeStatusLabel("D")).toBe("Deleted");
  });
});
