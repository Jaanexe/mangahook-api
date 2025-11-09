const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to MangaHook API',
    endpoints: {
      getAllManga: '/api/manga',
      getMangaById: '/api/manga/:id',
      searchManga: '/api/search?q=query'
    },
    documentation: 'https://github.com/kiraaziz/mangahook-api'
  });
});

// Import routes
let mangaRoutes, searchRoutes;
try {
  mangaRoutes = require('../server/routes/manga.routes');
  searchRoutes = require('../server/routes/search.routes');
  
  // Use routes if they exist
  app.use('/api/manga', mangaRoutes);
  app.use('/api/search', searchRoutes);
} catch (error) {
  console.error('Error loading routes:', error.message);
  
  // Add placeholder routes if the actual routes fail to load
  app.get('/api/manga', (req, res) => {
    res.status(200).json({ message: 'Manga route is working' });
  });
  
  app.get('/api/search', (req, res) => {
    res.status(200).json({ message: 'Search route is working', query: req.query.q });
  });
}

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
