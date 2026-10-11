import { describe, expect, it } from "vitest";
import { TICKET_STATUS_OPTIONS, formatTicketStatusLabel } from "./ticketStatus";

describe("ticketStatus", () => {
  it("includes in_testing between in_progress and blocked", () => {
    expect(TICKET_STATUS_OPTIONS.map((o) => o.value)).toEqual([
      "open",
      "in_progress",
      "in_testing",
      "blocked",
      "done",
      "cancelled",
    ]);
  });

  it("formats known and unknown statuses", () => {
    expect(formatTicketStatusLabel("in_testing")).toBe("In testing");
    expect(formatTicketStatusLabel("in_progress")).toBe("In progress");
    expect(formatTicketStatusLabel(null)).toBe("");
    expect(formatTicketStatusLabel("custom_state")).toBe("Custom state");
  });
});
