import { TestCaseIcon } from "./TestEntityIcons";

const WRAPPER_CLASS = "flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center";
const ICON_WRAPPER_CLASS = "mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-surface";
const ICON_CLASS = "h-7 w-7 text-muted";
const TITLE_CLASS = "mt-4 text-sm font-medium text-ink";
const DESCRIPTION_CLASS = "mt-1 text-xs text-muted";
const ACTION_MARGIN_CLASS = "mt-6";

/**
 * Unified empty state for the right-hand detail panel: "select an item" or similar.
 * Same layout, padding, icon size, and typography everywhere.
 *
 * @param {{ icon?: React.ReactNode; iconComponent?: React.ComponentType<{ className?: string }>; title: string; description?: string; action?: React.ReactNode }} props
 * - icon: optional full React node (replaces default icon block)
 * - iconComponent: optional component (e.g. TestRunIcon); rendered inside the default rounded box with consistent size
 * - title: main text
 * - description: secondary text
 * - action: optional CTA (e.g. "New test case" button)
 */
export default function DetailPanelEmpty({ icon, iconComponent: IconComponent, title, description, action }) {
  const iconNode = icon ?? (
    <div className={ICON_WRAPPER_CLASS} aria-hidden="true">
      {IconComponent ? <IconComponent className={ICON_CLASS} /> : <TestCaseIcon className={ICON_CLASS} />}
    </div>
  );

  return (
    <div className={WRAPPER_CLASS}>
      {iconNode}
      <p className={TITLE_CLASS}>{title}</p>
      {description && <p className={DESCRIPTION_CLASS}>{description}</p>}
      {action && <div className={ACTION_MARGIN_CLASS}>{action}</div>}
    </div>
  );
}
