import {
  ActionIcon,
  Alert,
  AppShell,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  Paper,
  Radio,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  ExternalLink,
  FilePlus,
  FolderOpen,
  HardDrive,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Tag,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const seededCategoryIds = new Set([
  "cat_reports",
  "cat_docs",
  "cat_standards",
  "cat_water",
  "cat_air",
  "cat_noise",
  "cat_solid"
]);
const seededRuleIds = new Set(["rule_water", "rule_air", "rule_noise"]);
const seededTags = new Set(["废水", "废气", "噪声", "固废", "报告", "标准", "项目"]);

type CategoryDraft = {
  id: string;
  name: string;
  parentId: string;
  note: string;
};

type ImportItem = {
  file: ChosenFile;
  categoryId: string;
  tags: string[];
  note: string;
};

type BatchEditDraft = {
  categoryId: string;
  tags: string[];
};

const emptyStore: FileKbStoreData = {
  categories: [],
  files: [],
  tags: [],
  rules: [],
  settings: {
    libraryDir: "",
    archiveRuleScope: "root"
  }
};

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeText(value: string) {
  return String(value || "").trim();
}

function uniqueTags(tags: string[]) {
  return tags.map(normalizeText).filter(Boolean).filter((tag, index, list) => list.indexOf(tag) === index);
}

function normalizeStoreData(nextData: FileKbStoreData): FileKbStoreData {
  return {
    ...emptyStore,
    ...nextData,
    categories: Array.isArray(nextData.categories) ? nextData.categories : [],
    files: Array.isArray(nextData.files) ? nextData.files : [],
    tags: Array.isArray(nextData.tags) ? nextData.tags : [],
    rules: Array.isArray(nextData.rules) ? nextData.rules : [],
    settings: {
      ...emptyStore.settings,
      ...(nextData.settings || {})
    }
  };
}

function formatSize(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function notifyError(title: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "未知错误");
  notifications.show({ title, message, color: "red" });
}

export default function App() {
  const [data, setData] = useState<FileKbStoreData>(emptyStore);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedFileId, setSelectedFileId] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [detailCategoryId, setDetailCategoryId] = useState("");
  const [detailTags, setDetailTags] = useState<string[]>([]);
  const [detailNote, setDetailNote] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft>({ id: "", name: "", parentId: "", note: "" });
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [tagDrafts, setTagDrafts] = useState<{ oldName: string; name: string }[]>([]);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleDrafts, setRuleDrafts] = useState<RuleRecord[]>([]);
  const [ruleScopeDraft, setRuleScopeDraft] = useState<ArchiveRuleScope>("root");
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [pendingImportItems, setPendingImportItems] = useState<ImportItem[]>([]);
  const [importMode, setImportMode] = useState<ImportMode>("index");
  const [importApplyRules, setImportApplyRules] = useState(true);
  const [moveIndexedModalOpen, setMoveIndexedModalOpen] = useState(false);
  const [batchEditModalOpen, setBatchEditModalOpen] = useState(false);
  const [batchEditDraft, setBatchEditDraft] = useState<BatchEditDraft>({ categoryId: "", tags: [] });
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);

  const categoryById = useMemo(() => new Map(data.categories.map((category) => [category.id, category])), [data.categories]);

  function childCategories(parentId: string | null) {
    return data.categories
      .filter((category) => category.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"));
  }

  function descendantsOf(categoryId: string): string[] {
    const children = childCategories(categoryId);
    return children.flatMap((category) => [category.id, ...descendantsOf(category.id)]);
  }

  function categoryPath(categoryId: string): string {
    const category = categoryById.get(categoryId);
    if (!category) return "未分类";
    if (!category.parentId) return category.name;
    return `${categoryPath(category.parentId)} / ${category.name}`;
  }

  function categoryDirParts(categoryId: string): string[] {
    const category = categoryById.get(categoryId);
    if (!category) return [];
    if (!category.parentId) return [category.name];
    return [...categoryDirParts(category.parentId), category.name];
  }

  function categoryPathKey(parts: string[]) {
    return parts.join("\u0000").toLowerCase();
  }

  function categoryPathMap(categories: CategoryRecord[]) {
    const byId = new Map(categories.map((category) => [category.id, category]));
    const partsForCategory = (categoryId: string): string[] => {
      const category = byId.get(categoryId);
      if (!category) return [];
      if (!category.parentId) return [category.name];
      return [...partsForCategory(category.parentId), category.name];
    };
    const result = new Map<string, string>();
    categories.forEach((category) => {
      result.set(categoryPathKey(partsForCategory(category.id)), category.id);
    });
    return result;
  }

  const categoryOptions = useMemo(
    () => [
      { value: "", label: "未分类" },
      ...data.categories.map((category) => ({ value: category.id, label: categoryPath(category.id) }))
    ],
    [data.categories, categoryById]
  );

  const selectedFile = useMemo(
    () => data.files.find((file) => file.id === selectedFileId),
    [data.files, selectedFileId]
  );

  const filteredFiles = useMemo(() => {
    const categoryIds = selectedCategoryId ? [selectedCategoryId, ...descendantsOf(selectedCategoryId)] : [];
    const query = search.toLowerCase();

    return data.files.filter((file) => {
      const matchesCategory = !categoryIds.length || categoryIds.includes(file.categoryId);
      const matchesTag = !tagFilter || file.tags.includes(tagFilter);
      const haystack = [file.name, file.ext, file.note, categoryPath(file.categoryId), ...file.tags].join(" ").toLowerCase();
      return matchesCategory && matchesTag && (!query || haystack.includes(query));
    });
  }, [data.files, selectedCategoryId, search, tagFilter, data.categories]);

  function withSyncedTags(nextData: FileKbStoreData) {
    const normalized = normalizeStoreData(nextData);
    const tags = new Set(normalized.tags);
    normalized.files.forEach((file) => file.tags.forEach((tag) => tags.add(tag)));
    normalized.rules.forEach((rule) => rule.tags.forEach((tag) => tags.add(tag)));
    return {
      ...normalized,
      tags: [...tags].filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-CN"))
    };
  }

  function removeSeededDataIfUnused(nextData: FileKbStoreData) {
    const normalized = normalizeStoreData(nextData);
    const tagsUsedByFiles = new Set<string>();
    normalized.files.forEach((file) => file.tags.forEach((tag) => tagsUsedByFiles.add(tag)));

    const categoriesUsedByFiles = new Set(normalized.files.map((file) => file.categoryId).filter(Boolean));
    const seededCategoriesInUse = new Set(categoriesUsedByFiles);
    let changed = true;
    while (changed) {
      changed = false;
      normalized.categories.forEach((category) => {
        if (seededCategoriesInUse.has(category.id) && category.parentId && !seededCategoriesInUse.has(category.parentId)) {
          seededCategoriesInUse.add(category.parentId);
          changed = true;
        }
      });
    }

    return {
      ...normalized,
      categories: normalized.categories.filter(
        (category) => !seededCategoryIds.has(category.id) || seededCategoriesInUse.has(category.id)
      ),
      tags: normalized.tags.filter((tag) => !seededTags.has(tag) || tagsUsedByFiles.has(tag)),
      rules: normalized.rules.filter((rule) => !seededRuleIds.has(rule.id))
    };
  }

  async function persist(nextData: FileKbStoreData) {
    const synced = withSyncedTags(nextData);
    await window.fileKb.save(synced);
    if (synced.settings.libraryDir) {
      await window.fileKb.syncCategoryFolders({
        libraryDir: synced.settings.libraryDir,
        categories: synced.categories,
        files: synced.files
      });
    }
    setData(synced);
    return synced;
  }

  async function chooseLibraryDir() {
    try {
      const libraryDir = await window.fileKb.chooseDirectory();
      if (!libraryDir) return;
      await persist({ ...data, settings: { ...data.settings, libraryDir } });
      await refreshStorageStats(libraryDir);
      notifications.show({ title: "知识库目录已保存", message: libraryDir, color: "teal" });
    } catch (error) {
      notifyError("选择知识库目录失败", error);
    }
  }

  async function refreshStorageStats(libraryDir = data.settings.libraryDir) {
    try {
      const stats = await window.fileKb.stats({ libraryDir });
      setStorageStats(stats);
    } catch (error) {
      notifyError("读取空间占用失败", error);
    }
  }

  async function backupData() {
    try {
      const result = await window.fileKb.backup(data);
      if (!result.ok) return;
      notifications.show({ title: "备份完成", message: result.path, color: "teal" });
    } catch (error) {
      notifyError("备份失败", error);
    }
  }

  async function restoreData() {
    try {
      if (!window.confirm("恢复备份会覆盖当前分类、标签、规则和文件索引。真实文件不会被删除。确定继续？")) return;
      const restored = await window.fileKb.restore();
      if (!restored) return;
      const saved = await persist(restored);
      setSelectedCategoryId("");
      setSelectedFileId("");
      setSelectedFileIds([]);
      notifications.show({ title: "恢复完成", message: `已恢复 ${saved.files.length} 个文件索引`, color: "teal" });
    } catch (error) {
      notifyError("恢复失败", error);
    }
  }


  useEffect(() => {
    async function load() {
      try {
        const loaded = await window.fileKb.load();
        const cleaned = withSyncedTags(removeSeededDataIfUnused(loaded));
        setData(cleaned);
        await window.fileKb.save(cleaned);
      } catch (error) {
        notifyError("加载本地数据失败", error);
      }
    }

    load();
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setDetailCategoryId("");
      setDetailTags([]);
      setDetailNote("");
      setIsDirty(false);
      return;
    }

    setDetailCategoryId(selectedFile.categoryId || "");
    setDetailTags(selectedFile.tags || []);
    setDetailNote(selectedFile.note || "");
    setIsDirty(false);
  }, [selectedFileId, selectedFile]);

  function markDirty() {
    if (selectedFile) setIsDirty(true);
  }

  function applyRules(fileMeta: ChosenFile) {
    const text = `${fileMeta.name} ${fileMeta.ext}`.toLowerCase();
    const matched = data.rules.find((rule) => {
      if (!rule.enabled) return false;
      return rule.keywords.some((keyword) => text.includes(keyword.toLowerCase()));
    });

    return {
      categoryId: matched?.categoryId || "",
      tags: matched ? [...matched.tags] : []
    };
  }

  function matchingRuleForFile(file: FileRecord, rules: RuleRecord[]) {
    const text = `${file.name} ${file.ext} ${file.path} ${file.note}`.toLowerCase();
    return rules.find((rule) => {
      if (!rule.enabled) return false;
      return rule.keywords.some((keyword) => text.includes(keyword.toLowerCase()));
    });
  }

  function normalizedRules(rules: RuleRecord[]) {
    return rules.map((rule) => ({
      ...rule,
      name: normalizeText(rule.name) || "未命名规则",
      keywords: uniqueTags(rule.keywords),
      tags: uniqueTags(rule.tags)
    }));
  }

  function isRootScopeFile(file: FileRecord) {
    if (!data.settings.libraryDir) return !file.categoryId;
    const normalizedLibraryDir = data.settings.libraryDir.toLowerCase();
    const normalizedPath = file.path.toLowerCase();
    if (!normalizedPath.startsWith(normalizedLibraryDir)) return !file.categoryId;

    const relativePath = file.path.slice(data.settings.libraryDir.length).replace(/^[/\\]/, "");
    return !relativePath.includes("\\") && !relativePath.includes("/");
  }

  async function applyRulesToExistingFiles(rulesToApply = data.rules) {
    try {
      const rules = normalizedRules(rulesToApply);
      let changedCount = 0;
      const nextFiles: FileRecord[] = [];

      for (const file of data.files) {
        if (ruleScopeDraft === "root" && !isRootScopeFile(file)) {
          nextFiles.push(file);
          continue;
        }

        const rule = matchingRuleForFile(file, rules);
        if (!rule) {
          nextFiles.push(file);
          continue;
        }

        const nextCategoryId = rule.categoryId || file.categoryId;
        const nextTags = uniqueTags([...file.tags, ...rule.tags]);
        const categoryChanged = file.categoryId !== nextCategoryId;
        const tagsChanged = nextTags.join("\u0000") !== file.tags.join("\u0000");
        let nextFile = {
          ...file,
          categoryId: nextCategoryId,
          tags: nextTags
        };

        if (categoryChanged && (file.importMode === "copy" || file.importMode === "move") && data.settings.libraryDir) {
          const relocatedFile = await window.fileKb.relocateLibraryFile({
            filePath: file.path,
            libraryDir: data.settings.libraryDir,
            categories: data.categories,
            categoryId: nextCategoryId
          });
          nextFile = {
            ...nextFile,
            path: relocatedFile.path,
            name: relocatedFile.name,
            ext: relocatedFile.ext,
            size: relocatedFile.size,
            modifiedAt: relocatedFile.modifiedAt,
            storedPath: relocatedFile.storedPath
          };
        }

        if (categoryChanged || tagsChanged) changedCount += 1;
        nextFiles.push(nextFile);
      }

      if (!changedCount) {
        notifications.show({ title: "没有命中文件", message: "当前启用规则没有改变任何现有文件。", color: "gray" });
        return;
      }

      await persist({ ...data, rules, files: nextFiles, settings: { ...data.settings, archiveRuleScope: ruleScopeDraft } });
      notifications.show({ title: "规则已应用", message: `更新了 ${changedCount} 个文件`, color: "teal" });
    } catch (error) {
      notifyError("应用归档规则失败", error);
    }
  }

  async function importFiles() {
    try {
      const chosen = await window.fileKb.chooseFiles();
      if (!chosen.length) return;
      setPendingImportItems(
        chosen.map((file) => {
          const suggestion = applyRules(file);
          return {
            file,
            categoryId: suggestion.categoryId,
            tags: uniqueTags(suggestion.tags),
            note: suggestion.categoryId ? `按规则推荐归入：${categoryPath(suggestion.categoryId)}` : ""
          };
        })
      );
      setImportApplyRules(true);
      setImportMode(data.settings.libraryDir ? "copy" : "index");
      setImportModalOpen(true);
    } catch (error) {
      notifyError("选择文件失败", error);
    }
  }

  async function confirmImportFiles() {
    try {
      if ((importMode === "copy" || importMode === "move") && !data.settings.libraryDir) {
        notifications.show({ title: "请先选择知识库目录", message: "复制或移动文件前，需要先设置知识库目录。", color: "orange" });
        setSettingsModalOpen(true);
        return;
      }

      const confirmedItems = pendingImportItems.map((item) => {
        if (!importApplyRules || item.categoryId) return item;
        const suggestion = applyRules(item.file);
        if (!suggestion.categoryId && !suggestion.tags.length) return item;
        return {
          ...item,
          categoryId: suggestion.categoryId || item.categoryId,
          tags: uniqueTags([...item.tags, ...suggestion.tags]),
          note: item.note || (suggestion.categoryId ? `按规则推荐归入：${categoryPath(suggestion.categoryId)}` : "")
        };
      });

      const plannedFiles = confirmedItems.map((item) => {
        return {
          file: {
            ...item.file,
            targetDirParts: categoryDirParts(item.categoryId)
          },
          confirmed: {
            categoryId: item.categoryId,
            tags: uniqueTags(item.tags),
            note: item.note.trim()
          }
        };
      });
      const confirmedByOriginalPath = new Map(plannedFiles.map((item) => [item.file.path, item.confirmed]));

      const imported = await window.fileKb.importToLibrary({
        files: plannedFiles.map((item) => item.file),
        libraryDir: data.settings.libraryDir,
        mode: importMode,
        categories: data.categories
      });

      const existingPaths = new Set(data.files.map((file) => file.path));
      const newFiles = imported
        .filter((file) => !existingPaths.has(file.path))
        .map((file) => {
          const confirmed = confirmedByOriginalPath.get(file.originalPath || file.path) || {
            categoryId: "",
            tags: [],
            note: ""
          };
          return {
            id: makeId("file"),
            name: file.name,
            path: file.path,
            ext: file.ext,
            size: file.size,
            modifiedAt: file.modifiedAt,
            importedAt: new Date().toISOString(),
            categoryId: confirmed.categoryId,
            tags: confirmed.tags,
            note: confirmed.note,
            originalPath: file.originalPath,
            storedPath: file.storedPath,
            importMode: file.importMode,
            missing: false,
            lastCheckedAt: new Date().toISOString()
          };
        });

      const saved = await persist({ ...data, files: [...newFiles, ...data.files] });
      if (newFiles[0]) setSelectedFileId(newFiles[0].id);
      setImportModalOpen(false);
      setPendingImportItems([]);
      notifications.show({ title: "导入完成", message: `新增 ${newFiles.length} 个文件索引`, color: "teal" });
      setData(saved);
    } catch (error) {
      notifyError("导入文件失败", error);
    }
  }

  async function saveDetail() {
    if (!selectedFile) return;

    try {
      const categoryChanged = selectedFile.categoryId !== detailCategoryId;
      const isLibraryManagedFile = selectedFile.importMode === "copy" || selectedFile.importMode === "move";
      let relocatedFile: (ChosenFile & { storedPath: string }) | null = null;

      if (categoryChanged && isLibraryManagedFile && data.settings.libraryDir) {
        relocatedFile = await window.fileKb.relocateLibraryFile({
          filePath: selectedFile.path,
          libraryDir: data.settings.libraryDir,
          categories: data.categories,
          categoryId: detailCategoryId
        });
      }

      const nextFiles = data.files.map((file) =>
        file.id === selectedFile.id
          ? {
              ...file,
              categoryId: detailCategoryId,
              tags: uniqueTags(detailTags),
              note: detailNote.trim(),
              ...(relocatedFile
                ? {
                    path: relocatedFile.path,
                    name: relocatedFile.name,
                    ext: relocatedFile.ext,
                    size: relocatedFile.size,
                    modifiedAt: relocatedFile.modifiedAt,
                    storedPath: relocatedFile.storedPath,
                    missing: false,
                    lastCheckedAt: new Date().toISOString()
                  }
                : {})
            }
          : file
      );
      await persist({ ...data, files: nextFiles });
      setIsDirty(false);
      notifications.show({
        title: "已保存",
        message: relocatedFile ? "文件已移动到新分类目录，索引已更新" : "分类、标签和备注已写入本地索引",
        color: "teal"
      });
    } catch (error) {
      notifyError("保存文件详情失败", error);
    }
  }

  async function openSelectedFile() {
    if (!selectedFile) return;
    const result = await window.fileKb.openFile(selectedFile.path);
    if (result.ok) return;
    notifications.show({ title: "打开失败", message: result.message, color: "red" });
  }

  async function showSelectedFile() {
    if (!selectedFile) return;
    const result = await window.fileKb.showInFolder(selectedFile.path);
    if (result.ok) return;
    notifications.show({ title: "打开所在文件夹失败", message: result.message, color: "red" });
  }

  async function checkIndexedFiles() {
    try {
      if (!data.files.length) {
        notifications.show({ title: "没有文件", message: "当前没有可检查的文件索引。", color: "gray" });
        return;
      }

      const results = await window.fileKb.checkFiles(data.files);
      const resultById = new Map(results.map((result) => [result.id, result]));
      const nextFiles = data.files.map((file) => {
        const result = resultById.get(file.id);
        if (!result) return file;
        return {
          ...file,
          missing: !result.exists,
          lastCheckedAt: result.checkedAt
        };
      });
      const missingCount = nextFiles.filter((file) => file.missing).length;
      await persist({ ...data, files: nextFiles });
      notifications.show({
        title: "检查完成",
        message: missingCount ? `发现 ${missingCount} 个文件路径失效` : "所有文件路径都有效",
        color: missingCount ? "orange" : "teal"
      });
    } catch (error) {
      notifyError("检查文件失败", error);
    }
  }

  async function scanLibraryFiles() {
    try {
      if (!data.settings.libraryDir) {
        notifications.show({ title: "请先选择知识库目录", message: "扫描前需要先设置知识库目录。", color: "orange" });
        setSettingsModalOpen(true);
        return;
      }

      const scanResult = await window.fileKb.scanLibrary({
        libraryDir: data.settings.libraryDir,
        categories: data.categories
      });
      const nextCategories = [...data.categories];
      const pathToCategoryId = categoryPathMap(nextCategories);

      scanResult.folders
        .sort((a, b) => a.parts.length - b.parts.length)
        .forEach((folder) => {
          const key = categoryPathKey(folder.parts);
          if (pathToCategoryId.has(key)) return;

          const parentParts = folder.parts.slice(0, -1);
          const parentId = parentParts.length ? pathToCategoryId.get(categoryPathKey(parentParts)) || null : null;
          const category = {
            id: makeId("cat"),
            name: folder.parts[folder.parts.length - 1],
            parentId,
            sortOrder: Date.now() + nextCategories.length,
            note: "从知识库目录扫描创建"
          };
          nextCategories.push(category);
          pathToCategoryId.set(key, category.id);
        });

      const existingPaths = new Set(data.files.map((file) => file.path.toLowerCase()));
      const newFiles = scanResult.files
        .filter((file) => !existingPaths.has(file.path.toLowerCase()))
        .map((file) => ({
          id: makeId("file"),
          name: file.name,
          path: file.path,
          ext: file.ext,
          size: file.size,
          modifiedAt: file.modifiedAt,
          importedAt: new Date().toISOString(),
          categoryId: file.categoryId || pathToCategoryId.get(categoryPathKey(file.categoryParts)) || "",
          tags: [],
          note: "从知识库目录扫描入库",
          originalPath: file.originalPath || file.path,
          storedPath: file.storedPath || file.path,
          importMode: file.importMode || "copy",
          missing: false,
          lastCheckedAt: new Date().toISOString()
        }));

      const newCategoryCount = nextCategories.length - data.categories.length;
      if (!newFiles.length && !newCategoryCount) {
        notifications.show({ title: "扫描完成", message: "没有发现新的未索引文件或文件夹。", color: "gray" });
        return;
      }

      await persist({ ...data, categories: nextCategories, files: [...newFiles, ...data.files] });
      if (newFiles[0]) setSelectedFileId(newFiles[0].id);
      notifications.show({
        title: "扫描完成",
        message: `新增 ${newCategoryCount} 个分类，${newFiles.length} 个文件索引`,
        color: "teal"
      });
    } catch (error) {
      notifyError("扫描知识库失败", error);
    }
  }

  function toggleFileSelection(fileId: string, checked: boolean) {
    setSelectedFileIds((current) => {
      if (checked) return current.includes(fileId) ? current : [...current, fileId];
      return current.filter((id) => id !== fileId);
    });
  }

  function openBatchEditModal() {
    setBatchEditDraft({ categoryId: "", tags: [] });
    setBatchEditModalOpen(true);
  }

  async function applyBatchEdit() {
    try {
      const selectedIds = new Set(selectedFileIds);
      const nextFiles: FileRecord[] = [];

      for (const file of data.files) {
        if (!selectedIds.has(file.id)) {
          nextFiles.push(file);
          continue;
        }

        const nextCategoryId = batchEditDraft.categoryId || file.categoryId;
        const categoryChanged = file.categoryId !== nextCategoryId;
        let nextFile = {
          ...file,
          categoryId: nextCategoryId,
          tags: uniqueTags([...file.tags, ...batchEditDraft.tags])
        };

        if (categoryChanged && (file.importMode === "copy" || file.importMode === "move") && data.settings.libraryDir) {
          const relocatedFile = await window.fileKb.relocateLibraryFile({
            filePath: file.path,
            libraryDir: data.settings.libraryDir,
            categories: data.categories,
            categoryId: nextCategoryId
          });
          nextFile = {
            ...nextFile,
            path: relocatedFile.path,
            name: relocatedFile.name,
            ext: relocatedFile.ext,
            size: relocatedFile.size,
            modifiedAt: relocatedFile.modifiedAt,
            storedPath: relocatedFile.storedPath,
            missing: false,
            lastCheckedAt: new Date().toISOString()
          };
        }

        nextFiles.push(nextFile);
      }

      await persist({ ...data, files: nextFiles });
      notifications.show({ title: "批量操作完成", message: `已更新 ${selectedFileIds.length} 个文件`, color: "teal" });
      setSelectedFileIds([]);
      setBatchEditModalOpen(false);
    } catch (error) {
      notifyError("批量操作失败", error);
    }
  }

  async function removeSelectedFile() {
    if (!selectedFile || !window.confirm("只移除索引，不会删除本地文件。确定继续？")) return;
    await persist({ ...data, files: data.files.filter((file) => file.id !== selectedFile.id) });
    setSelectedFileId("");
  }

  async function moveSelectedFileToLibrary() {
    if (!selectedFile) return;

    try {
      if (!data.settings.libraryDir) {
        notifications.show({ title: "请先选择知识库目录", message: "移动文件前，需要先设置知识库目录。", color: "orange" });
        setMoveIndexedModalOpen(false);
        setSettingsModalOpen(true);
        return;
      }

      const [movedFile] = await window.fileKb.importToLibrary({
        files: [
          {
            path: selectedFile.path,
            name: selectedFile.name,
            ext: selectedFile.ext,
            size: selectedFile.size,
            modifiedAt: selectedFile.modifiedAt,
            originalPath: selectedFile.originalPath || selectedFile.path,
            storedPath: selectedFile.path,
            importMode: "index",
            targetDirParts: categoryDirParts(selectedFile.categoryId)
          }
        ],
        libraryDir: data.settings.libraryDir,
        mode: "move",
        categories: data.categories
      });

      await persist({
        ...data,
        files: data.files.map((file) =>
          file.id === selectedFile.id
            ? {
                ...file,
                path: movedFile.path,
                name: movedFile.name,
                ext: movedFile.ext,
                size: movedFile.size,
                modifiedAt: movedFile.modifiedAt,
                originalPath: movedFile.originalPath,
                storedPath: movedFile.storedPath,
                importMode: "move",
                missing: false,
                lastCheckedAt: new Date().toISOString()
              }
            : file
        )
      });
      setMoveIndexedModalOpen(false);
      notifications.show({ title: "已移动到知识库", message: movedFile.path, color: "teal" });
    } catch (error) {
      notifyError("移动到知识库失败", error);
    }
  }

  function openCategoryModal(category?: CategoryRecord, parentId = "") {
    setCategoryDraft({
      id: category?.id || "",
      name: category?.name || "",
      parentId: category?.parentId || parentId,
      note: category?.note || ""
    });
    setCategoryModalOpen(true);
  }

  async function saveCategory() {
    const name = normalizeText(categoryDraft.name);
    if (!name) return;

    const nextCategories = categoryDraft.id
      ? data.categories.map((category) =>
          category.id === categoryDraft.id
            ? { ...category, name, parentId: categoryDraft.parentId || null, note: categoryDraft.note.trim() }
            : category
        )
      : [
          ...data.categories,
          { id: makeId("cat"), name, parentId: categoryDraft.parentId || null, sortOrder: Date.now(), note: categoryDraft.note.trim() }
        ];

    await persist({ ...data, categories: nextCategories });
    setCategoryModalOpen(false);
  }

  async function deleteCategory(category: CategoryRecord) {
    const hasChildren = data.categories.some((item) => item.parentId === category.id);
    const used = data.files.some((file) => file.categoryId === category.id);
    if (hasChildren || used) {
      notifications.show({ title: "无法删除分类", message: "该分类下还有子分类或文件。", color: "orange" });
      return;
    }

    await persist({ ...data, categories: data.categories.filter((item) => item.id !== category.id) });
  }

  function openTagModal() {
    setTagDrafts(data.tags.map((tag) => ({ oldName: tag, name: tag })));
    setTagModalOpen(true);
  }

  async function saveTags() {
    const nextTags = uniqueTags(tagDrafts.map((tag) => tag.name));
    const nextTagSet = new Set(nextTags);
    const renameMap = new Map(
      tagDrafts.filter((tag) => tag.oldName && tag.name && tag.oldName !== tag.name).map((tag) => [tag.oldName, tag.name])
    );
    const updateTags = (tags: string[]) =>
      uniqueTags(tags.map((tag) => renameMap.get(tag) || tag)).filter((tag) => nextTagSet.has(tag));

    await persist({
      ...data,
      tags: nextTags,
      files: data.files.map((file) => ({ ...file, tags: updateTags(file.tags) })),
      rules: data.rules.map((rule) => ({ ...rule, tags: updateTags(rule.tags) }))
    });
    setTagModalOpen(false);
  }

  function openRulesModal() {
    setRuleDrafts(data.rules.map((rule) => ({ ...rule, keywords: [...rule.keywords], tags: [...rule.tags] })));
    setRuleScopeDraft(data.settings.archiveRuleScope || "root");
    setRuleModalOpen(true);
  }

  async function saveRules() {
    await persist({
      ...data,
      rules: normalizedRules(ruleDrafts),
      settings: { ...data.settings, archiveRuleScope: ruleScopeDraft }
    });
    setRuleModalOpen(false);
  }

  function renderCategoryNode(category: CategoryRecord, level = 0) {
    const active = selectedCategoryId === category.id;
    const children = childCategories(category.id);
    return (
      <Stack gap={4} key={category.id}>
        <Group
          className={`categoryItem ${active ? "active" : ""}`}
          data-level={level}
          gap={6}
          wrap="nowrap"
          style={{ paddingLeft: 8 + level * 20 }}
        >
          <Button
            variant="subtle"
            color={active ? "teal" : "gray"}
            className="categoryButton"
            onClick={() => {
              setSelectedCategoryId(active ? "" : category.id);
              setSelectedFileId("");
            }}
          >
            {category.name}
          </Button>
          <Group gap={2} className="categoryActions" wrap="nowrap">
            <Tooltip label="新增子分类">
              <ActionIcon variant="subtle" onClick={() => openCategoryModal(undefined, category.id)}>
                <Plus size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="编辑分类">
              <ActionIcon variant="subtle" onClick={() => openCategoryModal(category)}>
                <Pencil size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="删除分类">
              <ActionIcon variant="subtle" color="red" onClick={() => deleteCategory(category)}>
                <Trash2 size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        {children.length > 0 && <Stack gap={4} className="categoryBranch">{children.map((child) => renderCategoryNode(child, level + 1))}</Stack>}
      </Stack>
    );
  }

  return (
    <AppShell navbar={{ width: 292, breakpoint: "sm" }} header={{ height: 72 }}>
      <AppShell.Navbar className="sidebarShell">
        <Group className="brandBlock" gap="sm" wrap="nowrap">
          <div className="brandMark">知</div>
          <div>
            <Title order={3}>本地文件知识库</Title>
            <Text size="xs" c="dimmed">本地索引</Text>
          </div>
        </Group>
        <Divider />
        <Group justify="space-between">
          <Text size="xs" fw={800} c="dimmed">分类</Text>
          <Tooltip label="新增一级分类">
            <ActionIcon color="teal" onClick={() => openCategoryModal()}>
              <Plus size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <ScrollArea className="categoryScroll">
          <Stack gap={4}>
            <Button
              justify="flex-start"
              variant={selectedCategoryId ? "subtle" : "light"}
              color="teal"
              onClick={() => {
                setSelectedCategoryId("");
                setSelectedFileId("");
              }}
            >
              全部文件
            </Button>
            {childCategories(null).map((category) => renderCategoryNode(category))}
          </Stack>
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Header className="topBar">
        <TextInput
          className="searchInput"
          leftSection={<Search size={16} />}
          placeholder="搜索文件名、标签、备注、分类"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        <Group gap="sm" wrap="nowrap">
          <Button
            variant="light"
            leftSection={<HardDrive size={16} />}
            onClick={() => {
              setSettingsModalOpen(true);
              refreshStorageStats();
            }}
          >
            知识库目录
          </Button>
          <Button leftSection={<FilePlus size={16} />} onClick={importFiles}>导入文件</Button>
          <Button variant="light" leftSection={<RefreshCw size={16} />} onClick={scanLibraryFiles}>扫描知识库</Button>
          <Button variant="light" leftSection={<RefreshCw size={16} />} onClick={checkIndexedFiles}>检查文件</Button>
          <Button variant="light" leftSection={<Tag size={16} />} onClick={openTagModal}>标签管理</Button>
          <Button variant="light" leftSection={<Settings2 size={16} />} onClick={openRulesModal}>归档规则</Button>
        </Group>
      </AppShell.Header>

      <AppShell.Main className="mainShell">
        <div className="contentGrid">
          <Stack gap="md" className="fileColumn">
            <Group justify="space-between" align="flex-end">
              <div>
                <Title order={3}>{selectedCategoryId ? categoryPath(selectedCategoryId) : "全部文件"}</Title>
                <Text size="sm" c="dimmed">{filteredFiles.length} 个文件</Text>
              </div>
              <Select
                className="tagFilter"
                data={[{ value: "", label: "全部标签" }, ...data.tags.map((tag) => ({ value: tag, label: tag }))]}
                value={tagFilter}
                onChange={(value) => setTagFilter(value || "")}
              />
            </Group>
            {selectedFileIds.length > 0 && (
              <Paper p="sm" withBorder>
                <Group justify="space-between">
                  <Text size="sm" fw={700}>已选择 {selectedFileIds.length} 个文件</Text>
                  <Group gap="xs">
                    <Button size="xs" variant="light" onClick={openBatchEditModal}>批量编辑</Button>
                    <Button size="xs" variant="subtle" color="gray" onClick={() => setSelectedFileIds([])}>清空选择</Button>
                  </Group>
                </Group>
              </Paper>
            )}
            <ScrollArea className="fileScroll">
              <Stack gap="sm">
                {!filteredFiles.length ? (
                  <Paper className="emptyState" p="xl">
                    <Text fw={700}>还没有匹配文件</Text>
                    <Text size="sm" c="dimmed">可以导入文件，或调整搜索和筛选条件。</Text>
                  </Paper>
                ) : (
                  filteredFiles.map((file) => (
                    <Paper
                      key={file.id}
                      className={`fileCard ${selectedFileId === file.id ? "active" : ""}`}
                      onClick={() => setSelectedFileId(file.id)}
                    >
                      <Checkbox
                        className="fileCheck"
                        checked={selectedFileIds.includes(file.id)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => toggleFileSelection(file.id, event.currentTarget.checked)}
                      />
                      <div className="fileExt">{(file.ext || "FILE").slice(0, 4).toUpperCase()}</div>
                      <Stack gap={5} className="fileCardBody">
                        <Text fw={800} truncate>{file.name}</Text>
                        <Text size="sm" c="dimmed">{categoryPath(file.categoryId)} · {formatSize(file.size)}</Text>
                        <Group gap={6}>
                          {file.missing && <Badge variant="light" color="red">文件丢失</Badge>}
                          {file.tags.map((tag) => <Badge key={tag} variant="light" color="orange">{tag}</Badge>)}
                        </Group>
                      </Stack>
                    </Paper>
                  ))
                )}
              </Stack>
            </ScrollArea>
          </Stack>

          <Paper className="detailPane">
            {!selectedFile ? (
              <Stack className="emptyState detailEmpty" align="center" justify="center">
                <Text fw={800}>选择一个文件</Text>
                <Text size="sm" c="dimmed">查看路径、分类、标签和备注。</Text>
              </Stack>
            ) : (
              <Stack gap="md">
                <Group justify="space-between" align="flex-start">
                  <div className="detailTitle">
                    <Text size="xs" fw={800} c="dimmed">文件名</Text>
                    <Title order={3}>{selectedFile.name}</Title>
                  </div>
                  <Badge color="orange">{selectedFile.ext || "FILE"}</Badge>
                </Group>
                {selectedFile.missing && (
                  <Alert color="red" title="文件路径失效">
                    当前索引记录的文件路径不存在。你可以检查原文件是否被删除、移动，或从索引中移除该记录。
                  </Alert>
                )}
                <Select
                  label="分类"
                  data={categoryOptions}
                  value={detailCategoryId}
                  onChange={(value) => {
                    setDetailCategoryId(value || "");
                    markDirty();
                  }}
                />
                <TagsInput
                  label="标签"
                  data={data.tags}
                  value={detailTags}
                  onChange={(value) => {
                    setDetailTags(uniqueTags(value));
                    markDirty();
                  }}
                  splitChars={[",", "，"]}
                  placeholder="选择已有标签，或直接输入新标签"
                  clearable
                />
                <Textarea
                  label="备注"
                  minRows={5}
                  value={detailNote}
                  onChange={(event) => {
                    setDetailNote(event.currentTarget.value);
                    markDirty();
                  }}
                  placeholder="记录来源、项目、使用场景"
                />
                <Text size="xs" c="dimmed">保存修改会把分类、标签和备注写入本地索引，不会改动原始文件。</Text>
                {isDirty && <Badge color="yellow">有未保存修改</Badge>}
                <Divider />
                <Stack gap={8} className="metaList">
                  <Group justify="space-between"><Text c="dimmed">大小</Text><Text fw={700}>{formatSize(selectedFile.size)}</Text></Group>
                  <Group justify="space-between"><Text c="dimmed">修改时间</Text><Text fw={700}>{new Date(selectedFile.modifiedAt).toLocaleString()}</Text></Group>
                  <Stack gap={2}><Text c="dimmed">路径</Text><Text fw={700} className="pathText">{selectedFile.path}</Text></Stack>
                  {selectedFile.originalPath && selectedFile.originalPath !== selectedFile.path && (
                    <Stack gap={2}><Text c="dimmed">原始路径</Text><Text fw={700} className="pathText">{selectedFile.originalPath}</Text></Stack>
                  )}
                </Stack>
                <Group gap="sm">
                  <Button leftSection={<Save size={16} />} onClick={saveDetail}>保存修改</Button>
                  {(!selectedFile.importMode || selectedFile.importMode === "index") && (
                    <Button variant="light" color="orange" leftSection={<FolderOpen size={16} />} onClick={() => setMoveIndexedModalOpen(true)}>
                      移动到知识库
                    </Button>
                  )}
                  <Button variant="light" leftSection={<ExternalLink size={16} />} onClick={openSelectedFile}>打开</Button>
                  <Button variant="light" leftSection={<FolderOpen size={16} />} onClick={showSelectedFile}>所在文件夹</Button>
                  <Button variant="light" color="red" leftSection={<X size={16} />} onClick={removeSelectedFile}>移除索引</Button>
                </Group>
              </Stack>
            )}
          </Paper>
        </div>
      </AppShell.Main>

      <Modal opened={categoryModalOpen} onClose={() => setCategoryModalOpen(false)} title={categoryDraft.id ? "编辑分类" : "新增分类"}>
        <Stack>
          <TextInput label="名称" value={categoryDraft.name} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.currentTarget.value })} />
          <Select
            label="上级分类"
            data={categoryOptions.filter((item) => item.value !== categoryDraft.id)}
            value={categoryDraft.parentId}
            onChange={(value) => setCategoryDraft({ ...categoryDraft, parentId: value || "" })}
          />
          <Textarea
            label="文件夹备注"
            minRows={4}
            value={categoryDraft.note}
            onChange={(event) => setCategoryDraft({ ...categoryDraft, note: event.currentTarget.value })}
            placeholder="记录这个分类/文件夹的用途、收纳范围、常见关键词"
          />
          <Group justify="flex-end">
            <Button variant="light" onClick={() => setCategoryModalOpen(false)}>取消</Button>
            <Button onClick={saveCategory}>保存</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={settingsModalOpen} onClose={() => setSettingsModalOpen(false)} title="知识库目录" size="lg">
        <Stack>
          <Text size="sm" c="dimmed">知识库目录用于保存复制或移动进来的文件。仅索引模式不会移动文件。</Text>
          <TextInput
            label="当前目录"
            value={data.settings.libraryDir || "未设置"}
            readOnly
          />
          <Paper p="sm" withBorder>
            <Stack gap={6}>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">索引数据占用</Text>
                <Text size="sm" fw={800}>{formatSize(storageStats?.dataSize || 0)}</Text>
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">知识库文件占用</Text>
                <Text size="sm" fw={800}>{formatSize(storageStats?.librarySize || 0)}</Text>
              </Group>
              <Text size="xs" c="dimmed" className="pathText">{storageStats?.dataPath || "索引数据路径读取中"}</Text>
            </Stack>
          </Paper>
          <Divider />
          <Text size="sm" c="dimmed">备份只导出分类、标签、规则、备注和文件索引，不会复制真实文件。</Text>
          <Group justify="flex-end">
            <Button variant="light" onClick={() => setSettingsModalOpen(false)}>关闭</Button>
            <Button variant="light" onClick={backupData}>备份数据</Button>
            <Button variant="light" color="orange" onClick={restoreData}>恢复数据</Button>
            <Button leftSection={<FolderOpen size={16} />} onClick={chooseLibraryDir}>选择目录</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={importModalOpen} onClose={() => setImportModalOpen(false)} title="确认导入方式" size="lg">
        <Stack>
          <Group justify="space-between" align="flex-start">
            <Text size="sm">已选择 {pendingImportItems.length} 个文件。可以先确认每个文件的分类、标签和备注。</Text>
            <Switch
              label="应用归档规则"
              checked={importApplyRules}
              onChange={(event) => setImportApplyRules(event.currentTarget.checked)}
            />
          </Group>
          <Text size="xs" c="dimmed">开关开启时，确认导入会对未选择分类的文件应用规则；已手动选择分类的文件不会被规则覆盖。</Text>
          <TextInput label="知识库目录" value={data.settings.libraryDir || "未设置"} readOnly />
          <Radio.Group
            label="导入方式"
            value={importMode}
            onChange={(value) => setImportMode(value as ImportMode)}
          >
            <Stack mt="xs">
              <Radio value="index" label="仅建立索引：文件保留在原位置" />
              <Radio value="copy" label="复制进知识库：原文件保留，知识库中保存一份副本" />
              <Radio value="move" label="移动进知识库：原位置文件会被移走" />
            </Stack>
          </Radio.Group>
          {importMode === "move" && (
            <Alert color="red" title="移动文件警告">
              移动后，文件会从原位置移到知识库目录。依赖原路径的快捷方式、脚本或其他软件可能会找不到这些文件。
            </Alert>
          )}
          {(importMode === "copy" || importMode === "move") && !data.settings.libraryDir && (
            <Alert color="orange" title="需要先设置知识库目录">
              复制或移动文件前，请先选择知识库目录。
            </Alert>
          )}
          <ScrollArea h={Math.min(360, Math.max(180, pendingImportItems.length * 138))}>
            <Stack gap="sm" pr="sm">
              {pendingImportItems.map((item, index) => (
                <Paper key={`${item.file.path}_${index}`} p="sm" withBorder>
                  <Stack gap="xs">
                    <Group justify="space-between" gap="sm" wrap="nowrap">
                      <div className="importFileName">
                        <Text fw={800} truncate>{item.file.name}</Text>
                        <Text size="xs" c="dimmed">{formatSize(item.file.size)} · {item.file.path}</Text>
                      </div>
                      <Badge color={item.categoryId ? "teal" : "gray"}>{item.categoryId ? "已推荐" : "未分类"}</Badge>
                    </Group>
                    <Select
                      label="分类"
                      data={categoryOptions}
                      value={item.categoryId}
                      onChange={(value) =>
                        setPendingImportItems(
                          pendingImportItems.map((draft, draftIndex) =>
                            draftIndex === index ? { ...draft, categoryId: value || "" } : draft
                          )
                        )
                      }
                    />
                    <TagsInput
                      label="标签"
                      data={data.tags}
                      value={item.tags}
                      onChange={(value) =>
                        setPendingImportItems(
                          pendingImportItems.map((draft, draftIndex) =>
                            draftIndex === index ? { ...draft, tags: uniqueTags(value) } : draft
                          )
                        )
                      }
                      splitChars={[",", "，"]}
                      placeholder="选择已有标签，或直接输入新标签"
                    />
                    <Textarea
                      label="备注"
                      minRows={2}
                      value={item.note}
                      onChange={(event) =>
                        setPendingImportItems(
                          pendingImportItems.map((draft, draftIndex) =>
                            draftIndex === index ? { ...draft, note: event.currentTarget.value } : draft
                          )
                        )
                      }
                    />
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </ScrollArea>
          <Group justify="space-between">
            <Button variant="light" leftSection={<FolderOpen size={16} />} onClick={chooseLibraryDir}>选择知识库目录</Button>
            <Group>
              <Button variant="light" onClick={() => setImportModalOpen(false)}>取消</Button>
              <Button color={importMode === "move" ? "red" : "teal"} onClick={confirmImportFiles}>
                {importMode === "move" ? "确认移动并导入" : "确认导入"}
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={moveIndexedModalOpen} onClose={() => setMoveIndexedModalOpen(false)} title="移动到知识库" size="lg">
        <Stack>
          <Alert color="red" title="移动文件警告">
            这个操作会把当前文件从原位置移动到知识库目录。移动后，原路径会失效，依赖原路径的快捷方式、脚本或其他软件可能会找不到这个文件。
          </Alert>
          <TextInput label="知识库目录" value={data.settings.libraryDir || "未设置"} readOnly />
          <TextInput label="目标分类目录" value={selectedFile ? categoryPath(selectedFile.categoryId) : "未分类"} readOnly />
          {!data.settings.libraryDir && (
            <Alert color="orange" title="需要先设置知识库目录">
              移动文件前，请先选择知识库目录。
            </Alert>
          )}
          <Group justify="space-between">
            <Button variant="light" leftSection={<FolderOpen size={16} />} onClick={chooseLibraryDir}>选择知识库目录</Button>
            <Group>
              <Button variant="light" onClick={() => setMoveIndexedModalOpen(false)}>取消</Button>
              <Button color="red" onClick={moveSelectedFileToLibrary}>确认移动</Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={batchEditModalOpen} onClose={() => setBatchEditModalOpen(false)} title="批量编辑文件" size="lg">
        <Stack>
          <Alert color="blue" title="批量编辑说明">
            分类只有选择后才会修改；标签会追加到已有标签，不会覆盖原标签。已在知识库中的文件如果分类发生变化，会同步移动到对应分类文件夹。
          </Alert>
          <Select
            label="批量设置分类"
            placeholder="不修改分类"
            data={categoryOptions}
            value={batchEditDraft.categoryId}
            onChange={(value) => setBatchEditDraft({ ...batchEditDraft, categoryId: value || "" })}
            clearable
          />
          <TagsInput
            label="批量追加标签"
            data={data.tags}
            value={batchEditDraft.tags}
            onChange={(value) => setBatchEditDraft({ ...batchEditDraft, tags: uniqueTags(value) })}
            splitChars={[",", "，"]}
            placeholder="选择已有标签，或直接输入新标签"
          />
          <Group justify="flex-end">
            <Button variant="light" onClick={() => setBatchEditModalOpen(false)}>取消</Button>
            <Button onClick={applyBatchEdit}>应用到 {selectedFileIds.length} 个文件</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={tagModalOpen} onClose={() => setTagModalOpen(false)} title="标签管理" size="lg">
        <Stack>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">标签改名或删除后，会同步影响已关联的文件和规则。</Text>
            <Button variant="light" leftSection={<Plus size={16} />} onClick={() => setTagDrafts([...tagDrafts, { oldName: "", name: "" }])}>新增标签</Button>
          </Group>
          <Stack gap="xs">
            {!tagDrafts.length ? (
              <Paper className="emptyState" p="lg">
                <Text fw={700}>还没有标签</Text>
                <Text size="sm" c="dimmed">可以新增标签，也可以在文件详情里直接输入新标签。</Text>
              </Paper>
            ) : (
              tagDrafts.map((tag, index) => (
                <Group key={`${tag.oldName}_${index}`} wrap="nowrap">
                  <TextInput
                    value={tag.name}
                    onChange={(event) =>
                      setTagDrafts(tagDrafts.map((item, itemIndex) => (itemIndex === index ? { ...item, name: event.currentTarget.value } : item)))
                    }
                    placeholder="标签名称"
                    style={{ flex: 1 }}
                  />
                  <ActionIcon color="red" variant="light" onClick={() => setTagDrafts(tagDrafts.filter((_, itemIndex) => itemIndex !== index))}>
                    <Trash2 size={16} />
                  </ActionIcon>
                </Group>
              ))
            )}
          </Stack>
          <Group justify="flex-end">
            <Button variant="light" onClick={() => setTagModalOpen(false)}>关闭</Button>
            <Button onClick={saveTags}>保存标签</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={ruleModalOpen} onClose={() => setRuleModalOpen(false)} title="归档规则" size="xl">
        <Stack>
          <Alert color="blue" title="规则的作用">
            规则会在导入文件时自动预填分类和标签；也可以手动应用到现有文件。应用到现有文件时，已在知识库中的文件如果分类发生变化，会同步移动到对应分类文件夹。
          </Alert>
          <SegmentedControl
            value={ruleScopeDraft}
            onChange={(value) => setRuleScopeDraft(value as ArchiveRuleScope)}
            data={[
              { value: "root", label: "仅根目录归档" },
              { value: "all", label: "所有目录归档" }
            ]}
          />
          <Text size="xs" c="dimmed">
            仅根目录归档会只处理知识库根目录下的文件；所有目录归档会允许规则重新处理已分类目录里的文件。
          </Text>
          <Group justify="space-between">
            <Button variant="light" leftSection={<Settings2 size={16} />} onClick={() => applyRulesToExistingFiles(ruleDrafts)}>
              应用到现有文件
            </Button>
            <Button
              variant="light"
              leftSection={<Plus size={16} />}
              onClick={() =>
                setRuleDrafts([...ruleDrafts, { id: makeId("rule"), name: "新规则", keywords: [], categoryId: "", tags: [], enabled: true }])
              }
            >
              新增规则
            </Button>
          </Group>
          <Stack>
            {ruleDrafts.map((rule, index) => (
              <Paper key={rule.id} p="md" withBorder>
                <Stack>
                  <Group align="flex-end">
                    <TextInput
                      label="规则名"
                      value={rule.name}
                      onChange={(event) =>
                        setRuleDrafts(ruleDrafts.map((item, itemIndex) => (itemIndex === index ? { ...item, name: event.currentTarget.value } : item)))
                      }
                      style={{ flex: 1 }}
                    />
                    <Select
                      label="目标分类"
                      data={categoryOptions}
                      value={rule.categoryId}
                      onChange={(value) =>
                        setRuleDrafts(ruleDrafts.map((item, itemIndex) => (itemIndex === index ? { ...item, categoryId: value || "" } : item)))
                      }
                      style={{ flex: 1 }}
                    />
                    <Button
                      variant={rule.enabled ? "light" : "outline"}
                      onClick={() => setRuleDrafts(ruleDrafts.map((item, itemIndex) => (itemIndex === index ? { ...item, enabled: !item.enabled } : item)))}
                    >
                      {rule.enabled ? "已启用" : "已禁用"}
                    </Button>
                    <ActionIcon color="red" variant="light" onClick={() => setRuleDrafts(ruleDrafts.filter((_, itemIndex) => itemIndex !== index))}>
                      <Trash2 size={16} />
                    </ActionIcon>
                  </Group>
                  <TagsInput
                    label="关键词"
                    value={rule.keywords}
                    onChange={(value) =>
                      setRuleDrafts(ruleDrafts.map((item, itemIndex) => (itemIndex === index ? { ...item, keywords: uniqueTags(value) } : item)))
                    }
                    splitChars={[",", "，"]}
                    placeholder="输入关键词"
                  />
                  <TagsInput
                    label="自动添加标签"
                    data={data.tags}
                    value={rule.tags}
                    onChange={(value) =>
                      setRuleDrafts(ruleDrafts.map((item, itemIndex) => (itemIndex === index ? { ...item, tags: uniqueTags(value) } : item)))
                    }
                    splitChars={[",", "，"]}
                    placeholder="选择已有标签，或直接输入新标签"
                  />
                </Stack>
              </Paper>
            ))}
          </Stack>
          <Group justify="flex-end">
            <Button variant="light" onClick={() => setRuleModalOpen(false)}>关闭</Button>
            <Button onClick={saveRules}>保存规则</Button>
          </Group>
        </Stack>
      </Modal>
    </AppShell>
  );
}
