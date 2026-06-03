const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js/dist/sql-asm.js");

const defaultData = {
  categories: [],
  files: [],
  tags: [],
  rules: [],
  settings: {
    libraryDir: "",
    archiveRuleScope: "root"
  }
};

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

async function createStore(userDataPath) {
  const dataPath = path.join(userDataPath, "metadata.sqlite");
  const legacyDataPath = path.join(userDataPath, "file-kb-store.json");
  const SQL = await sql();

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
    `);
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

  return { dataPath, legacyDataPath, load, save, update };
}

module.exports = { createStore };
