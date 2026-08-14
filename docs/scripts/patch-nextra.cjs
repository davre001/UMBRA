const fs = require("fs");
const path = require("path");

function patchFile(filePath) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, "utf8");
    if (content.includes("children: reactNode,")) {
      content = content.replace("children: reactNode,", "children: reactNode.optional(),");
      fs.writeFileSync(filePath, content, "utf8");
      console.log(`[patch-nextra] Successfully patched ${filePath}`);
    } else if (content.includes("children: reactNode.optional(),")) {
      console.log(`[patch-nextra] Already patched ${filePath}`);
    }
  }
}

try {
  const schemaPath = require.resolve("nextra-theme-docs/dist/schemas.js");
  patchFile(schemaPath);
} catch (e) {
  // Fallback candidate search
  const candidates = [
    path.join(process.cwd(), "node_modules/nextra-theme-docs/dist/schemas.js"),
    path.join(process.cwd(), "../node_modules/nextra-theme-docs/dist/schemas.js"),
    path.join(process.cwd(), "../node_modules/.pnpm/nextra-theme-docs@4.6.1/node_modules/nextra-theme-docs/dist/schemas.js"),
  ];

  for (const c of candidates) {
    patchFile(c);
  }
}
