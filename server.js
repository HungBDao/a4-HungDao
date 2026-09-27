import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve /public relative to THIS file, not to whatever folder the host starts
// the process from. With a relative "public", a host that runs `node server.js`
// from another directory can't find the files, answers every request with an
// HTML 404 page, and the browser refuses it:
//   "Expected a JavaScript module script but the server responded with a MIME
//    type of text/html"
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

// Belt and braces: state the content types the game depends on explicitly.
const TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mp3": "audio/mpeg",
};

app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res, filePath) {
      const type = TYPES[path.extname(filePath).toLowerCase()];
      if (type) res.setHeader("Content-Type", type);
    },
  })
);

// A missing .js/.css/.mp3 should fail loudly as a plain 404, not come back as HTML.
app.use((req, res) => {
  res.status(404).type("text/plain").send(`Not found: ${req.path}`);
});

app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});
