const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const app = express();

// Import routes
const mangaRoutes = require('../server/routes/manga.routes');
const searchRoutes = require('../server/routes/search.routes');

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Use routes
app.use('/api/manga', mangaRoutes);
app.use('/api/search', searchRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Not Found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something broke!', error: err.message });
});

// Export the Express API
module.exports = app;
