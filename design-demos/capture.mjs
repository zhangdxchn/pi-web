import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const files = [
    { file: "index.html", output: "overview.png" },
    { file: "dir-1.html", output: "dir-1.png" },
    { file: "dir-2.html", output: "dir-2.png" },
    { file: "dir-3.html", output: "dir-3.png" },
    { file: "thumbs.html", output: "thumbs.png" },
  ];

  for (const item of files) {
    const filePath = "file://" + path.resolve(__dirname, item.file);
    await page.goto(filePath, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.resolve(__dirname, "screenshots", item.output), fullPage: false });
    console.log(`Saved screenshot: ${item.output}`);
  }

  await browser.close();
}

capture().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
