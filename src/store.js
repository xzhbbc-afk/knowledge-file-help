const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const initSqlJs = require("sql.js/dist/sql-asm.js");
const mammoth = require("mammoth");
const WordExtractor = require("word-extractor");
const XLSX = require("xlsx");
const { PDFParse } = require("pdf-parse");
const { createWorker } = require("tesseract.js");

const defaultData = {
  categories: [],
  files: [],
  tags: [],
  rules: [],
  settings: {
    libraryDir: "",
    archiveRuleScope: "root",
    ocrLanguage: "chi_sim+eng"
  }
};

const TEXT_INDEX_LIMIT = 100000;
const OCR_FILE_SIZE_LIMIT = 10 * 1024 * 1024;
const OCR_LANGS = ["chi_sim", "eng"];
const OCR_LANG_CODE = OCR_LANGS.join("+");
const OCR_LANG_PACKAGE_PATHS = {
  chi_sim: path.join(__dirname, "..", "node_modules", "@tesseract.js-data", "chi_sim", "4.0.0_best_int", "chi_sim.traineddata.gz"),
  eng: path.join(__dirname, "..", "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz")
};
const PLAIN_TEXT_EXTS = new Set([
  "txt",
  "md",
  "csv",
  "tsv",
  "json",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "log",
  "ini",
  "conf",
  "cfg",
  "yml",
  "yaml",
  "sql",
  "bat",
  "cmd",
  "ps1",
  "sh",
  "py",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "go",
  "rs",
  "php",
  "rb"
]);
const OFFICE_TEXT_EXTS = new Set(["doc", "docx", "xlsx", "xls"]);
const PDF_TEXT_EXTS = new Set(["pdf"]);
const OCR_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "bmp"]);
const OCR_DOCUMENT_EXTS = new Set(["pdf"]);
const OCR_SUPPORTED_EXTS = new Set([...OCR_IMAGE_EXTS, ...OCR_DOCUMENT_EXTS]);
const SUPPORTED_TEXT_EXTS = new Set([...PLAIN_TEXT_EXTS, ...OFFICE_TEXT_EXTS, ...PDF_TEXT_EXTS]);
const wordExtractor = new WordExtractor();
const LATIN_TOKEN_PATTERN = /[a-z0-9_]{2,}/g;
const CJK_SEQUENCE_PATTERN = /[\u3400-\u9fff]+/g;
const OCR_NOISE_PATTERNS = [
  "TESSDATA_PREFIX",
  "Failed loading language",
  "Error opening data file",
  "Error in pixRead",
  "Image file /input cannot be read!",
  "Object unexpectedly",
  "Error attempting to read image"
];
const OCR_PDF_PAGE_LIMIT = 20;
const GRAPH_RELATED_FILE_LIMIT = 8;

let SQLPromise;
let pdfjsPromise;

function sql() {
  if (!SQLPromise) SQLPromise = initSqlJs();
  return SQLPromise;
}

async function pdfjs() {
  if (!pdfjsPromise) {
    const bundledPdfjsEntry = path.join(__dirname, "..", "node_modules", "pdf-parse", "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs");
    const fallbackPdfjsEntry = path.join(__dirname, "..", "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs");
    const resolvedEntry = fs.existsSync(bundledPdfjsEntry) ? bundledPdfjsEntry : fallbackPdfjsEntry;
    pdfjsPromise = import(pathToFileURL(resolvedEntry).href);
  }
  return pdfjsPromise;
}

function normalizeData(data) {
  return {
    categories: Array.isArray(data?.categories) ? data.categories : [],
    files: Array.isArray(data?.files) ? data.files : [],
    tags: Array.isArray(data?.tags) ? data.tags : [],
    rules: Array.isArray(data?.rules) ? data.rules : [],
    settings: {
      ...defaultData.settings,
      ...(data?.settings && typeof data.settings === "object" ? data.settings : {})
    }
  };
}

function tokenizeContent(value) {
  const text = String(value || "").toLowerCase();
  const tokens = new Set();

  const latinMatches = text.match(LATIN_TOKEN_PATTERN) || [];
  latinMatches.forEach((token) => tokens.add(token));

  const cjkMatches = text.match(CJK_SEQUENCE_PATTERN) || [];
  cjkMatches.forEach((sequence) => {
    if (sequence.length === 1) {
      tokens.add(sequence);
      return;
    }

    for (let index = 0; index < sequence.length - 1; index += 1) {
      tokens.add(sequence.slice(index, index + 2));
    }
  });

  return [...tokens];
}

function snippetForMatch(content, query, fallbackTokens = []) {
  const text = String(content || "");
  const loweredContent = text.toLowerCase();
  const loweredQuery = String(query || "").toLowerCase();
  let index = loweredQuery ? loweredContent.indexOf(loweredQuery) : -1;

  if (index < 0) {
    const token = fallbackTokens.find(Boolean);
    if (token) index = loweredContent.indexOf(String(token).toLowerCase());
  }

  if (index < 0) index = 0;
  const start = Math.max(index - 36, 0);
  const end = Math.min(index + Math.max(loweredQuery.length, 12) + 72, text.length);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

async function extractContentText(file) {
  const ext = String(file.ext || "").toLowerCase();
  if (!fs.existsSync(file.path)) throw new Error("文件不存在");

  if (PLAIN_TEXT_EXTS.has(ext)) {
    return fs.readFileSync(file.path, "utf8").slice(0, TEXT_INDEX_LIMIT);
  }

  if (ext === "docx") {
    const result = await mammoth.extractRawText({ path: file.path });
    return String(result.value || "").slice(0, TEXT_INDEX_LIMIT);
  }

  if (ext === "doc") {
    const result = await wordExtractor.extract(file.path);
    return String(result.getBody() || "").slice(0, TEXT_INDEX_LIMIT);
  }

  if (ext === "xlsx" || ext === "xls") {
    const workbook = XLSX.readFile(file.path, { cellDates: true });
    const chunks = [];
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      chunks.push(`工作表：${sheetName}`);
      chunks.push(XLSX.utils.sheet_to_csv(sheet));
    });
    return chunks.join("\n").slice(0, TEXT_INDEX_LIMIT);
  }

  if (ext === "pdf") {
    return extractPdfTextLayer(file);
  }

  throw new Error("暂不支持该文件类型");
}

async function extractPdfTextLayer(file, options = {}) {
  const pdfjsLib = await pdfjs();
  const data = new Uint8Array(fs.readFileSync(file.path));
  const loadingTask = pdfjsLib.getDocument({
    data,
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true
  });
  const pdf = await loadingTask.promise;

  try {
    const pageCount = Math.min(pdf.numPages || 0, OCR_PDF_PAGE_LIMIT);
    const chunks = [];

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      if (typeof options.isCanceled === "function" && options.isCanceled()) {
        throw new Error("OCR 已取消");
      }
      const page = await pdf.getPage(pageIndex + 1);
      const textContent = await page.getTextContent();
      const pageText = (textContent.items || [])
        .map((item) => ("str" in item ? String(item.str || "") : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (pageText) {
        chunks.push(`[第 ${pageIndex + 1} 页]`);
        chunks.push(pageText);
      }
      if (chunks.join("\n").length >= TEXT_INDEX_LIMIT) break;
    }

    return chunks.join("\n").slice(0, TEXT_INDEX_LIMIT);
  } finally {
    await loadingTask.destroy();
  }
}

function withSuppressedOcrLogs(task) {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const shouldSuppress = (chunk) => {
    const text = String(chunk || "");
    return OCR_NOISE_PATTERNS.some((pattern) => text.includes(pattern));
  };

  process.stdout.write = ((chunk, encoding, callback) => {
    if (shouldSuppress(chunk)) {
      if (typeof callback === "function") callback();
      return true;
    }
    return originalStdoutWrite(chunk, encoding, callback);
  });

  process.stderr.write = ((chunk, encoding, callback) => {
    if (shouldSuppress(chunk)) {
      if (typeof callback === "function") callback();
      return true;
    }
    return originalStderrWrite(chunk, encoding, callback);
  });

  return Promise.resolve()
    .then(task)
    .finally(() => {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    });
}

async function createOcrWorker(file, options = {}) {
  return createWorker(options.language || OCR_LANG_CODE, 1, {
    langPath: options.langPath,
    cachePath: options.cachePath,
    gzip: true,
    errorHandler: () => {},
    logger: (message) => {
      if (typeof options.isCanceled === "function" && options.isCanceled()) {
        throw new Error("OCR 已取消");
      }
      if (typeof options.onProgress === "function") {
        options.onProgress({
          fileId: file.id,
          fileName: file.name,
          status: message.status || "ocr",
          progress: Number(message.progress || 0)
        });
      }
    }
  });
}

async function recognizeWithWorker(worker, input) {
  return withSuppressedOcrLogs(async () => {
    const result = await worker.recognize(input);
    return String(result?.data?.text || "");
  });
}

async function renderPdfPagesForOcr(file, options = {}) {
  const parser = new PDFParse({ data: fs.readFileSync(file.path) });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-kb-pdf-ocr-"));

  try {
    const result = await parser.getScreenshot({
      first: 1,
      last: OCR_PDF_PAGE_LIMIT,
      imageDataUrl: false,
      imageBuffer: true,
      desiredWidth: 1800
    });
    const pageCount = Math.min(result.total || 0, OCR_PDF_PAGE_LIMIT, (result.pages || []).length);
    const renderedPages = [];

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      if (typeof options.isCanceled === "function" && options.isCanceled()) {
        throw new Error("OCR 已取消");
      }

      if (typeof options.onProgress === "function") {
        options.onProgress({
          fileId: file.id,
          fileName: file.name,
          status: `渲染 PDF 第 ${pageIndex + 1} 页`,
          progress: pageCount ? pageIndex / pageCount : 0
        });
      }

      const page = result.pages?.[pageIndex];
      if (!page?.data?.length) continue;
      const imagePath = path.join(tempDir, `page-${pageIndex + 1}.png`);
      fs.writeFileSync(imagePath, Buffer.from(page.data));
      renderedPages.push({
        pageNumber: pageIndex + 1,
        imagePath
      });
    }

    return renderedPages;
  } catch (error) {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    throw error;
  } finally {
    await parser.destroy();
  }
}

async function extractOcrText(file, options = {}) {
  const ext = String(file.ext || "").toLowerCase();
  if (!OCR_SUPPORTED_EXTS.has(ext)) throw new Error("暂不支持 OCR 的文件类型");
  if (!file.path || !fs.existsSync(file.path)) throw new Error("文件不存在");

  const stats = fs.statSync(file.path);
  if (OCR_IMAGE_EXTS.has(ext) && stats.size > OCR_FILE_SIZE_LIMIT) {
    throw new Error(`图片超过 ${Math.round(OCR_FILE_SIZE_LIMIT / 1024 / 1024)}MB，暂不进行 OCR`);
  }

  if (typeof options.isCanceled === "function" && options.isCanceled()) {
    throw new Error("OCR 已取消");
  }

  if (OCR_IMAGE_EXTS.has(ext)) {
    const worker = await createOcrWorker(file, options);
    try {
      const text = await recognizeWithWorker(worker, file.path);
      return String(text || "").slice(0, TEXT_INDEX_LIMIT);
    } finally {
      await worker.terminate();
    }
  }

  if (ext === "pdf") {
    const worker = await createOcrWorker(file, options);
    const pages = await renderPdfPagesForOcr(file, options);
    const chunks = [];

    try {
      for (const [pageIndex, page] of pages.entries()) {
        if (typeof options.isCanceled === "function" && options.isCanceled()) {
          throw new Error("OCR 已取消");
        }
        if (typeof options.onProgress === "function") {
          options.onProgress({
            fileId: file.id,
            fileName: file.name,
            status: `OCR 第 ${page.pageNumber} 页`,
            progress: pages.length ? pageIndex / pages.length : 0
          });
        }

        const text = await recognizeWithWorker(worker, page.imagePath);
        const normalizedText = String(text || "").trim();
        if (normalizedText) {
          chunks.push(`[第 ${page.pageNumber} 页]`);
          chunks.push(normalizedText);
        }

        if (chunks.join("\n").length >= TEXT_INDEX_LIMIT) break;
      }
    } finally {
      await worker.terminate();
      const tempDir = pages[0] ? path.dirname(pages[0].imagePath) : "";
      pages.forEach((page) => {
        if (page.imagePath && fs.existsSync(page.imagePath)) {
          fs.rmSync(page.imagePath, { force: true });
        }
      });
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }

    if (!chunks.length) {
      throw new Error("未从 PDF 图片页中识别到文本");
    }
    return chunks.join("\n").slice(0, TEXT_INDEX_LIMIT);
  }

  throw new Error("暂不支持 OCR 的文件类型");
}

async function createStore(userDataPath) {
  const dataPath = path.join(userDataPath, "metadata.sqlite");
  const legacyDataPath = path.join(userDataPath, "file-kb-store.json");
  const ocrCachePath = path.join(userDataPath, "tessdata");
  const SQL = await sql();

  function ensureOcrLanguageFiles(language = OCR_LANG_CODE) {
    fs.mkdirSync(ocrCachePath, { recursive: true });
    const langs = String(language || OCR_LANG_CODE).split("+").filter((lang) => OCR_LANGS.includes(lang));
    langs.forEach((lang) => {
      const sourcePath = OCR_LANG_PACKAGE_PATHS[lang];
      const targetPath = path.join(ocrCachePath, `${lang}.traineddata.gz`);
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`缺少 OCR 语言包：${lang}`);
      }
      if (!fs.existsSync(targetPath) || fs.statSync(targetPath).size !== fs.statSync(sourcePath).size) {
        fs.copyFileSync(sourcePath, targetPath);
      }
    });
  }

  function openDatabase() {
    if (fs.existsSync(dataPath)) {
      return new SQL.Database(fs.readFileSync(dataPath));
    }
    return new SQL.Database();
  }

  function persistDatabase(db) {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    fs.writeFileSync(dataPath, Buffer.from(db.export()));
  }

  function execSchema(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        ext TEXT NOT NULL DEFAULT '',
        size INTEGER NOT NULL DEFAULT 0,
        modified_at TEXT NOT NULL DEFAULT '',
        imported_at TEXT NOT NULL DEFAULT '',
        category_id TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        original_path TEXT,
        stored_path TEXT,
        import_mode TEXT,
        missing INTEGER NOT NULL DEFAULT 0,
        last_checked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS tags (
        name TEXT PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS file_tags (
        file_id TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        PRIMARY KEY (file_id, tag_name)
      );
      CREATE TABLE IF NOT EXISTS rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category_id TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS rule_keywords (
        rule_id TEXT NOT NULL,
        keyword TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (rule_id, keyword)
      );
      CREATE TABLE IF NOT EXISTS rule_tags (
        rule_id TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        PRIMARY KEY (rule_id, tag_name)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_index (
        file_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'none',
        source TEXT NOT NULL DEFAULT 'text',
        indexed_at TEXT,
        error TEXT,
        length INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS content_terms (
        term TEXT NOT NULL,
        file_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'text',
        PRIMARY KEY (term, file_id)
      );
      CREATE TABLE IF NOT EXISTS graph_nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        ref_id TEXT NOT NULL,
        name TEXT NOT NULL,
        meta_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS graph_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1,
        reason TEXT NOT NULL DEFAULT '',
        meta_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );
    `);
    const contentColumns = queryAll(db, "PRAGMA table_info(content_index)").map((column) => String(column.name));
    if (!contentColumns.includes("content")) {
      db.run("ALTER TABLE content_index ADD COLUMN content TEXT NOT NULL DEFAULT ''");
    }
    if (!contentColumns.includes("source")) {
      db.run("ALTER TABLE content_index ADD COLUMN source TEXT NOT NULL DEFAULT 'text'");
    }
    const contentTermCount = Number(queryAll(db, "SELECT COUNT(*) AS count FROM content_terms")[0]?.count || 0);
    const contentRowCount = Number(queryAll(db, "SELECT COUNT(*) AS count FROM content_index WHERE status = 'indexed' AND content <> ''")[0]?.count || 0);
    if (!contentTermCount && contentRowCount) {
      rebuildContentTerms(db);
    }
  }

  function rebuildContentTerms(db) {
    db.run("DELETE FROM content_terms");
    const rows = queryAll(
      db,
      "SELECT file_id AS fileId, source, content FROM content_index WHERE status = 'indexed' AND content <> ''"
    );
    rows.forEach((row) => {
      tokenizeContent(row.content).forEach((term) => {
        db.run("INSERT OR IGNORE INTO content_terms (term, file_id, source) VALUES (?, ?, ?)", [
          term,
          row.fileId,
          row.source || "text"
        ]);
      });
    });
  }

  function replaceContentIndex(db, fileId, status, source, indexedAt, error, content) {
    db.run("DELETE FROM content_index WHERE file_id = ?", [fileId]);
    db.run("DELETE FROM content_terms WHERE file_id = ?", [fileId]);
    db.run("INSERT INTO content_index (file_id, status, source, indexed_at, error, length, content) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      fileId,
      status,
      source,
      indexedAt,
      error,
      content.length,
      content
    ]);

    if (status === "indexed" && content) {
      tokenizeContent(content).forEach((term) => {
        db.run("INSERT OR IGNORE INTO content_terms (term, file_id, source) VALUES (?, ?, ?)", [term, fileId, source]);
      });
    }
  }

  function graphNodeId(type, refId) {
    return `${type}:${refId || "root"}`;
  }

  function graphEdgeId(type, sourceId, targetId) {
    return `${type}:${sourceId}->${targetId}`;
  }

  function insertGraphNode(db, node) {
    db.run(
      "INSERT OR REPLACE INTO graph_nodes (id, type, ref_id, name, meta_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [
        node.id,
        node.type,
        node.refId || "",
        node.name || "",
        JSON.stringify(node.meta || {}),
        node.updatedAt
      ]
    );
  }

  function insertGraphEdge(db, edge) {
    db.run(
      "INSERT OR REPLACE INTO graph_edges (id, source_id, target_id, type, weight, reason, meta_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        edge.id,
        edge.source,
        edge.target,
        edge.type,
        Number(edge.weight || 1),
        edge.reason || "",
        JSON.stringify(edge.meta || {}),
        edge.updatedAt
      ]
    );
  }

  function categoryPathForGraph(categories, categoryId) {
    const byId = new Map(categories.map((category) => [category.id, category]));
    function parts(id) {
      const category = byId.get(id);
      if (!category) return [];
      if (!category.parentId) return [category.name];
      return [...parts(category.parentId), category.name];
    }
    return parts(categoryId).join(" / ");
  }

  function termsForFiles(db, fileIds) {
    const result = new Map(fileIds.map((fileId) => [fileId, new Set()]));
    fileIds.forEach((fileId) => {
      queryValues(db, "SELECT term FROM content_terms WHERE file_id = ? LIMIT 120", [fileId])
        .forEach((term) => result.get(fileId)?.add(String(term)));
    });
    return result;
  }

  function rebuildGraph(db, data = loadFromDatabase(db)) {
    const normalized = normalizeData(data);
    const updatedAt = new Date().toISOString();
    db.run("DELETE FROM graph_nodes");
    db.run("DELETE FROM graph_edges");

    insertGraphNode(db, {
      id: graphNodeId("category", ""),
      type: "category",
      refId: "",
      name: "全部文件",
      meta: {
        path: "全部文件",
        note: "知识库根节点"
      },
      updatedAt
    });

    normalized.categories.forEach((category) => {
      insertGraphNode(db, {
        id: graphNodeId("category", category.id),
        type: "category",
        refId: category.id,
        name: category.name,
        meta: {
          path: categoryPathForGraph(normalized.categories, category.id),
          note: category.note || ""
        },
        updatedAt
      });

      const parentNodeId = graphNodeId("category", category.parentId || "");
      insertGraphEdge(db, {
        id: graphEdgeId("child_of", graphNodeId("category", category.id), parentNodeId),
        source: graphNodeId("category", category.id),
        target: parentNodeId,
        type: "child_of",
        weight: 1,
        reason: category.parentId ? "父级分类" : "一级分类",
        updatedAt
      });
    });

    normalized.tags.forEach((tag) => {
      insertGraphNode(db, {
        id: graphNodeId("tag", tag),
        type: "tag",
        refId: tag,
        name: tag,
        updatedAt
      });
    });

    normalized.files.forEach((file) => {
      insertGraphNode(db, {
        id: graphNodeId("file", file.id),
        type: "file",
        refId: file.id,
        name: file.name,
        meta: {
          ext: file.ext || "",
          path: file.path || "",
          categoryId: file.categoryId || "",
          note: file.note || ""
        },
        updatedAt
      });

      const ownerCategoryNodeId = graphNodeId("category", file.categoryId || "");
      insertGraphEdge(db, {
        id: graphEdgeId("contains_file", ownerCategoryNodeId, graphNodeId("file", file.id)),
        source: ownerCategoryNodeId,
        target: graphNodeId("file", file.id),
        type: "contains_file",
        weight: 1,
        reason: file.categoryId ? "文件分类" : "未分类文件",
        updatedAt
      });

      (file.tags || []).forEach((tag) => {
        insertGraphNode(db, {
          id: graphNodeId("tag", tag),
          type: "tag",
          refId: tag,
          name: tag,
          updatedAt
        });
        insertGraphEdge(db, {
          id: graphEdgeId("tagged_with", graphNodeId("file", file.id), graphNodeId("tag", tag)),
          source: graphNodeId("file", file.id),
          target: graphNodeId("tag", tag),
          type: "tagged_with",
          weight: 1,
          reason: "文件标签",
          updatedAt
        });
      });
    });

    const fileTerms = termsForFiles(db, normalized.files.map((file) => file.id));
    normalized.files.forEach((file) => {
      const terms = fileTerms.get(file.id) || new Set();
      tokenizeContent(`${file.name} ${file.note || ""}`).forEach((term) => terms.add(term));
    });

    const relatedBySource = new Map();
    for (let leftIndex = 0; leftIndex < normalized.files.length; leftIndex += 1) {
      const left = normalized.files[leftIndex];
      const leftTerms = fileTerms.get(left.id) || new Set();
      for (let rightIndex = leftIndex + 1; rightIndex < normalized.files.length; rightIndex += 1) {
        const right = normalized.files[rightIndex];
        let score = 0;
        const reasons = [];

        if (left.categoryId && left.categoryId === right.categoryId) {
          score += 2;
          reasons.push("同分类");
        }

        const sharedTags = (left.tags || []).filter((tag) => (right.tags || []).includes(tag));
        if (sharedTags.length) {
          score += sharedTags.length * 3;
          reasons.push(`同标签：${sharedTags.slice(0, 3).join("、")}`);
        }

        const rightTerms = fileTerms.get(right.id) || new Set();
        const sharedTerms = [...leftTerms].filter((term) => rightTerms.has(term)).slice(0, 6);
        if (sharedTerms.length) {
          score += Math.min(sharedTerms.length, 6);
          reasons.push(`关键词：${sharedTerms.slice(0, 4).join("、")}`);
        }

        if (score < 4) continue;
        const item = {
          left,
          right,
          score,
          reason: reasons.join("；")
        };
        relatedBySource.set(left.id, [...(relatedBySource.get(left.id) || []), item]);
        relatedBySource.set(right.id, [...(relatedBySource.get(right.id) || []), item]);
      }
    }

    const inserted = new Set();
    relatedBySource.forEach((items) => {
      items
        .sort((a, b) => b.score - a.score)
        .slice(0, GRAPH_RELATED_FILE_LIMIT)
        .forEach((item) => {
          const sourceId = graphNodeId("file", item.left.id);
          const targetId = graphNodeId("file", item.right.id);
          const id = graphEdgeId("related_file", sourceId, targetId);
          if (inserted.has(id)) return;
          inserted.add(id);
          insertGraphEdge(db, {
            id,
            source: sourceId,
            target: targetId,
            type: "related_file",
            weight: item.score,
            reason: item.reason,
            meta: {
              leftFileId: item.left.id,
              rightFileId: item.right.id
            },
            updatedAt
          });
        });
    });

    return {
      nodeCount: Number(queryAll(db, "SELECT COUNT(*) AS count FROM graph_nodes")[0]?.count || 0),
      edgeCount: Number(queryAll(db, "SELECT COUNT(*) AS count FROM graph_edges")[0]?.count || 0),
      updatedAt
    };
  }

  function queryAll(db, sqlText, params = []) {
    const stmt = db.prepare(sqlText);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function queryValues(db, sqlText, params = []) {
    return queryAll(db, sqlText, params).map((row) => Object.values(row)[0]);
  }

  function loadFromDatabase(db) {
    const categories = queryAll(
      db,
      "SELECT id, name, parent_id AS parentId, sort_order AS sortOrder, note FROM categories ORDER BY sort_order, name"
    ).map((category) => ({
      ...category,
      parentId: category.parentId || null,
      sortOrder: Number(category.sortOrder || 0),
      note: category.note || ""
    }));

    const files = queryAll(
      db,
      `SELECT id, name, path, ext, size, modified_at AS modifiedAt, imported_at AS importedAt,
        category_id AS categoryId, note, original_path AS originalPath, stored_path AS storedPath,
        import_mode AS importMode, missing, last_checked_at AS lastCheckedAt
       FROM files
       ORDER BY imported_at DESC, name`
    ).map((file) => ({
      ...file,
      size: Number(file.size || 0),
      categoryId: file.categoryId || "",
      note: file.note || "",
      originalPath: file.originalPath || undefined,
      storedPath: file.storedPath || undefined,
      importMode: file.importMode || undefined,
      missing: Boolean(file.missing),
      lastCheckedAt: file.lastCheckedAt || undefined,
      contentIndexStatus:
        queryValues(db, "SELECT status FROM content_index WHERE file_id = ?", [file.id])[0] || "none",
      contentIndexSource:
        queryValues(db, "SELECT source FROM content_index WHERE file_id = ?", [file.id])[0] || undefined,
      contentIndexedAt:
        queryValues(db, "SELECT indexed_at FROM content_index WHERE file_id = ?", [file.id])[0] || undefined,
      contentIndexError:
        queryValues(db, "SELECT error FROM content_index WHERE file_id = ?", [file.id])[0] || undefined,
      tags: queryValues(db, "SELECT tag_name FROM file_tags WHERE file_id = ? ORDER BY tag_name", [file.id])
    }));

    const rules = queryAll(db, "SELECT id, name, category_id AS categoryId, enabled FROM rules ORDER BY name").map((rule) => ({
      id: rule.id,
      name: rule.name,
      categoryId: rule.categoryId || "",
      enabled: Boolean(rule.enabled),
      keywords: queryValues(db, "SELECT keyword FROM rule_keywords WHERE rule_id = ? ORDER BY position, keyword", [rule.id]),
      tags: queryValues(db, "SELECT tag_name FROM rule_tags WHERE rule_id = ? ORDER BY tag_name", [rule.id])
    }));

    const settingsRows = queryAll(db, "SELECT key, value FROM settings");
    const settings = settingsRows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});

    return normalizeData({
      categories,
      files,
      tags: queryValues(db, "SELECT name FROM tags ORDER BY name"),
      rules,
      settings
    });
  }

  function saveToDatabase(db, data) {
    const normalized = normalizeData(data);
    db.run("BEGIN TRANSACTION");
    try {
      db.run("DELETE FROM categories");
      db.run("DELETE FROM files");
      db.run("DELETE FROM tags");
      db.run("DELETE FROM file_tags");
      db.run("DELETE FROM rules");
      db.run("DELETE FROM rule_keywords");
      db.run("DELETE FROM rule_tags");
      db.run("DELETE FROM settings");

      normalized.categories.forEach((category) => {
        db.run("INSERT INTO categories (id, name, parent_id, sort_order, note) VALUES (?, ?, ?, ?, ?)", [
          category.id,
          category.name,
          category.parentId || null,
          category.sortOrder || 0,
          category.note || ""
        ]);
      });

      const allTags = new Set(normalized.tags);
      normalized.files.forEach((file) => file.tags?.forEach((tag) => allTags.add(tag)));
      normalized.rules.forEach((rule) => rule.tags?.forEach((tag) => allTags.add(tag)));
      [...allTags].filter(Boolean).forEach((tag) => db.run("INSERT OR IGNORE INTO tags (name) VALUES (?)", [tag]));

      normalized.files.forEach((file) => {
        db.run(
          `INSERT INTO files
            (id, name, path, ext, size, modified_at, imported_at, category_id, note, original_path, stored_path, import_mode, missing, last_checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            file.id,
            file.name,
            file.path,
            file.ext || "",
            file.size || 0,
            file.modifiedAt || "",
            file.importedAt || "",
            file.categoryId || "",
            file.note || "",
            file.originalPath || null,
            file.storedPath || null,
            file.importMode || null,
            file.missing ? 1 : 0,
            file.lastCheckedAt || null
          ]
        );
        (file.tags || []).filter(Boolean).forEach((tag) => {
          db.run("INSERT OR IGNORE INTO tags (name) VALUES (?)", [tag]);
          db.run("INSERT OR IGNORE INTO file_tags (file_id, tag_name) VALUES (?, ?)", [file.id, tag]);
        });
      });

      const fileIds = new Set(normalized.files.map((file) => file.id));
      queryValues(db, "SELECT file_id FROM content_index").forEach((fileId) => {
        if (!fileIds.has(fileId)) {
          db.run("DELETE FROM content_index WHERE file_id = ?", [fileId]);
          db.run("DELETE FROM content_terms WHERE file_id = ?", [fileId]);
        }
      });

      normalized.rules.forEach((rule) => {
        db.run("INSERT INTO rules (id, name, category_id, enabled) VALUES (?, ?, ?, ?)", [
          rule.id,
          rule.name,
          rule.categoryId || "",
          rule.enabled ? 1 : 0
        ]);
        (rule.keywords || []).filter(Boolean).forEach((keyword, index) => {
          db.run("INSERT OR IGNORE INTO rule_keywords (rule_id, keyword, position) VALUES (?, ?, ?)", [rule.id, keyword, index]);
        });
        (rule.tags || []).filter(Boolean).forEach((tag) => {
          db.run("INSERT OR IGNORE INTO tags (name) VALUES (?)", [tag]);
          db.run("INSERT OR IGNORE INTO rule_tags (rule_id, tag_name) VALUES (?, ?)", [rule.id, tag]);
        });
      });

      Object.entries(normalized.settings).forEach(([key, value]) => {
        db.run("INSERT INTO settings (key, value) VALUES (?, ?)", [key, String(value)]);
      });

      rebuildGraph(db, normalized);

      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }

  function initialize() {
    const db = openDatabase();
    execSchema(db);

    if (!fs.existsSync(dataPath) && fs.existsSync(legacyDataPath)) {
      const legacyData = JSON.parse(fs.readFileSync(legacyDataPath, "utf8"));
      saveToDatabase(db, legacyData);
    } else if (!fs.existsSync(dataPath)) {
      saveToDatabase(db, defaultData);
    }

    persistDatabase(db);
    db.close();
  }

  initialize();

  function load() {
    const db = openDatabase();
    execSchema(db);
    const data = loadFromDatabase(db);
    db.close();
    return data;
  }

  function save(data) {
    const normalized = normalizeData(data);
    const db = openDatabase();
    execSchema(db);
    saveToDatabase(db, normalized);
    persistDatabase(db);
    db.close();
    return normalized;
  }

  function update(mutator) {
    const data = load();
    const next = mutator(data) || data;
    return save(next);
  }

  async function indexTextFiles(files) {
    const db = openDatabase();
    execSchema(db);
    const results = [];

    db.run("BEGIN TRANSACTION");
    try {
      for (const file of files) {
        const ext = String(file.ext || "").toLowerCase();
        if (!SUPPORTED_TEXT_EXTS.has(ext)) {
          const indexedAt = new Date().toISOString();
          replaceContentIndex(db, file.id, "skipped", "text", indexedAt, "暂不支持该文件类型", "");
          results.push({
            id: file.id,
            status: "skipped",
            source: "text",
            error: "暂不支持该文件类型",
            indexedAt
          });
          continue;
        }

        try {
          if (!file.path || !fs.existsSync(file.path)) {
            throw new Error("文件不存在");
          }

          const content = await extractContentText(file);
          const indexedAt = new Date().toISOString();
          replaceContentIndex(db, file.id, "indexed", "text", indexedAt, null, content);
          results.push({ id: file.id, status: "indexed", error: "", indexedAt });
        } catch (error) {
          const indexedAt = new Date().toISOString();
          replaceContentIndex(db, file.id, "failed", "text", indexedAt, error.message || String(error), "");
          results.push({ id: file.id, status: "failed", error: error.message || String(error), indexedAt });
        }
      }
      db.run("COMMIT");
      rebuildGraph(db);
    } catch (error) {
      db.run("ROLLBACK");
      db.close();
      throw error;
    }

    persistDatabase(db);
    db.close();
    return results;
  }

  async function indexOcrFiles(files, onProgress, options = {}) {
    const db = openDatabase();
    execSchema(db);
    const results = [];
    const language = options.language || OCR_LANG_CODE;
    ensureOcrLanguageFiles(language);

    db.run("BEGIN TRANSACTION");
    try {
      for (const [index, file] of files.entries()) {
        if (typeof options.isCanceled === "function" && options.isCanceled()) {
          break;
        }
        const ext = String(file.ext || "").toLowerCase();
        if (typeof onProgress === "function") {
          onProgress({
            fileId: file.id,
            fileName: file.name,
            current: index + 1,
            total: files.length,
            status: "准备 OCR",
            progress: 0
          });
        }

        if (!OCR_SUPPORTED_EXTS.has(ext)) {
          const indexedAt = new Date().toISOString();
          replaceContentIndex(db, file.id, "skipped", "ocr", indexedAt, "暂不支持 OCR 的文件类型", "");
          results.push({
            id: file.id,
            status: "skipped",
            source: "ocr",
            error: "暂不支持 OCR 的文件类型",
            indexedAt
          });
          continue;
        }

        try {
          const content = await extractOcrText(file, {
            language,
            langPath: ocrCachePath,
            cachePath: ocrCachePath,
            isCanceled: options.isCanceled,
            onProgress: (progress) => {
              if (typeof onProgress === "function") {
                onProgress({
                  current: index + 1,
                  total: files.length,
                  ...progress
                });
              }
            }
          });
          const indexedAt = new Date().toISOString();
          replaceContentIndex(db, file.id, "indexed", "ocr", indexedAt, null, content);
          results.push({ id: file.id, status: "indexed", source: "ocr", error: "", indexedAt });
          if (typeof onProgress === "function") {
            onProgress({
              fileId: file.id,
              fileName: file.name,
              current: index + 1,
              total: files.length,
              status: "完成",
              progress: 1
            });
          }
        } catch (error) {
          const indexedAt = new Date().toISOString();
          replaceContentIndex(db, file.id, "failed", "ocr", indexedAt, error.message || String(error), "");
          results.push({ id: file.id, status: "failed", source: "ocr", error: error.message || String(error), indexedAt });
        }
      }
      db.run("COMMIT");
      rebuildGraph(db);
    } catch (error) {
      db.run("ROLLBACK");
      db.close();
      throw error;
    }

    persistDatabase(db);
    db.close();
    return results;
  }

  function searchContent(query) {
    const trimmed = String(query || "").trim();
    if (!trimmed) return [];
    const db = openDatabase();
    execSchema(db);
    const tokens = tokenizeContent(trimmed);
    if (!tokens.length) {
      db.close();
      return [];
    }

    const placeholders = tokens.map(() => "?").join(", ");
    const candidateRows = queryAll(
      db,
      `SELECT file_id AS fileId, COUNT(*) AS hitCount
       FROM content_terms
       WHERE term IN (${placeholders})
       GROUP BY file_id
       ORDER BY hitCount DESC
       LIMIT 500`,
      tokens
    );

    if (!candidateRows.length) {
      db.close();
      return [];
    }

    const rows = candidateRows.map((row) => {
      const contentRow = queryAll(
        db,
        "SELECT source, content FROM content_index WHERE file_id = ? AND status = 'indexed'",
        [row.fileId]
      )[0];
      if (!contentRow) return null;
      return {
        fileId: row.fileId,
        source: contentRow.source || "text",
        content: String(contentRow.content || ""),
        hitCount: Number(row.hitCount || 0)
      };
    }).filter(Boolean);
    db.close();
    return rows
      .map((row) => {
        const content = String(row.content || "");
        const loweredContent = content.toLowerCase();
        const loweredQuery = trimmed.toLowerCase();
        const matched = loweredContent.includes(loweredQuery) || tokens.some((token) => loweredContent.includes(token));
        if (!matched) return null;
        return {
          fileId: row.fileId,
          source: row.source || "text",
          snippet: snippetForMatch(content, trimmed, tokens),
          hitCount: row.hitCount
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, 500)
      .map((row) => row);
  }

  function contentTextByFileIds(fileIds) {
    const ids = Array.isArray(fileIds) ? fileIds.filter(Boolean) : [];
    if (!ids.length) return {};
    const db = openDatabase();
    execSchema(db);
    const result = {};
    ids.forEach((fileId) => {
      const rows = queryAll(db, "SELECT content FROM content_index WHERE file_id = ? AND status = 'indexed'", [fileId]);
      result[fileId] = rows[0]?.content || "";
    });
    db.close();
    return result;
  }

  function getContentIndex(fileId) {
    const db = openDatabase();
    execSchema(db);
    const rows = queryAll(
      db,
      "SELECT status, source, indexed_at AS indexedAt, error, length, content FROM content_index WHERE file_id = ?",
      [fileId]
    );
    db.close();
    const row = rows[0];
    if (!row) {
      return {
        status: "none",
        source: "",
        indexedAt: "",
        error: "",
        length: 0,
        content: ""
      };
    }
    return {
      status: row.status || "none",
      source: row.source || "",
      indexedAt: row.indexedAt || "",
      error: row.error || "",
      length: Number(row.length || 0),
      content: row.content || ""
    };
  }

  function contentIndexSize() {
    const db = openDatabase();
    execSchema(db);
    const rows = queryAll(db, "SELECT COALESCE(SUM(length), 0) AS total FROM content_index WHERE status = 'indexed'");
    db.close();
    return Number(rows[0]?.total || 0);
  }

  function graphRowsToPayload(db, nodeRows, edgeRows) {
    const nodeIds = new Set(nodeRows.map((node) => node.id));
    return {
      nodes: nodeRows.map((node) => ({
        id: node.id,
        type: node.type,
        refId: node.refId || "",
        name: node.name || "",
        meta: JSON.parse(node.metaJson || "{}")
      })),
      edges: edgeRows
        .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: edge.type,
          weight: Number(edge.weight || 1),
          reason: edge.reason || "",
          meta: JSON.parse(edge.metaJson || "{}")
        }))
    };
  }

  function ensureGraphBuilt(db) {
    const count = Number(queryAll(db, "SELECT COUNT(*) AS count FROM graph_nodes")[0]?.count || 0);
    if (!count) rebuildGraph(db);
  }

  function graphStats() {
    const db = openDatabase();
    execSchema(db);
    ensureGraphBuilt(db);
    const nodeCount = Number(queryAll(db, "SELECT COUNT(*) AS count FROM graph_nodes")[0]?.count || 0);
    const edgeCount = Number(queryAll(db, "SELECT COUNT(*) AS count FROM graph_edges")[0]?.count || 0);
    const updatedAt = queryValues(db, "SELECT MAX(updated_at) FROM graph_nodes")[0] || "";
    db.close();
    return { nodeCount, edgeCount, updatedAt };
  }

  function rebuildGraphIndex() {
    const db = openDatabase();
    execSchema(db);
    db.run("BEGIN TRANSACTION");
    try {
      const result = rebuildGraph(db);
      db.run("COMMIT");
      persistDatabase(db);
      db.close();
      return result;
    } catch (error) {
      db.run("ROLLBACK");
      db.close();
      throw error;
    }
  }

  function graphForFile(fileId) {
    const db = openDatabase();
    execSchema(db);
    ensureGraphBuilt(db);
    const centerId = graphNodeId("file", fileId);
    const edgeRows = queryAll(
      db,
      `SELECT id, source_id AS source, target_id AS target, type, weight, reason, meta_json AS metaJson
       FROM graph_edges
       WHERE source_id = ? OR target_id = ?
       ORDER BY weight DESC, type
       LIMIT 80`,
      [centerId, centerId]
    );
    const nodeIds = new Set([centerId]);
    edgeRows.forEach((edge) => {
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    });
    const nodeRows = [...nodeIds].flatMap((nodeId) =>
      queryAll(
        db,
        "SELECT id, type, ref_id AS refId, name, meta_json AS metaJson FROM graph_nodes WHERE id = ?",
        [nodeId]
      )
    );
    const payload = graphRowsToPayload(db, nodeRows, edgeRows);
    db.close();
    return payload;
  }

  function graphForCategory(categoryId) {
    const db = openDatabase();
    execSchema(db);
    ensureGraphBuilt(db);
    const centerId = graphNodeId("category", categoryId);
    const edgeRows = queryAll(
      db,
      `SELECT id, source_id AS source, target_id AS target, type, weight, reason, meta_json AS metaJson
       FROM graph_edges
       WHERE source_id = ? OR target_id = ?
       ORDER BY type, weight DESC
       LIMIT 120`,
      [centerId, centerId]
    );
    const nodeIds = new Set([centerId]);
    edgeRows.forEach((edge) => {
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    });
    const nodeRows = [...nodeIds].flatMap((nodeId) =>
      queryAll(
        db,
        "SELECT id, type, ref_id AS refId, name, meta_json AS metaJson FROM graph_nodes WHERE id = ?",
        [nodeId]
      )
    );
    const payload = graphRowsToPayload(db, nodeRows, edgeRows);
    db.close();
    return payload;
  }

  return {
    dataPath,
    legacyDataPath,
    load,
    save,
    update,
    indexTextFiles,
    indexOcrFiles,
    searchContent,
    contentTextByFileIds,
    getContentIndex,
    contentIndexSize,
    rebuildGraphIndex,
    graphForFile,
    graphForCategory,
    graphStats
  };
}

module.exports = { createStore };
