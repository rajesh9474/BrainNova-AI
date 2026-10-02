require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/db');

const authRoutes = require('./routes/auth');
const documentRoutes = require('./routes/documents');

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

// Routes
app.use('/auth', authRoutes);
app.use('/documents', documentRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'BrainNova.AI API is running with MongoDB.' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message || err);

  if (err.message === 'Only PDF files are allowed.') {
    return res.status(400).json({ error: err.message });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File size must be under 10MB.' });
  }

  if (err.status || err.statusCode) {
    return res.status(err.status || err.statusCode).json({ error: err.message });
  }

  res.status(500).json({ error: 'Internal server error.', details: err.message });
});

app.listen(PORT, () => {
  console.log(`BrainNova.AI server running on port ${PORT}`);
});
