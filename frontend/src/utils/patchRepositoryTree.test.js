import { describe, expect, it } from "vitest";
import {
  computeRenamedFolderPath,
  folderDisplayNameFromSanitized,
  patchRepositoryTreeForCaseAdditions,
  patchRepositoryTreeForCaseRemovals,
  patchRepositoryTreeForActiveCaseRemovals,
  patchRepositoryTreeForArchiveCaseRemovals,
  patchRepositoryTreeForFolderCreate,
  patchRepositoryTreeForFolderDelete,
  patchRepositoryTreeForFolderRename,
  remapExpandKeys,
  remapPathUnderPrefix,
} from "./patchRepositoryTree";

const PROJECT = ".gitoza/test/cases/auth.gitoza.test";
const SUITE = `${PROJECT}/login_suite`;

function makeTree() {
  return [
    {
      name: "auth.gitoza.test",
      display_name: "auth gitoza test",
      directory_path: PROJECT,
      is_project: true,
      children: [
        {
          name: "login_suite",
          display_name: "login suite",
          directory_path: SUITE,
          is_project: false,
          children: [
            {
              name: "nested",
              display_name: "nested",
              directory_path: `${SUITE}/nested`,
              is_project: false,
              children: [],
            },
          ],
        },
      ],
    },
  ];
}

describe("computeRenamedFolderPath", () => {
  it("appends sanitized name under parent", () => {
    expect(computeRenamedFolderPath(SUITE, "sign_in")).toBe(`${PROJECT}/sign_in`);
  });

  it("handles root-level path", () => {
    expect(computeRenamedFolderPath("foo", "bar")).toBe("bar");
  });
});

describe("folderDisplayNameFromSanitized", () => {
  it("replaces underscores and hyphens with spaces", () => {
    expect(folderDisplayNameFromSanitized("login_suite")).toBe("login suite");
    expect(folderDisplayNameFromSanitized("my-suite")).toBe("my suite");
  });
});

describe("remapPathUnderPrefix", () => {
  it("remaps exact match and descendants", () => {
    expect(remapPathUnderPrefix(SUITE, SUITE, `${PROJECT}/sign_in`)).toBe(`${PROJECT}/sign_in`);
    expect(remapPathUnderPrefix(`${SUITE}/case.yaml`, SUITE, `${PROJECT}/sign_in`)).toBe(
      `${PROJECT}/sign_in/case.yaml`,
    );
    expect(remapPathUnderPrefix(`${PROJECT}/other`, SUITE, `${PROJECT}/sign_in`)).toBe(
      `${PROJECT}/other`,
    );
  });
});

describe("remapExpandKeys", () => {
  it("remaps exact and descendant expand keys", () => {
    const expanded = new Set(["auth.gitoza.test", "auth.gitoza.test/login_suite", "other"]);
    const next = remapExpandKeys(expanded, "auth.gitoza.test/login_suite", "auth.gitoza.test/sign_in");
    expect([...next]).toEqual(["auth.gitoza.test", "auth.gitoza.test/sign_in", "other"]);
  });
});

describe("patchRepositoryTreeForFolderRename", () => {
  it("renames a suite and updates descendant directory_path", () => {
    const newPath = `${PROJECT}/sign_in`;
    const tree = patchRepositoryTreeForFolderRename(makeTree(), SUITE, newPath, "sign_in");
    const suite = tree[0].children[0];
    expect(suite.name).toBe("sign_in");
    expect(suite.display_name).toBe("sign in");
    expect(suite.directory_path).toBe(newPath);
    expect(suite.children[0].directory_path).toBe(`${newPath}/nested`);
  });

  it("renames a project at root", () => {
    const newPath = ".gitoza/test/cases/billing.gitoza.test";
    const tree = patchRepositoryTreeForFolderRename(
      makeTree(),
      PROJECT,
      newPath,
      "billing.gitoza.test",
    );
    expect(tree[0].name).toBe("billing.gitoza.test");
    expect(tree[0].directory_path).toBe(newPath);
    expect(tree[0].children[0].directory_path).toBe(`${newPath}/login_suite`);
  });

  it("returns same reference when no match", () => {
    const tree = makeTree();
    expect(patchRepositoryTreeForFolderRename(tree, ".gitoza/test/cases/missing", "x", "x")).toBe(
      tree,
    );
  });
});

describe("patchRepositoryTreeForFolderCreate", () => {
  it("inserts a new suite under parent sorted by display_name", () => {
    const newPath = `${PROJECT}/sign_in`;
    const { tree, changed } = patchRepositoryTreeForFolderCreate(makeTree(), PROJECT, newPath);
    expect(changed).toBe(true);
    const names = tree[0].children.map((c) => c.name);
    expect(names).toEqual(["login_suite", "sign_in"]);
    const created = tree[0].children.find((c) => c.directory_path === newPath);
    expect(created.display_name).toBe("sign in");
    expect(created.case_count).toBe(0);
    expect(created.children).toEqual([]);
  });

  it("inserts under nested suite parent", () => {
    const newPath = `${SUITE}/deep_suite`;
    const { tree, changed } = patchRepositoryTreeForFolderCreate(makeTree(), SUITE, newPath);
    expect(changed).toBe(true);
    const parent = tree[0].children[0];
    expect(parent.children.some((c) => c.directory_path === newPath)).toBe(true);
  });

  it("seeds project node when tree is empty", () => {
    const newPath = `${PROJECT}/new_suite`;
    const { tree, changed } = patchRepositoryTreeForFolderCreate([], PROJECT, newPath);
    expect(changed).toBe(true);
    expect(tree[0].directory_path).toBe(PROJECT);
    expect(tree[0].children.some((c) => c.directory_path === newPath)).toBe(true);
  });

  it("no-ops when parent missing or child exists", () => {
    const tree = makeTree();
    const missing = patchRepositoryTreeForFolderCreate(tree, ".gitoza/test/cases/missing", "x/y");
    expect(missing.changed).toBe(false);
    expect(missing.tree).toBe(tree);

    const dup = patchRepositoryTreeForFolderCreate(tree, PROJECT, SUITE);
    expect(dup.changed).toBe(false);
    expect(dup.tree).toBe(tree);
  });
});

function makeTreeWithCounts(projectCount = 2, suiteCount = 1) {
  const tree = makeTree();
  tree[0].case_count = projectCount;
  tree[0].children[0].case_count = suiteCount;
  return tree;
}

describe("patchRepositoryTreeForCaseAdditions", () => {
  it("increments case_count on project and containing suite", () => {
    const filePath = `${SUITE}/new_case.yaml`;
    const { tree, missingPrefixes } = patchRepositoryTreeForCaseAdditions(makeTree(), [filePath]);
    expect(missingPrefixes).toEqual([]);
    expect(tree[0].case_count).toBe(1);
    expect(tree[0].children[0].case_count).toBe(1);
  });

  it("reports missingPrefixes when tree has no matching nodes", () => {
    const filePath = `${PROJECT}/orphan/case.yaml`;
    const { tree, missingPrefixes } = patchRepositoryTreeForCaseAdditions([], [filePath]);
    expect(tree).toEqual([]);
    expect(missingPrefixes).toEqual([PROJECT]);
  });
});

describe("patchRepositoryTreeForFolderDelete", () => {
  it("removes a suite and decrements parent project case_count", () => {
    const tree = makeTreeWithCounts(3, 2);
    const { tree: next, changed } = patchRepositoryTreeForFolderDelete(tree, SUITE);
    expect(changed).toBe(true);
    expect(next[0].children).toHaveLength(0);
    expect(next[0].case_count).toBe(1);
  });

  it("removes a nested suite and updates ancestor counts", () => {
    const tree = makeTreeWithCounts(4, 3);
    tree[0].children[0].children[0].case_count = 1;
    const nested = `${SUITE}/nested`;
    const { tree: next, changed } = patchRepositoryTreeForFolderDelete(tree, nested);
    expect(changed).toBe(true);
    expect(next[0].children[0].children).toHaveLength(0);
    expect(next[0].children[0].case_count).toBe(2);
    expect(next[0].case_count).toBe(3);
  });

  it("removes a project at root", () => {
    const tree = makeTree();
    const { tree: next, changed } = patchRepositoryTreeForFolderDelete(tree, PROJECT);
    expect(changed).toBe(true);
    expect(next).toHaveLength(0);
  });

  it("no-ops when folder is missing", () => {
    const tree = makeTree();
    const result = patchRepositoryTreeForFolderDelete(tree, ".gitoza/test/cases/missing");
    expect(result.changed).toBe(false);
    expect(result.tree).toBe(tree);
  });
});

describe("patchRepositoryTreeForCaseRemovals", () => {
  it("decrements case_count on project and containing suite", () => {
    const filePath = `${SUITE}/case.yaml`;
    const { tree, missingPrefixes } = patchRepositoryTreeForCaseRemovals(makeTreeWithCounts(), [
      filePath,
    ]);
    expect(missingPrefixes).toEqual([]);
    expect(tree[0].case_count).toBe(1);
    expect(tree[0].children[0].case_count).toBe(0);
  });

  it("clamps case_count at zero", () => {
    const filePath = `${SUITE}/case.yaml`;
    const { tree } = patchRepositoryTreeForCaseRemovals(makeTreeWithCounts(0, 0), [filePath]);
    expect(tree[0].case_count).toBe(0);
    expect(tree[0].children[0].case_count).toBe(0);
  });

  it("reports missingPrefixes when tree has no matching nodes", () => {
    const filePath = `${PROJECT}/orphan/case.yaml`;
    const { tree, missingPrefixes } = patchRepositoryTreeForCaseRemovals([], [filePath]);
    expect(tree).toEqual([]);
    expect(missingPrefixes).toEqual([PROJECT]);
  });
});

describe("patchRepositoryTreeForArchiveCaseRemovals", () => {
  it("removes project when last archived case is restored", () => {
    const filePath = `${SUITE}/case.yaml`;
    const { tree } = patchRepositoryTreeForArchiveCaseRemovals(makeTreeWithCounts(1, 1), [
      filePath,
    ]);
    expect(tree).toEqual([]);
  });

  it("keeps project when cases remain", () => {
    const tree = makeTreeWithCounts(2, 2);
    const { tree: next } = patchRepositoryTreeForArchiveCaseRemovals(tree, [`${SUITE}/case.yaml`]);
    expect(next).toHaveLength(1);
    expect(next[0].case_count).toBe(1);
    expect(next[0].children[0].case_count).toBe(1);
  });
});

describe("patchRepositoryTreeForActiveCaseRemovals", () => {
  it("removes project when last active case in only suite is archived", () => {
    const filePath = `${SUITE}/case.yaml`;
    const { tree } = patchRepositoryTreeForActiveCaseRemovals(makeTreeWithCounts(1, 1), [filePath]);
    expect(tree).toEqual([]);
  });

  it("keeps project and suite when cases remain", () => {
    const tree = makeTreeWithCounts(2, 2);
    const { tree: next } = patchRepositoryTreeForActiveCaseRemovals(tree, [`${SUITE}/case.yaml`]);
    expect(next).toHaveLength(1);
    expect(next[0].case_count).toBe(1);
    expect(next[0].children[0].case_count).toBe(1);
  });

  it("prunes suite and project when bulk archiving all cases in suite", () => {
    const tree = makeTreeWithCounts(2, 2);
    const { tree: next } = patchRepositoryTreeForActiveCaseRemovals(tree, [
      `${SUITE}/case_a.yaml`,
      `${SUITE}/case_b.yaml`,
    ]);
    expect(next).toEqual([]);
  });
});
