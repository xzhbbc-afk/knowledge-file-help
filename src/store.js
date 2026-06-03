const fs = require("fs");
const path = require("path");
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
const SUPPORTED_TEXT_EXTS = new Set([...PLAIN_TEXT_EXTS, ...OFFICE_TEXT_EXTS, ...PDF_TEXT_EXTS]);
const wordExtractor = new WordExtractor();

let SQLPromise;

function sql() {
  if (!SQLPromise) SQLPromise = initSqlJs();
  return SQLPromise;
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
    const parser = new PDFParse({ data: fs.readFileSync(file.path) });
    try {
      const data = await parser.getText();
      return String(data.text || "").slice(0, TEXT_INDEX_LIMIT);
    } finally {
      await parser.destroy();
    }
  }

  throw new Error("暂不支持该文件类型");
}

async function extractOcrText(file, options = {}) {
  const ext = String(file.ext || "").toLowerCase();
  if (!OCR_IMAGE_EXTS.has(ext)) throw new Error("暂不支持该图片类型");
  if (!file.path || !fs.existsSync(file.path)) throw new Error("文件不存在");

  const stats = fs.statSync(file.path);
  if (stats.size > OCR_FILE_SIZE_LIMIT) {
    throw new Error(`图片超过 ${Math.round(OCR_FILE_SIZE_LIMIT / 1024 / 1024)}MB，暂不进行 OCR`);
  }

  const worker = await createWorker(options.language || OCR_LANG_CODE, 1, {
    langPath: options.langPath,
    cachePath: options.cachePath,
    gzip: true,
    errorHandler: () => {},
    logger: (message) => {
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

  try {
    const result = await worker.recognize(file.path);
    return String(result?.data?.text || "").slice(0, TEXT_INDEX_LIMIT);
  } finally {
    await worker.terminate();
  }
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
    `);
    const contentColumns = queryAll(db, "PRAGMA table_info(content_index)").map((column) => String(column.name));
    if (!contentColumns.includes("content")) {
      db.run("ALTER TABLE content_index ADD COLUMN content TEXT NOT NULL DEFAULT ''");
    }
    if (!contentColumns.includes("source")) {
      db.run("ALTER TABLE content_index ADD COLUMN source TEXT NOT NULL DEFAULT 'text'");
    }
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
        if (!fileIds.has(fileId)) db.run("DELETE FROM content_index WHERE file_id = ?", [fileId]);
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
          db.run("DELETE FROM content_index WHERE file_id = ?", [file.id]);
          db.run("INSERT INTO content_index (file_id, status, source, indexed_at, error, length, content) VALUES (?, ?, ?, ?, ?, ?, ?)", [
            file.id,
            "skipped",
            "text",
            indexedAt,
            "暂不支持该文件类型",
            0,
            ""
          ]);
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
          db.run("DELETE FROM content_index WHERE file_id = ?", [file.id]);
          db.run("INSERT INTO content_index (file_id, status, source, indexed_at, error, length, content) VALUES (?, ?, ?, ?, ?, ?, ?)", [
            file.id,
            "indexed",
            "text",
            indexedAt,
            null,
            content.length,
            content
          ]);
          results.push({ id: file.id, status: "indexed", error: "", indexedAt });
        } catch (error) {
          const indexedAt = new Date().toISOString();
          db.run("DELETE FROM content_index WHERE file_id = ?", [file.id]);
          db.run("INSERT INTO content_index (file_id, status, source, indexed_at, error, length, content) VALUES (?, ?, ?, ?, ?, ?, ?)", [
            file.id,
            "failed",
            "text",
            indexedAt,
            error.message || String(error),
            0,
            ""
          ]);
          results.push({ id: file.id, status: "failed", error: error.message || String(error), indexedAt });
        }
      }
      db.run("COMMIT");
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

        if (!OCR_IMAGE_EXTS.has(ext)) {
          const indexedAt = new Date().toISOString();
          db.run("DELETE FROM content_index WHERE file_id = ?", [file.id]);
          db.run("INSERT INTO content_index (file_id, status, source, indexed_at, error, length, content) VALUES (?, ?, ?, ?, ?, ?, ?)", [
            file.id,
            "skipped",
            "ocr",
            indexedAt,
            "暂不支持 OCR 的文件类型",
            0,
            ""
          ]);
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
          db.run("DELETE FROM content_index WHERE file_id = ?", [file.id]);
          db.run("INSERT INTO content_index (file_id, status, source, indexed_at, error, length, content) VALUES (?, ?, ?, ?, ?, ?, ?)", [
            file.id,
            "indexed",
            "ocr",
            indexedAt,
            null,
            content.length,
            content
          ]);
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
          db.run("DELETE FROM content_index WHERE file_id = ?", [file.id]);
          db.run("INSERT INTO content_index (file_id, status, source, indexed_at, error, length, content) VALUES (?, ?, ?, ?, ?, ?, ?)", [
            file.id,
            "failed",
            "ocr",
            indexedAt,
            error.message || String(error),
            0,
            ""
          ]);
          results.push({ id: file.id, status: "failed", source: "ocr", error: error.message || String(error), indexedAt });
        }
      }
      db.run("COMMIT");
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
    const lowered = trimmed.toLowerCase();
    const rows = queryAll(db, "SELECT file_id AS fileId, source, content FROM content_index WHERE status = 'indexed'");
    db.close();
    return rows
      .map((row) => {
        const content = String(row.content || "");
        const index = content.toLowerCase().indexOf(lowered);
        if (index < 0) return null;
        const start = Math.max(index - 36, 0);
        const end = Math.min(index + trimmed.length + 72, content.length);
        return {
          fileId: row.fileId,
          source: row.source || "text",
          snippet: content.slice(start, end).replace(/\s+/g, " ").trim()
        };
      })
      .filter(Boolean)
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

  return { dataPath, legacyDataPath, load, save, update, indexTextFiles, indexOcrFiles, searchContent, contentTextByFileIds, getContentIndex, contentIndexSize };
}

module.exports = { createStore };
