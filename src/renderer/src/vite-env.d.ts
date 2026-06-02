/// <reference types="vite/client" />

type FileKbStoreData = {
  categories: CategoryRecord[];
  files: FileRecord[];
  tags: string[];
  rules: RuleRecord[];
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
};

type ShellResult = {
  ok: boolean;
  message: string;
};

interface Window {
  fileKb: {
    load: () => Promise<FileKbStoreData>;
    save: (data: FileKbStoreData) => Promise<FileKbStoreData>;
    chooseFiles: () => Promise<ChosenFile[]>;
    openFile: (filePath: string) => Promise<ShellResult>;
    showInFolder: (filePath: string) => Promise<ShellResult>;
  };
}
