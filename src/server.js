const http = require('http');
const { PORT, OPENAI_API_KEY } = require('./config');
const { createExpressApp } = require('./http/app');
const { attachRealtimeProxy } = require('./ws/proxy');
const { loadAutomationConfig, getAutomationConfig, buildSessionConfig } = require('./automation');

const app = createExpressApp();
const server = http.createServer(app);

attachRealtimeProxy({
    server,
    apiKey: OPENAI_API_KEY,
    getAutomationConfig,
    buildSessionConfig
});

// Запуск HTTP+WS сервера (сразу, без ожидания конфигурации)
server.listen(PORT, () => {
    console.log(`🚀 OpenAI Realtime Voice Server running on port ${PORT}`);
    console.log(`🔊 WebSocket endpoint: ws://localhost:${PORT}/realtime`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    if (!OPENAI_API_KEY) {
        console.log(`⚠️  WARNING: Set OPENAI_API_KEY environment variable!`);
    }
});

// Загрузка конфигурации параллельно (не блокирует старт сервера)
(async () => {
    const automationId = process.env.AUTOMATION_ID;
    
    if (automationId) {
        console.log(`[Config] Loading automation config for: ${automationId}`);
        await loadAutomationConfig(automationId);
    } else {
        console.log('[Config] AUTOMATION_ID not set, using default configuration');
    }
})();

