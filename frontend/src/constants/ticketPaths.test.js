import { describe, expect, it } from "vitest";
import {
  TICKETS_ROOT,
  projectFocusForTicketOpen,
  ticketProjectDirFromPath,
  ticketProjectFromPath,
} from "./ticketPaths";

describe("ticketProjectDirFromPath", () => {
  it("returns project dir for a ticket doc", () => {
    expect(ticketProjectDirFromPath(`${TICKETS_ROOT}/alpha/A-1.md`)).toBe(
      `${TICKETS_ROOT}/alpha`,
    );
  });

  it("returns project dir for a project folder path", () => {
    expect(ticketProjectDirFromPath(`${TICKETS_ROOT}/alpha`)).toBe(`${TICKETS_ROOT}/alpha`);
  });

  it("returns null for invalid paths", () => {
    expect(ticketProjectDirFromPath("")).toBeNull();
    expect(ticketProjectDirFromPath(".gitoza/test/cases/x")).toBeNull();
  });
});

describe("projectFocusForTicketOpen", () => {
  const ticketB = `${TICKETS_ROOT}/bravo/B-1.md`;
  const projectA = `${TICKETS_ROOT}/alpha`;
  const projectB = `${TICKETS_ROOT}/bravo`;

  it("switches when open-focused on a different project", () => {
    expect(projectFocusForTicketOpen(ticketB, projectA)).toBe(projectB);
  });

  it("returns null when already focused on the ticket project", () => {
    expect(projectFocusForTicketOpen(ticketB, projectB)).toBeNull();
  });

  it("returns null at multi-project root (no open focus)", () => {
    expect(projectFocusForTicketOpen(ticketB, null)).toBeNull();
    expect(projectFocusForTicketOpen(ticketB, "")).toBeNull();
  });

  it("returns null when path has no project", () => {
    expect(projectFocusForTicketOpen("not-a-ticket", projectA)).toBeNull();
  });

  it("aligns project name with ticketProjectFromPath", () => {
    expect(ticketProjectFromPath(ticketB)).toBe("bravo");
  });
});

describe("retain selection after cross-project open (documented contract)", () => {
  const ticketB = `${TICKETS_ROOT}/bravo/B-1.md`;
  const projectA = `${TICKETS_ROOT}/alpha`;
  const projectB = `${TICKETS_ROOT}/bravo`;

  it("switch target equals ticket project; after switch focus helper is null", () => {
    expect(projectFocusForTicketOpen(ticketB, projectA)).toBe(projectB);
    // Once focus is already B, a stale Project-A list reload must not clear via
    // projectFocusForTicketOpen — TicketsPage keeps selection via retainSelectionPathRef.
    expect(projectFocusForTicketOpen(ticketB, projectB)).toBeNull();
  });
});
