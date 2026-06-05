const express = require("express");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const DATA_DIR = path.resolve("C:/SwiftTill/data");

async function ensureDataDir() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error("Failed to create data dir:", err);
  }
}

function fileForKey(key) {
  // keep keys simple (no path traversal)
  const safe = key.replace(/[^a-zA-Z0-9_\-]/g, "_");
  return path.join(DATA_DIR, `${safe}.json`);
}

app.get("/api/data", async (req, res) => {
  await ensureDataDir();
  try {
    const files = await fsp.readdir(DATA_DIR);
    const result = {};
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const key = file.replace(/\.json$/, "");
      try {
        const txt = await fsp.readFile(path.join(DATA_DIR, file), "utf8");
        result[key] = { value: JSON.parse(txt) };
      } catch (err) {
        result[key] = { value: null };
      }
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/data/:key", async (req, res) => {
  await ensureDataDir();
  const key = req.params.key;
  const file = fileForKey(key);
  try {
    const txt = await fsp.readFile(file, "utf8");
    res.json({ value: JSON.parse(txt) });
  } catch (err) {
    // return 200 with null value when missing to match client tolerance
    res.json({ value: null });
  }
});

app.put("/api/data/:key", async (req, res) => {
  await ensureDataDir();
  const key = req.params.key;
  const body = req.body || {};
  const value = body.value === undefined ? null : body.value;
  const file = fileForKey(key);
  try {
    if (value === null) {
      // remove file if exists
      await fsp.unlink(file).catch(() => {});
      return res.json({ ok: true });
    }
    await fsp.writeFile(file, JSON.stringify(value, null, 2), "utf8");
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(
    `SwiftTill demo sync server listening on http://localhost:${PORT}`,
  );
});
