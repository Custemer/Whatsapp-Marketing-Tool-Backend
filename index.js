const express = require("express");
const app = express();
const path = require("path");
const cors = require("cors");
const PORT = process.env.PORT || 8000;

// Database connection
const connectDB = require("./config/database");
connectDB();

// Set maximum listeners for EventEmitter
require("events").EventEmitter.defaultMaxListeners = 500;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'views')));

// Import routes
const pairRouter = require("./routes/pair");
const messageRouter = require("./routes/message");
const contactsRouter = require("./routes/contacts");
const campaignsRouter = require("./routes/campaigns");
const numberDetectionRouter = require("./routes/number-detection");
const advancedMessagingRouter = require("./routes/advanced-messaging");

// Use routes
app.use("/code", pairRouter);
app.use("/api/message", messageRouter);
app.use("/api/contacts", contactsRouter);
app.use("/api/campaigns", campaignsRouter);
app.use("/api/detection", numberDetectionRouter);
app.use("/api/advanced", advancedMessagingRouter);

// Serve main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp Marketing Tool running on http://localhost:${PORT}`);
});

module.exports = app;
