/// <reference types="vite/client" />

type FileKbStoreData = {
  categories: CategoryRecord[];
  files: FileRecord[];
  tags: string[];
  rules: RuleRecord[];
  settings: AppSettings;
};

type AppSettings = {
  libraryDir: string;
  archiveRuleScope: ArchiveRuleScope;
};

type CategoryRecord = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
};

type FileRecord = {
  id: string;
  name: string;
  path: string;
  ext: string;
  size: number;
  modifiedAt: string;
  importedAt: string;
  categoryId: string;
  tags: string[];
  note: string;
  originalPath?: string;
  storedPath?: string;
  importMode?: ImportMode;
  targetDirParts?: string[];
  missing?: boolean;
  lastCheckedAt?: string;
};

type RuleRecord = {
  id: string;
  name: string;
  keywords: string[];
  categoryId: string;
  tags: string[];
  enabled: boolean;
};

type ChosenFile = {
  path: string;
  name: string;
  ext: string;
  size: number;
  modifiedAt: string;
  originalPath?: string;
  storedPath?: string;
  importMode?: ImportMode;
};

type ImportedFile = ChosenFile & {
  originalPath: string;
  storedPath: string;
  importMode: ImportMode;
};

type ImportMode = "index" | "copy" | "move";
type ArchiveRuleScope = "root" | "all";

type ShellResult = {
  ok: boolean;
  message: string;
};

interface Window {
  fileKb: {
    load: () => Promise<FileKbStoreData>;
    save: (data: FileKbStoreData) => Promise<FileKbStoreData>;
    backup: (data: FileKbStoreData) => Promise<{ ok: boolean; path: string }>;
    restore: () => Promise<FileKbStoreData | null>;
    chooseFiles: () => Promise<ChosenFile[]>;
    chooseDirectory: () => Promise<string>;
    syncCategoryFolders: (payload: {
      libraryDir: string;
      categories: CategoryRecord[];
      files: FileRecord[];
    }) => Promise<{ ok: boolean }>;
    importToLibrary: (payload: {
      files: ChosenFile[];
      libraryDir: string;
      mode: ImportMode;
      categories: CategoryRecord[];
    }) => Promise<ImportedFile[]>;
    relocateLibraryFile: (payload: {
      filePath: string;
      libraryDir: string;
      categories: CategoryRecord[];
      categoryId: string;
    }) => Promise<ChosenFile & { storedPath: string }>;
    checkFiles: (files: FileRecord[]) => Promise<Array<{
      id: string;
      exists: boolean;
      checkedAt: string;
    }>>;
    scanLibrary: (payload: {
      libraryDir: string;
      categories: CategoryRecord[];
    }) => Promise<Array<ChosenFile & {
      categoryId: string;
    }>>;
    openFile: (filePath: string) => Promise<ShellResult>;
    showInFolder: (filePath: string) => Promise<ShellResult>;
  };
}
