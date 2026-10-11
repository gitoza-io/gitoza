import FramelessWindowChrome from "./FramelessWindowChrome";

/**
 * Shared layout for onboarding pages: bounded viewport height, drag chrome, scrollable body.
 */
function OnboardingPageShell({ children, className = "", contentClassName = "" }) {
  return (
    <div
      className={`flex h-full min-h-0 max-h-full flex-col overflow-hidden ${className}`.trim()}
    >
      <FramelessWindowChrome />
      <div
        className={`main-content-scroll min-h-0 flex-1 overflow-y-auto ${contentClassName}`.trim()}
      >
        {children}
      </div>
    </div>
  );
}

export default OnboardingPageShell;
