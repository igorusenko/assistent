const express = require('express');
const cors = require('cors');
const { OPENAI_API_KEY } = require('../config');

function createExpressApp() {
    const app = express();

    // Middleware - настройка CORS (для статики/health)
    app.use(cors({
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Id', 'Accept'],
        exposedHeaders: ['Content-Type'],
        credentials: false,
        maxAge: 86400
    }));

    app.options('*', cors());
    app.use(express.json());

    // Health check endpoint
    app.get('/health', (req, res) => {
        res.json({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            openai_configured: !!OPENAI_API_KEY,
            realtime: true
        });
    });

    return app;
}

module.exports = {
    createExpressApp
};

