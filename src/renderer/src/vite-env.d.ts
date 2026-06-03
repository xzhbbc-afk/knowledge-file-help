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
  note?: string;
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
  contentIndexStatus?: ContentIndexStatus;
  contentIndexSource?: ContentIndexSource;
  contentIndexedAt?: string;
  contentIndexError?: string;
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
type ContentIndexStatus = "none" | "indexed" | "failed" | "skipped";
type ContentIndexSource = "text" | "ocr";

type ShellResult = {
  ok: boolean;
  message: string;
};

type StorageStats = {
  dataPath: string;
  dataSize: number;
  librarySize: number;
  contentIndexSize: number;
};

type OcrProgressPayload = {
  fileId?: string;
  fileName?: string;
  current?: number;
  total?: number;
  status?: string;
  progress?: number;
};

type ContentIndexDetail = {
  status: ContentIndexStatus;
  source: ContentIndexSource | "";
  indexedAt: string;
  error: string;
  length: number;
  content: string;
};

interface Window {
  fileKb: {
    load: () => Promise<FileKbStoreData>;
    save: (data: FileKbStoreData) => Promise<FileKbStoreData>;
    stats: (payload: { libraryDir: string }) => Promise<StorageStats>;
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
    }) => Promise<{
      folders: Array<{
        path: string;
        parts: string[];
        categoryId: string;
      }>;
      files: Array<ChosenFile & {
        categoryId: string;
        categoryParts: string[];
      }>;
    }>;
    indexTextFiles: (files: FileRecord[]) => Promise<Array<{
      id: string;
      status: ContentIndexStatus;
      source?: ContentIndexSource;
      error: string;
      indexedAt: string;
    }>>;
    indexOcrFiles: (files: FileRecord[]) => Promise<Array<{
      id: string;
      status: ContentIndexStatus;
      source?: ContentIndexSource;
      error: string;
      indexedAt: string;
    }>>;
    onOcrProgress: (callback: (progress: OcrProgressPayload) => void) => () => void;
    searchContent: (query: string) => Promise<string[]>;
    getContentIndex: (fileId: string) => Promise<ContentIndexDetail>;
    openFile: (filePath: string) => Promise<ShellResult>;
    showInFolder: (filePath: string) => Promise<ShellResult>;
  };
}
