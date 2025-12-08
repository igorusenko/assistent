require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const OpenAI = require('openai');
const cors = require('cors');
const { mapToolsToDefinitions } = require('./tools/index');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/realtime' });
const PORT = process.env.PORT || 3000;

// Инициализация OpenAI клиента
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

if (!process.env.OPENAI_API_KEY) {
    console.error('⚠️  WARNING: OPENAI_API_KEY не установлен! Установите переменную окружения.');
}

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

// Глобальная конфигурация автоматизации (загружается один раз при старте)
let automationConfig = null;
const N8N_CONFIG_WEBHOOK_URL = 'https://dev-115-n8n.aitency.net/webhook/config';

/**
 * Получает конфигурацию автоматизации из n8n webhook
 * @param {string} automationId - ID автоматизации
 * @returns {Promise<Object|null>} Конфигурация или null при ошибке
 */
async function fetchAutomationConfig(automationId) {
    if (!automationId) {
        console.log('[Config] No AUTOMATION_ID provided, using default config');
        return null;
    }

    try {
        const url = `${N8N_CONFIG_WEBHOOK_URL}?automationId=${encodeURIComponent(automationId)}`;
        console.log(`[Config] 🔄 Fetching config from n8n: ${url}`);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`n8n webhook returned ${response.status}: ${response.statusText}`);
        }

        const config = await response.json();
        console.log(`[Config] ✅ Received config:`, JSON.stringify(config, null, 2));
        
        return config;
    } catch (error) {
        console.error(`[Config] ❌ Error fetching config:`, error.message);
        return null;
    }
}

/**
 * Построить конфигурацию сессии Realtime API из конфигурации n8n
 * @param {Object} config - Конфигурация из n8n
 * @returns {Object} Конфигурация сессии для session.update
 */
function buildSessionConfig(config) {
    const defaultConfig = {
        instructions: 'Ты голосовой ассистент и всегда отвечаешь по-русски, кратко и дружелюбно.',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        voice: 'echo',
        turn_detection: { type: 'server_vad' }
    };

    if (!config) {
        return defaultConfig;
    }

    const sessionConfig = {
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: { type: 'server_vad' },
        instructions: config.systemPrompt || defaultConfig.instructions,
        voice: config.voice || defaultConfig.voice
    };

    // Маппим инструменты из конфига в определения Realtime API
    if (config.tools && Array.isArray(config.tools) && config.tools.length > 0) {
        const toolDefinitions = mapToolsToDefinitions(config.tools);
        if (toolDefinitions.length > 0) {
            sessionConfig.tools = toolDefinitions;
            console.log(`[Config] Mapped ${toolDefinitions.length} tools to Realtime API`);
        }
    }

    return sessionConfig;
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        openai_configured: !!process.env.OPENAI_API_KEY,
        realtime: true
    });
});

// WebSocket для проксирования в OpenAI Realtime API
wss.on('connection', async (ws, req) => {
    console.log(`[${new Date().toISOString()}] 🔗 New WS client connected`);

    // Каждый браузерный клиент -> отдельное realtime-соединение к OpenAI
    let openaiWs;

    try {
        const url = `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview`;

        openaiWs = new WebSocket(url, {
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                'OpenAI-Beta': 'realtime=v1'
            }
        });

        openaiWs.on('open', () => {
            console.log(`[${new Date().toISOString()}] ▶️ Connected to OpenAI Realtime`);
            
            // Используем глобальную конфигурацию (может быть null, если еще загружается)
            const sessionConfig = buildSessionConfig(automationConfig);
            
            const sessionUpdate = {
                type: 'session.update',
                session: sessionConfig
            };
            
            console.log(`[Config] Using ${automationConfig ? 'automation' : 'default'} config for session`);
            openaiWs.send(JSON.stringify(sessionUpdate));
        });

        openaiWs.on('message', (data) => {
            if (ws.readyState !== WebSocket.OPEN) return;

            // OpenAI Realtime API отправляет данные как Buffer (бинарные) или строку (JSON)
            // Но аудио приходит через JSON-события response.audio.delta с base64, а не как прямые бинарные
            let asString = null;
            let isBinary = false;
            
            try {
                // Пытаемся определить формат данных
                if (Buffer.isBuffer(data)) {
                    // Это Buffer - пытаемся интерпретировать как строку (JSON)
                    asString = data.toString('utf8');
                    // Если это не валидный JSON, возможно это бинарные данные
                    try {
                        JSON.parse(asString);
                        // Это валидный JSON - обрабатываем как текст
                    } catch {
                        // Не JSON - возможно бинарные аудио-данные
                        isBinary = true;
                    }
                } else {
                    asString = data.toString();
                }
            } catch {
                // Если не удалось преобразовать в строку, это бинарные данные
                isBinary = true;
            }

            // Обрабатываем бинарные данные (PCM16 аудио от OpenAI)
            if (isBinary) {
                const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
                // Проверяем, что это валидные PCM16 данные (длина кратна 2)
                if (buffer.length > 0 && buffer.length % 2 === 0) {
                    console.log('[OpenAI EVENT] (binary PCM16 audio)', buffer.length, 'bytes');
                    ws.send(buffer);
                } else {
                    console.warn('[OpenAI EVENT] Invalid binary data length:', buffer.length);
                }
                return;
            }

            console.log('[OpenAI EVENT]', asString);

            // Пытаемся вытащить понятный текст-транскрипт и отправить его браузеру
            try {
                const evt = JSON.parse(asString);

                // Обработка аудио-чанков (response.audio.delta содержит base64-кодированный PCM16)
                if (evt.type === 'response.audio.delta' && evt.delta) {
                    try {
                        // Декодируем base64 в бинарные данные
                        const audioBuffer = Buffer.from(evt.delta, 'base64');
                        if (audioBuffer.length > 0 && audioBuffer.length % 2 === 0) {
                            console.log('[OpenAI EVENT] (audio delta decoded)', audioBuffer.length, 'bytes PCM16');
                            // Отправляем как бинарные данные
                            ws.send(audioBuffer);
                        } else {
                            console.warn('[OpenAI EVENT] Invalid audio delta length:', audioBuffer.length);
                        }
                    } catch (e) {
                        console.error('[OpenAI EVENT] Error decoding audio delta:', e);
                    }
                }
                
                // Логируем все аудио-связанные события для отладки
                if (evt.type && evt.type.includes('audio')) {
                    console.log('[OpenAI EVENT]', evt.type, evt.type === 'response.audio.delta' ? `(${evt.delta?.length || 0} base64 chars)` : '');
                }
                
                if (evt.type === 'response.created' || evt.type === 'response.done') {
                    console.log('[OpenAI EVENT]', evt.type);
                }

                // 1) Если Realtime прислал текстовый вывод
                if (evt.type === 'response.output_text.done' && evt.output && evt.output[0]?.content?.[0]?.text) {
                    ws.send(JSON.stringify({
                        type: 'assistant.text',
                        text: evt.output[0].content[0].text
                    }));
                }

                // 2) Если есть готовая расшифровка аудио ответа
                if (evt.type === 'response.audio_transcript.done' && evt.transcript) {
                    ws.send(JSON.stringify({
                        type: 'assistant.text',
                        text: evt.transcript
                    }));
                }
            } catch (e) {
                // не JSON — пропускаем
            }

            // Отправляем исходное событие в браузер (на случай дополнительной отладки)
            ws.send(asString);
        });

        openaiWs.on('close', (code, reason) => {
            console.log(`[${new Date().toISOString()}] ⛔ OpenAI WS closed`, code, reason.toString());
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        });

        openaiWs.on('error', (err) => {
            console.error(`[${new Date().toISOString()}] ❌ OpenAI WS error:`, err);
            if (ws.readyState === WebSocket.OPEN) {
                ws.close(1011, 'OpenAI connection error');
            }
        });
    } catch (err) {
        console.error('Failed to create OpenAI WS:', err);
        ws.close(1011, 'Failed to connect to OpenAI');
        return;
    }

    ws.on('message', (data, isBinary) => {
        if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) {
            return;
        }

        try {
            if (isBinary) {
                // Аудио-чанк от браузера -> оборачиваем в событие Realtime API
                const audioBase64 = Buffer.from(data).toString('base64');
                const event = {
                    type: 'input_audio_buffer.append',
                    audio: audioBase64
                };
                openaiWs.send(JSON.stringify(event));
        } else {
                // Текстовые управляющие сообщения от клиента пробрасываем как есть
                const text = data.toString();
                let msg;
                try {
                    msg = JSON.parse(text);
                } catch {
                    msg = null;
                }

                if (msg && msg.type) {
                    openaiWs.send(JSON.stringify(msg));
                }
            }
        } catch (err) {
            console.error('Error forwarding message to OpenAI:', err);
        }
    });

    ws.on('close', () => {
        console.log(`[${new Date().toISOString()}] 🔌 Client WS closed`);
        if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
            openaiWs.close();
        }
    });

    ws.on('error', (err) => {
        console.error(`[${new Date().toISOString()}] ❌ Client WS error:`, err);
        if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
            openaiWs.close();
        }
    });
});

// Запуск HTTP+WS сервера (сразу, без ожидания конфигурации)
server.listen(PORT, () => {
    console.log(`🚀 OpenAI Realtime Voice Server running on port ${PORT}`);
    console.log(`🔊 WebSocket endpoint: ws://localhost:${PORT}/realtime`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    if (!process.env.OPENAI_API_KEY) {
        console.log(`⚠️  WARNING: Set OPENAI_API_KEY environment variable!`);
    }
});

// Загрузка конфигурации параллельно (не блокирует старт сервера)
(async () => {
    const automationId = process.env.AUTOMATION_ID;
    
    if (automationId) {
        console.log(`[Config] Loading automation config for: ${automationId}`);
        automationConfig = await fetchAutomationConfig(automationId);
        if (automationConfig) {
            console.log(`✅ Automation config loaded successfully`);
        } else {
            console.log(`⚠️  Failed to load automation config, using default`);
        }
    } else {
        console.log('[Config] AUTOMATION_ID not set, using default configuration');
    }
})();
