export type DerivedExportFormat = "spec-kit" | "openspec";

export interface DerivedExportSource {
  repository: string;
  retrievedDate: string;
  stableVersion: string;
  stableCommit: string;
  mainCommit: string;
  supportedPaths: readonly string[];
}

export interface DerivedExportFile {
  path: string;
  content: string;
}

export interface DerivedExport {
  format: DerivedExportFormat;
  exporterVersion: "1";
  source: DerivedExportSource;
  files: DerivedExportFile[];
}

export function exportSlug(value: string): string {
  return value
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-") || "untitled";
}

export function requireExportPrerequisites(
  governance: { constraints: readonly string[]; decisions: readonly string[]; owners: readonly string[] },
  changeSet: { current: readonly unknown[]; proposed: readonly unknown[]; verified: readonly unknown[] },
): void {
  if (!governance.constraints.length && !governance.decisions.length && !governance.owners.length) {
    throw new Error("Derived exports require populated governance constraints, decisions, or owners.");
  }
  if (!changeSet.current.length && !changeSet.proposed.length && !changeSet.verified.length) {
    throw new Error("Derived exports require a populated current, proposed, or verified change set.");
  }
}

export function sortedExportFiles(files: DerivedExportFile[]): DerivedExportFile[] {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}
