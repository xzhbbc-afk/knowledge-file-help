import {
  ActionIcon,
  AppShell,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
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
  Pencil,
  Plus,
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
};

const emptyStore: FileKbStoreData = {
  categories: [],
  files: [],
  tags: [],
  rules: []
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
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [detailCategoryId, setDetailCategoryId] = useState("");
  const [detailTags, setDetailTags] = useState<string[]>([]);
  const [detailNote, setDetailNote] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft>({ id: "", name: "", parentId: "" });
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [tagDrafts, setTagDrafts] = useState<{ oldName: string; name: string }[]>([]);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleDrafts, setRuleDrafts] = useState<RuleRecord[]>([]);

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
    const tags = new Set(nextData.tags);
    nextData.files.forEach((file) => file.tags.forEach((tag) => tags.add(tag)));
    nextData.rules.forEach((rule) => rule.tags.forEach((tag) => tags.add(tag)));
    return {
      ...nextData,
      tags: [...tags].filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-CN"))
    };
  }

  function removeSeededDataIfUnused(nextData: FileKbStoreData) {
    const tagsUsedByFiles = new Set<string>();
    nextData.files.forEach((file) => file.tags.forEach((tag) => tagsUsedByFiles.add(tag)));

    const categoriesUsedByFiles = new Set(nextData.files.map((file) => file.categoryId).filter(Boolean));
    const seededCategoriesInUse = new Set(categoriesUsedByFiles);
    let changed = true;
    while (changed) {
      changed = false;
      nextData.categories.forEach((category) => {
        if (seededCategoriesInUse.has(category.id) && category.parentId && !seededCategoriesInUse.has(category.parentId)) {
          seededCategoriesInUse.add(category.parentId);
          changed = true;
        }
      });
    }

    return {
      categories: nextData.categories.filter(
        (category) => !seededCategoryIds.has(category.id) || seededCategoriesInUse.has(category.id)
      ),
      files: nextData.files,
      tags: nextData.tags.filter((tag) => !seededTags.has(tag) || tagsUsedByFiles.has(tag)),
      rules: nextData.rules.filter((rule) => !seededRuleIds.has(rule.id))
    };
  }

  async function persist(nextData: FileKbStoreData) {
    const synced = withSyncedTags(nextData);
    await window.fileKb.save(synced);
    setData(synced);
    return synced;
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

  async function importFiles() {
    try {
      const chosen = await window.fileKb.chooseFiles();
      if (!chosen.length) return;

      const existingPaths = new Set(data.files.map((file) => file.path));
      const newFiles = chosen
        .filter((file) => !existingPaths.has(file.path))
        .map((file) => {
          const suggestion = applyRules(file);
          return {
            id: makeId("file"),
            name: file.name,
            path: file.path,
            ext: file.ext,
            size: file.size,
            modifiedAt: file.modifiedAt,
            importedAt: new Date().toISOString(),
            categoryId: suggestion.categoryId,
            tags: suggestion.tags,
            note: suggestion.categoryId ? `按规则推荐归入：${categoryPath(suggestion.categoryId)}` : ""
          };
        });

      const saved = await persist({ ...data, files: [...newFiles, ...data.files] });
      if (newFiles[0]) setSelectedFileId(newFiles[0].id);
      notifications.show({ title: "导入完成", message: `新增 ${newFiles.length} 个文件索引`, color: "teal" });
      setData(saved);
    } catch (error) {
      notifyError("导入文件失败", error);
    }
  }

  async function saveDetail() {
    if (!selectedFile) return;

    try {
      const nextFiles = data.files.map((file) =>
        file.id === selectedFile.id
          ? { ...file, categoryId: detailCategoryId, tags: uniqueTags(detailTags), note: detailNote.trim() }
          : file
      );
      await persist({ ...data, files: nextFiles });
      setIsDirty(false);
      notifications.show({ title: "已保存", message: "分类、标签和备注已写入本地索引", color: "teal" });
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

  async function removeSelectedFile() {
    if (!selectedFile || !window.confirm("只移除索引，不会删除本地文件。确定继续？")) return;
    await persist({ ...data, files: data.files.filter((file) => file.id !== selectedFile.id) });
    setSelectedFileId("");
  }

  function openCategoryModal(category?: CategoryRecord, parentId = "") {
    setCategoryDraft({
      id: category?.id || "",
      name: category?.name || "",
      parentId: category?.parentId || parentId
    });
    setCategoryModalOpen(true);
  }

  async function saveCategory() {
    const name = normalizeText(categoryDraft.name);
    if (!name) return;

    const nextCategories = categoryDraft.id
      ? data.categories.map((category) =>
          category.id === categoryDraft.id ? { ...category, name, parentId: categoryDraft.parentId || null } : category
        )
      : [
          ...data.categories,
          { id: makeId("cat"), name, parentId: categoryDraft.parentId || null, sortOrder: Date.now() }
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
    setRuleModalOpen(true);
  }

  async function saveRules() {
    await persist({
      ...data,
      rules: ruleDrafts.map((rule) => ({
        ...rule,
        name: normalizeText(rule.name) || "未命名规则",
        keywords: uniqueTags(rule.keywords),
        tags: uniqueTags(rule.tags)
      }))
    });
    setRuleModalOpen(false);
  }

  function renderCategoryNode(category: CategoryRecord, level = 0) {
    const active = selectedCategoryId === category.id;
    return (
      <Stack gap={4} key={category.id}>
        <Group className={`categoryItem ${active ? "active" : ""}`} gap={6} wrap="nowrap" style={{ paddingLeft: 8 + level * 14 }}>
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
        {childCategories(category.id).map((child) => renderCategoryNode(child, level + 1))}
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
          <Button leftSection={<FilePlus size={16} />} onClick={importFiles}>导入文件</Button>
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
                      <div className="fileExt">{(file.ext || "FILE").slice(0, 4).toUpperCase()}</div>
                      <Stack gap={5} className="fileCardBody">
                        <Text fw={800} truncate>{file.name}</Text>
                        <Text size="sm" c="dimmed">{categoryPath(file.categoryId)} · {formatSize(file.size)}</Text>
                        <Group gap={6}>
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
                </Stack>
                <Group gap="sm">
                  <Button leftSection={<Save size={16} />} onClick={saveDetail}>保存修改</Button>
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
          <Group justify="flex-end">
            <Button variant="light" onClick={() => setCategoryModalOpen(false)}>取消</Button>
            <Button onClick={saveCategory}>保存</Button>
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
          <Group justify="flex-end">
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
