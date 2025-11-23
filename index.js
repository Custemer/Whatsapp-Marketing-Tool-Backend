const express = require("express");
const app = express();
const path = require("path");
const PORT = process.env.PORT || 8000;

// Set maximum listeners for EventEmitter
require("events").EventEmitter.defaultMaxListeners = 500;

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import routes
const pairRoute = require("./pair");
const messageRoute = require("./message");

// Use routes
app.use("/code", pairRoute);
app.use("/api", messageRoute);

// Root route to serve the main page
app.use("/", (req, res, next) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Start the server
app.listen(PORT, () => {
  console.log(`WhatsApp Marketing Tool running on http://localhost:${PORT}`);
});

module.exports = app;
