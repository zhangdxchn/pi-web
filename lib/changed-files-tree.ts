import { buildSearchTree, type SearchTreeNode } from "./search-tree";

/** Folder choices override the default: root folders open, deeper ones closed. */
export type ChangedFolderChoices = ReadonlyMap<string, boolean>;

export type ChangedFileRow<T> =
  | { kind: "folder"; filePath: string; path: string; name: string; depth: number; expanded: boolean }
  | { kind: "file"; filePath: string; path: string; name: string; depth: number; file: T };

export interface ChangedFilesTree<T> {
  roots: SearchTreeNode[];
  files: ReadonlyMap<string, T>;
}

/** Preserve each original file object; relative paths are only for display. */
export function buildChangedFilesTree<T>(files: readonly T[], relativePath: (file: T) => string): ChangedFilesTree<T> {
  const byPath = new Map(files.map((file) => [relativePath(file), file]));
  return { roots: buildSearchTree([...byPath.keys()]), files: byPath };
}

/** Flatten just the visible tree so the drawer can virtualize folders and files. */
export function visibleChangedFileRows<T>(tree: ChangedFilesTree<T>, choices: ChangedFolderChoices): ChangedFileRow<T>[] {
  const rows: ChangedFileRow<T>[] = [];
  const visit = (nodes: SearchTreeNode[], depth: number) => {
    for (const node of nodes) {
      if (node.isDir) {
        const expanded = choices.get(node.path) ?? depth === 0;
        rows.push({ kind: "folder", filePath: `dir:${node.path}`, path: node.path, name: node.name, depth, expanded });
        if (expanded) visit(node.children, depth + 1);
      } else {
        const file = tree.files.get(node.path);
        if (file !== undefined) rows.push({ kind: "file", filePath: `file:${node.path}`, path: node.path, name: node.name, depth, file });
      }
    }
  };
  visit(tree.roots, 0);
  return rows;
}
