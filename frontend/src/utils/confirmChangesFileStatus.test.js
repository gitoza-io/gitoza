import { describe, expect, it } from "vitest";
import {
  buildChangeStatusByPath,
  changeStatusLabel,
  formatRenameTooltip,
} from "./confirmChangesFileStatus";

describe("confirmChangesFileStatus", () => {
  it("maps changes by path", () => {
    const map = buildChangeStatusByPath([
      { path: ".gitoza/test/cases/p/a.yaml", status: "M" },
      {
        path: ".gitoza/test/cases/p/b.yaml",
        status: "R",
        old_path: ".gitoza/test/cases/p/old_b.yaml",
      },
      { path: ".gitoza/test/cases/p/removed.yaml", status: "D" },
    ]);
    expect(map.get(".gitoza/test/cases/p/a.yaml")).toEqual({ status: "M" });
    expect(map.get(".gitoza/test/cases/p/b.yaml")).toEqual({
      status: "R",
      old_path: ".gitoza/test/cases/p/old_b.yaml",
    });
    expect(map.get(".gitoza/test/cases/p/removed.yaml")).toEqual({ status: "D" });
  });

  it("formats rename tooltip with leaf names", () => {
    expect(
      formatRenameTooltip(
        ".gitoza/test/cases/proj/old_suite/case_a.yaml",
        ".gitoza/test/cases/proj/new_suite/case_a.yaml",
      ),
    ).toBe(
      ".gitoza/test/cases/proj/old_suite/case_a.yaml → .gitoza/test/cases/proj/new_suite/case_a.yaml",
    );
    expect(
      formatRenameTooltip(
        ".gitoza/test/cases/proj/login.yaml",
        ".gitoza/test/cases/proj/sign_in.yaml",
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
