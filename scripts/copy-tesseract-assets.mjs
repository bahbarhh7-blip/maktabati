import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicOcr = path.join(projectRoot, "client", "public", "ocr");
const require = createRequire(import.meta.url);

function findPackageRoot(entry, packageName) {
  let directory = path.dirname(entry);
  while (directory !== path.dirname(directory)) {
    const manifest = path.join(directory, "package.json");
    if (fs.existsSync(manifest)) {
      try {
        if (JSON.parse(fs.readFileSync(manifest, "utf8")).name === packageName) return directory;
      } catch {
        // Continue to the package root.
      }
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Could not find installed package ${packageName}`);
}

const tesseractEntry = require.resolve("tesseract.js");
const tesseractRoot = findPackageRoot(tesseractEntry, "tesseract.js");
const packageRequire = createRequire(tesseractEntry);
const coreEntry = packageRequire.resolve("tesseract.js-core");
const coreRoot = findPackageRoot(coreEntry, "tesseract.js-core");
const workerSource = path.join(tesseractRoot, "dist", "worker.min.js");
if (!fs.existsSync(workerSource)) throw new Error(`Missing Tesseract worker: ${workerSource}`);

const coreDirectory = [path.join(coreRoot, "dist"), coreRoot].find(directory =>
  fs.existsSync(directory) && fs.readdirSync(directory).some(file => file.startsWith("tesseract-core") && file.endsWith(".wasm.js")),
);
if (!coreDirectory) throw new Error(`Could not find Tesseract WASM core files in ${coreRoot}`);

fs.mkdirSync(publicOcr, { recursive: true });
fs.copyFileSync(workerSource, path.join(publicOcr, "worker.min.js"));
const requiredCoreFiles = ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"];
const coreFiles = requiredCoreFiles.filter(file => fs.existsSync(path.join(coreDirectory, file)));
if (coreFiles.length !== requiredCoreFiles.length) throw new Error(`Missing supported LSTM core variants in ${coreDirectory}`);
for (const file of fs.readdirSync(publicOcr)) {
  if (file.startsWith("tesseract-core") && !requiredCoreFiles.includes(file)) fs.rmSync(path.join(publicOcr, file), { force: true });
}
for (const file of coreFiles) fs.copyFileSync(path.join(coreDirectory, file), path.join(publicOcr, file));
console.log(`Prepared local OCR worker and ${coreFiles.length} LSTM WASM variants in client/public/ocr`);
