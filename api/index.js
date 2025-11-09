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
  
  // Mock manga data that matches the expected format
  const mockMangaData = {
    data: [
      {
        id: '1',
        title: 'One Piece',
        coverImage: 'https://mangahook-api.vercel.app/placeholder-manga1.jpg',
        description: 'Follows the adventures of Monkey D. Luffy and his pirate crew in order to find the greatest treasure ever left by the legendary Pirate, Gold Roger.',
        chapters: 1095,
        status: 'Ongoing',
        rating: 4.8
      },
      {
        id: '2',
        title: 'Naruto',
        coverImage: 'https://mangahook-api.vercel.app/placeholder-manga2.jpg',
        description: 'Naruto Uzumaki wants to be the best ninja in the land. He\'s done well so far, but with the looming danger posed by the mysterious Akatsuki organization, Naruto knows he must train harder than ever before.',
        chapters: 700,
        status: 'Completed',
        rating: 4.7
      },
      // Add more mock data as needed
    ],
    pagination: {
      currentPage: 1,
      totalPages: 10,
      totalItems: 100
    }
  };

  // Add mock routes
  app.get('/api/manga', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    
    const paginatedData = {
      ...mockMangaData,
      data: mockMangaData.data.slice(startIndex, endIndex),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(mockMangaData.data.length / limit),
        totalItems: mockMangaData.data.length
      }
    };
    
    res.status(200).json(paginatedData);
  });
  
  app.get('/api/search', (req, res) => {
    const query = (req.query.q || '').toLowerCase();
    const filteredData = mockMangaData.data.filter(manga => 
      manga.title.toLowerCase().includes(query)
    );
    
    res.status(200).json({
      data: filteredData,
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalItems: filteredData.length
      }
    });
  });
  
  app.get('/api/manga/:id', (req, res) => {
    const manga = mockMangaData.data.find(m => m.id === req.params.id);
    if (manga) {
      res.status(200).json({ data: manga });
    } else {
      res.status(404).json({ message: 'Manga not found' });
    }
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
