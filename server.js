require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const OpenAI = require('openai');
const cors = require('cors');

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
            // Отправляем явные инструкции: работать на русском, кратко и по делу
            const sessionUpdate = {
                type: 'session.update',
                session: {
                    instructions: 'Ты голосовой ассистент и всегда отвечаешь на русском языке, даже если вопрос задан на другом языке. Отвечай кратко, дружелюбно и по делу.',
                    // Аудио мы шлём в произвольном формате, Realtime сам декодирует, но формат сессии PCM16
                    input_audio_format: 'pcm16',
                    output_audio_format: 'pcm16',
                    turn_detection: { type: 'server_vad' }
                }
            };
            openaiWs.send(JSON.stringify(sessionUpdate));
        });

        openaiWs.on('message', (data) => {
            // Логируем события от OpenAI для отладки
            let asString = null;
            try {
                asString = data.toString();
                console.log('[OpenAI EVENT]', asString);
            } catch {
                console.log('[OpenAI EVENT] (binary)', data?.byteLength || 0);
            }

            // Пытаемся вытащить понятный текст-транскрипт и отправить его браузеру в упрощённом формате
            if (asString && ws.readyState === WebSocket.OPEN) {
                try {
                    const evt = JSON.parse(asString);

                    // 1) Прямое событие с полной расшифровкой
                    if (evt.type === 'response.audio_transcript.done' && evt.transcript) {
                        ws.send(JSON.stringify({
                            type: 'assistant.text',
                            text: evt.transcript
                        }));
                    }

                    // Раньше мы дублировали вывод через response.done, здесь это убрано,
                    // чтобы не было повторных одинаковых сообщений.
                } catch (e) {
                    // Если это не JSON или формат другой — просто игнорируем
                }
            }

            // Всё, что приходит от OpenAI, по-прежнему пересылаем в браузер (для отладки)
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
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
        console.log('[CLIENT WS MESSAGE] isBinary =', isBinary, 'size =', data?.length || data?.byteLength || 0);
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

// Запуск HTTP+WS сервера
server.listen(PORT, () => {
    console.log(`🚀 OpenAI Realtime Voice Server running on port ${PORT}`);
    console.log(`🔊 WebSocket endpoint: ws://localhost:${PORT}/realtime`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    if (!process.env.OPENAI_API_KEY) {
        console.log(`⚠️  WARNING: Set OPENAI_API_KEY environment variable!`);
    }
});
