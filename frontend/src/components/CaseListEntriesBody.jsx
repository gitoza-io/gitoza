import CaseListSuiteHeader from "./CaseListSuiteHeader";

/**
 * Renders grouped case list entries (suite headers + case rows).
 *
 * @param {{
 *   entries: Array<{ type: string, item?: object, directoryPath?: string, label?: string, depth?: number }>;
 *   renderCaseRow: (caseRow: object) => React.ReactNode;
 * }} props
 */
function CaseListEntriesBody({ entries = [], renderCaseRow }) {
  return (
    <>
      {entries.map((entry) => {
        if (entry.type === "suiteHeader") {
          return (
            <CaseListSuiteHeader
              key={`header:${entry.directoryPath}:${entry.depth}`}
              label={entry.label}
              depth={entry.depth}
            />
          );
        }
        if (entry.type === "case" && entry.item) {
          return (
            <li key={entry.item.file_path} className="list-none">
              {renderCaseRow(entry.item)}
            </li>
          );
        }
        return null;
      })}
    </>
  );
}

export default CaseListEntriesBody;
