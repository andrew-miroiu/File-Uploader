// app.js
const express = require("express");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
const { Pool } = require("pg");
const dotenv = require("dotenv");
const path = require("path");
dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

// View & static setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// Multer in-memory
const upload = multer({ storage: multer.memoryStorage() });

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Neon PostgreSQL client
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Route: Upload form
app.get("/", (req, res) => {
  res.render("upload");
});

// Route: Handle upload
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    // Define unique file name / path
    const fileName = `${Date.now()}_${file.originalname}`;
    // Upload to Supabase Storage (bucket "uploads")
    const { error: uploadError } = await supabase.storage
      .from("uploads")
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
    if (uploadError) {
      console.error("Supabase storage upload error:", uploadError);
      return res.status(500).json({ error: uploadError.message });
    }
    // Get public URL
    const { data: publicData } = supabase.storage
      .from("uploads")
      .getPublicUrl(fileName);
    if (!publicData || !publicData.publicUrl) {
      return res.status(500).json({ error: "Failed to get public URL" });
    }
    const fileUrl = publicData.publicUrl;
    // Save metadata in Neon PostgreSQL
    const result = await pool.query(
      "INSERT INTO files (name, type, size, url) VALUES ($1, $2, $3, $4) RETURNING *",
      [file.originalname, file.mimetype, file.size, fileUrl]
    );
    const saved = result.rows[0];
    res.redirect('/gallery');
    
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// Route: List files (feed)
app.get("/files", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM files ORDER BY uploaded_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("List files error:", err);
    res.status(500).json({ error: "Failed to fetch files" });
  }
});

app.get("/download/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM files WHERE id = $1", [id]);
    const file = result.rows[0];

    if (!file) return res.status(404).send("File not found");

    // Get the file from Supabase storage
    const { data, error } = await supabase.storage
      .from("uploads")
      .download(file.url.split("/").pop()); // extract file name from URL

    if (error || !data) {
      console.error("Supabase download error:", error);
      return res.status(500).send("Failed to fetch file from storage");
    }

    // Set headers to force download
    res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`);
    res.setHeader("Content-Type", file.type);

    // Stream the file back to the browser
    data.arrayBuffer().then((arrayBuffer) => {
      const buffer = Buffer.from(arrayBuffer);
      res.send(buffer);
    });
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).send("Error downloading file");
  }
});

app.get("/file/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM files WHERE id = $1", [id]);
    const file = result.rows[0];

    if (!file) return res.status(404).send("File not found");

    res.render("file", { file });
  } catch (err) {
    console.error("File details error:", err);
    res.status(500).send("Error fetching file details");
  }
});


// Route: Gallery page
app.get("/gallery", (req, res) => {
  res.render("gallery");
});

app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});