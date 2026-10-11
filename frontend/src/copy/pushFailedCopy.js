export const PUSH_FAILED_DISMISS = "Got it";

export const PUSH_FAILED_CONTENT = {
  conflict: {
    title: "Your changes couldn't be published",
    lead: "Someone else saved changes to the shared workspace before you did. Your work is still here and has not been lost.",
    steps: [
      "Click Sync to get the latest shared version.",
      "Review any overlapping changes if prompted.",
      "Click Confirm again when you're ready to publish.",
    ],
  },
  timeout: {
    title: "Publishing took too long",
    lead: "The connection timed out before your changes could be saved to the shared workspace. Your work is still on your computer.",
    steps: ["Check your internet connection.", "Run Sync, then try Confirm again."],
  },
  network: {
    title: "Couldn't connect to the shared workspace",
    lead: "Your changes couldn't be published because of a connection problem. Your work is still on your computer.",
    steps: ["Check your internet connection.", "Run Sync, then try Confirm again."],
  },
};

/** @param {string | null | undefined} reason */
export function getPushFailedContent(reason) {
  if (reason && PUSH_FAILED_CONTENT[reason]) {
    return PUSH_FAILED_CONTENT[reason];
  }
  return PUSH_FAILED_CONTENT.network;
}
