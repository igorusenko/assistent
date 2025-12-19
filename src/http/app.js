const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
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

    // Admin logs endpoint
    app.get('/admin/logs', (req, res) => {
        const lines = parseInt(req.query.lines) || 100; // По умолчанию последние 100 строк
        const logDir = path.join(__dirname, '../../logs');
        const outLogPath = path.join(logDir, 'out.log');
        const errLogPath = path.join(logDir, 'err.log');

        function readLastLines(filePath, numLines) {
            try {
                if (!fs.existsSync(filePath)) {
                    return [];
                }
                const content = fs.readFileSync(filePath, 'utf8');
                const allLines = content.split('\n').filter(line => line.trim());
                return allLines.slice(-numLines);
            } catch (error) {
                console.error(`Error reading ${filePath}:`, error);
                return [];
            }
        }

        const outLogs = readLastLines(outLogPath, lines);
        const errLogs = readLastLines(errLogPath, lines);

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            lines_requested: lines,
            logs: {
                out: outLogs,
                err: errLogs
            },
            files: {
                out: outLogPath,
                err: errLogPath
            }
        });
    });

    return app;
}

module.exports = {
    createExpressApp
};

