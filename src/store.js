const fs = require("fs");
const path = require("path");

const defaultData = {
  categories: [],
  files: [],
  tags: [],
  rules: [],
  settings: {
    libraryDir: ""
  }
};

function createStore(userDataPath) {
  const dataPath = path.join(userDataPath, "file-kb-store.json");

  function load() {
    if (!fs.existsSync(dataPath)) {
      save(defaultData);
      return structuredClone(defaultData);
    }

    const raw = fs.readFileSync(dataPath, "utf8");
    const data = JSON.parse(raw);
    return {
      categories: Array.isArray(data.categories) ? data.categories : defaultData.categories,
      files: Array.isArray(data.files) ? data.files : [],
      tags: Array.isArray(data.tags) ? data.tags : [],
      rules: Array.isArray(data.rules) ? data.rules : [],
      settings: {
        ...defaultData.settings,
        ...(data.settings && typeof data.settings === "object" ? data.settings : {})
      }
    };
  }

  function save(data) {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf8");
    return data;
  }

  function update(mutator) {
    const data = load();
    const next = mutator(data) || data;
    return save(next);
  }

  return { dataPath, load, save, update };
}

module.exports = { createStore };
