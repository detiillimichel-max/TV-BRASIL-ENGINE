const { put } = require("@vercel/blob");
const crypto = require("node:crypto");

const SOURCE_URL =
  "https://raw.githubusercontent.com/detiillimichel-max/TV-BRASIL-ENGINE/main/tv-brasil-engine-biblioteca-88-canais.json";

function reply(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.send(JSON.stringify(body));
}

function sameSecret(received, expected) {
  if (typeof received !== "string" || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sortedIds(document) {
  return document.channels.map((channel) => channel.id).sort();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { ok: false, error: "Use POST." });
  }

  const expectedKey = process.env.TV_BACKUP_API_KEY;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const authorization = req.headers.authorization || "";
  const receivedKey = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!sameSecret(receivedKey, expectedKey)) {
    return reply(res, 401, { ok: false, error: "Não autorizado." });
  }
  if (!blobToken) {
    return reply(res, 500, { ok: false, error: "BLOB_READ_WRITE_TOKEN não configurado." });
  }

  try {
    const sourceResponse = await fetch(SOURCE_URL, {
      headers: { "Cache-Control": "no-cache" },
    });
    if (!sourceResponse.ok) {
      throw new Error("GitHub respondeu HTTP " + sourceResponse.status);
    }

    const sourceText = await sourceResponse.text();
    const source = JSON.parse(sourceText);

    if (
      source.total !== 88 ||
      !Array.isArray(source.channels) ||
      source.channels.length !== 88
    ) {
      throw new Error("O arquivo do GitHub não contém exatamente 88 canais.");
    }

    const ids = source.channels.map((channel) => channel && channel.id);
    if (
      ids.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(ids).size !== 88
    ) {
      throw new Error("Há IDs ausentes ou duplicados no arquivo original.");
    }

    const sourceHash = crypto.createHash("sha256").update(sourceText).digest("hex");
    const date = new Date().toISOString().replace(/[:.]/g, "-");
    const pathname = "backups/tv-brasil-engine-biblioteca-88-canais-" + date + ".json";

    const blob = await put(pathname, sourceText, {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json; charset=utf-8",
      token: blobToken,
    });

    const storedResponse = await fetch(blob.url, { cache: "no-store" });
    if (!storedResponse.ok) {
      throw new Error("Upload feito, mas a leitura de conferência falhou (HTTP " + storedResponse.status + ").");
    }

    const storedText = await storedResponse.text();
    const stored = JSON.parse(storedText);
    const sourceIds = sortedIds(source);
    const storedIds = sortedIds(stored);
    const idsMatch =
      sourceIds.length === storedIds.length &&
      sourceIds.every((id, index) => id === storedIds[index]);

    if (
      stored.total !== 88 ||
      stored.channels.length !== 88 ||
      !idsMatch
    ) {
      throw new Error("O arquivo foi enviado, mas a conferência dos 88 IDs não passou.");
    }

    const storedHash = crypto.createHash("sha256").update(storedText).digest("hex");
    return reply(res, 200, {
      ok: true,
      verified: true,
      total: stored.channels.length,
      idsMatch: true,
      source: "GitHub",
      sourceSha256: sourceHash,
      blobSha256: storedHash,
      blobUrl: blob.url,
      pathname: blob.pathname,
      message: "Backup enviado ao Vercel Blob e conferido: os 88 IDs correspondem ao arquivo do GitHub.",
    });
  } catch (error) {
    console.error("TV library backup failed:", error);
    return reply(res, 500, {
      ok: false,
      error: error.message || "Falha no backup.",
    });
  }
};
