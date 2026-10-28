import type { Express } from "express";
import { storageGetSignedUrl, storageReadBytes, storageUsesR2 } from "../storage";

// يخدم الصور المحفوظة: من R2 (رابط مؤقت) أو من قاعدة البيانات.
export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key || key.includes("..")) {
      res.status(400).send("Missing storage key");
      return;
    }
    try {
      if (storageUsesR2()) {
        const url = await storageGetSignedUrl(key);
        res.set("Cache-Control", "no-store");
        res.redirect(307, url);
        return;
      }
      const file = await storageReadBytes(key);
      if (!file) {
        res.status(404).send("Not found");
        return;
      }
      res.set("Content-Type", file.contentType);
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.send(file.data);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
