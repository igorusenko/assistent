require('dotenv').config();

const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Инициализация OpenAI клиента
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

if (!process.env.OPENAI_API_KEY) {
    console.error('⚠️  WARNING: OPENAI_API_KEY не установлен! Установите переменную окружения.');
}

// Middleware - настройка CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Id', 'Accept'],
    exposedHeaders: ['Content-Type', 'X-Session-Id', 'Transfer-Encoding'],
    credentials: false,
    maxAge: 86400
}));

app.options('*', cors());
app.use(express.json());

// Настройка multer для обработки файлов в памяти
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB (лимит OpenAI Whisper)
});

// Хранилище для истории разговоров (по sessionId)
const conversations = new Map();

// Функция для получения истории разговора
function getConversationHistory(sessionId) {
    if (!conversations.has(sessionId)) {
        conversations.set(sessionId, []);
    }
    return conversations.get(sessionId);
}

// Функция для добавления сообщения в историю
function addToHistory(sessionId, role, content) {
    const history = getConversationHistory(sessionId);
    history.push({ role, content });
    // Ограничиваем историю последними 10 сообщениями
    if (history.length > 10) {
        history.shift();
    }
}

// Streaming функция обработки голосового запроса
async function processVoiceRequestStreaming(audioBuffer, sessionId, res) {
    try {
        console.log(`[${new Date().toISOString()}] Processing voice request (streaming) for session: ${sessionId}`);
        
        // Шаг 1: Транскрипция аудио через Whisper
        console.log(`[${new Date().toISOString()}] Step 1: Transcribing audio with Whisper...`);
        
        const audioFile = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });
        
        const transcription = await openai.audio.transcriptions.create({
            file: audioFile,
            model: 'whisper-1',
            language: 'ru',
            response_format: 'text'
        });
        
        const userText = transcription.toString().trim();
        console.log(`[${new Date().toISOString()}] Transcription: "${userText}"`);
        
        if (!userText) {
            throw new Error('Не удалось распознать речь');
        }

        // Добавляем сообщение пользователя в историю
        addToHistory(sessionId, 'user', userText);

        // Шаг 2: Получаем ответ от GPT с streaming
        console.log(`[${new Date().toISOString()}] Step 2: Getting streaming response from GPT...`);
        const history = getConversationHistory(sessionId);
        
        const messages = [
            {
                role: 'system',
                content: 'Ты голосовой ассистент. Отвечай кратко и по делу. Максимум 2-3 предложения. Отвечай на русском языке.'
            },
            ...history
        ];

        // Создаем streaming ответ от GPT
        const gptStartTime = Date.now();
        console.log(`[${new Date().toISOString()}] 🚀 Starting GPT streaming...`);
        
        const stream = await openai.chat.completions.create({
            model: 'gpt-4o-mini', // Более быстрая модель
            messages: messages,
            stream: true,
            temperature: 0.7,
            max_tokens: 150 // Уменьшено для более быстрых ответов
        });

        // Собираем текст по частям и сразу отправляем на TTS
        let accumulatedText = '';
        let fullText = '';
        let chunkCount = 0;
        let firstChunkTime = null;
        const MIN_CHARS_FOR_TTS = 8; // Уменьшено для более быстрого старта TTS
        const MAX_WAIT_CHARS = 30; // Уменьшено для принудительной отправки
        
        // Очередь для последовательной отправки TTS чанков
        let ttsQueue = Promise.resolve();
        let ttsChunkCount = 0;
        let firstTtsSentTime = null;
        let isFirstTtsChunk = true; // Флаг для первого чанка

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (!content) continue;

            chunkCount++;
            if (!firstChunkTime) {
                firstChunkTime = Date.now();
                const timeToFirstChunk = firstChunkTime - gptStartTime;
                console.log(`[${new Date().toISOString()}] ✅ First GPT chunk received in ${timeToFirstChunk}ms`);
            }

            accumulatedText += content;
            fullText += content;

            // Проверяем, можно ли отправить на TTS
            // Более агрессивная логика: отправляем при любом знаке препинания или при достижении лимита
            const hasPunctuation = /[.!?,;:]\s*$/.test(accumulatedText);
            const isLongEnough = accumulatedText.length >= MIN_CHARS_FOR_TTS;
            const isTooLong = accumulatedText.length >= MAX_WAIT_CHARS;
            
            // Для первого чанка: отправляем еще быстрее (меньше символов или сразу при знаке препинания)
            const firstChunkThreshold = isFirstTtsChunk ? 6 : MIN_CHARS_FOR_TTS;
            const shouldSendFirstChunk = isFirstTtsChunk && (accumulatedText.length >= firstChunkThreshold || hasPunctuation);

            // Отправляем быстрее: при знаке препинания + минимум символов, или при превышении лимита, или для первого чанка
            if (shouldSendFirstChunk || (hasPunctuation && isLongEnough) || isTooLong) {
                // Отправляем накопленный текст на TTS
                const textToTTS = accumulatedText.trim();
                if (textToTTS) {
                    accumulatedText = ''; // Сбрасываем накопленный текст
                    const isFirst = isFirstTtsChunk;
                    if (isFirstTtsChunk) {
                        isFirstTtsChunk = false; // Сбрасываем флаг после первого чанка
                    }
                    
                    // Добавляем в очередь для последовательной отправки
                    ttsQueue = ttsQueue.then(async () => {
                        try {
                            const ttsStartTime = Date.now();
                            ttsChunkCount++;
                            console.log(`[${new Date().toISOString()}] 🔊 [TTS #${ttsChunkCount}] Generating for: "${textToTTS.substring(0, 50)}..."`);
                            
                            const ttsResponse = await openai.audio.speech.create({
                                model: 'tts-1',
                                voice: 'alloy',
                                input: textToTTS,
                                response_format: 'mp3',
                                speed: 1.0
                            });

                            const audioChunk = Buffer.from(await ttsResponse.arrayBuffer());
                            const ttsDuration = Date.now() - ttsStartTime;
                            
                            if (!firstTtsSentTime) {
                                firstTtsSentTime = Date.now();
                                const totalTime = firstTtsSentTime - gptStartTime;
                                console.log(`[${new Date().toISOString()}] 🎵 FIRST AUDIO CHUNK SENT! Total time: ${totalTime}ms (${isFirst ? 'FIRST CHUNK OPTIMIZATION' : 'normal'})`);
                            }
                            
                            console.log(`[${new Date().toISOString()}] ✅ [TTS #${ttsChunkCount}] Generated ${audioChunk.length} bytes in ${ttsDuration}ms`);
                            
                            // Отправляем аудио чанк клиенту
                            if (!res.headersSent) {
                                res.setHeader('Transfer-Encoding', 'chunked');
                            }
                            res.write(audioChunk);
                            console.log(`[${new Date().toISOString()}] 📤 [TTS #${ttsChunkCount}] Chunk sent to client`);
                        } catch (error) {
                            console.error(`[${new Date().toISOString()}] ❌ Error generating TTS chunk:`, error);
                        }
                    });
                }
            }
        }

        // Обрабатываем остаток текста
        if (accumulatedText.trim()) {
            const textToTTS = accumulatedText.trim();
            
            ttsQueue = ttsQueue.then(async () => {
                console.log(`[${new Date().toISOString()}] Generating final TTS chunk...`);
                const ttsResponse = await openai.audio.speech.create({
                    model: 'tts-1',
                    voice: 'alloy',
                    input: textToTTS,
                    response_format: 'mp3',
                    speed: 1.0
                });

                const audioChunk = Buffer.from(await ttsResponse.arrayBuffer());
                if (!res.headersSent) {
                    res.setHeader('Transfer-Encoding', 'chunked');
                }
                res.write(audioChunk);
            });
        }
        
        // Ждем завершения всех TTS запросов
        await ttsQueue;

        const totalTime = Date.now() - gptStartTime;
        console.log(`[${new Date().toISOString()}] 📊 Streaming Summary:`);
        console.log(`  - GPT chunks received: ${chunkCount}`);
        console.log(`  - TTS chunks sent: ${ttsChunkCount}`);
        console.log(`  - Time to first chunk: ${firstChunkTime ? firstChunkTime - gptStartTime : 0}ms`);
        console.log(`  - Time to first audio: ${firstTtsSentTime ? firstTtsSentTime - gptStartTime : 0}ms`);
        console.log(`  - Total processing time: ${totalTime}ms`);
        console.log(`[${new Date().toISOString()}] Full assistant response: "${fullText.trim()}"`);

        if (!fullText.trim()) {
            throw new Error('Пустой ответ от ассистента');
        }

        // Добавляем полный ответ ассистента в историю
        addToHistory(sessionId, 'assistant', fullText.trim());

        // Завершаем ответ
        res.end();

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error processing voice:`, error);
        if (!res.headersSent) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.status(500).json({ 
                error: 'Failed to process voice request',
                message: error.message
            });
        } else {
            res.end();
        }
        throw error;
    }
}

// Обработка OPTIONS запросов
app.options('/api/voice', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id, Accept');
    res.header('Access-Control-Max-Age', '86400');
    res.sendStatus(200);
});

// Middleware для логирования
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// Информационный endpoint
app.get('/api/voice', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        message: 'OpenAI Voice Assistant API',
        method: 'POST required',
        description: 'This endpoint accepts POST requests with audio file',
        usage: {
            method: 'POST',
            contentType: 'multipart/form-data',
            fields: {
                file: 'Audio file (WebM, MP3, WAV, M4A, etc.)',
                sessionId: 'Session ID (optional, for conversation history)'
            }
        },
        endpoints: {
            voice: '/api/voice (POST)',
            health: '/health (GET)'
        }
    });
});

// Основной endpoint для обработки голосовых запросов
app.post('/api/voice', upload.single('file'), async (req, res) => {
    const requestStartTime = Date.now();
    
    if (!req.file) {
        console.error(`[${new Date().toISOString()}] ERROR: No audio file provided`);
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(400).json({ error: 'No audio file provided' });
    }

    if (!process.env.OPENAI_API_KEY) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const sessionId = req.body.sessionId || req.headers['x-session-id'] || 'default';
    
    console.log(`[${new Date().toISOString()}] Processing voice request:`);
    console.log(`  - Session ID: ${sessionId}`);
    console.log(`  - File size: ${req.file.size} bytes`);
    console.log(`  - File type: ${req.file.mimetype || 'unknown'}`);

    try {
        // Устанавливаем заголовки для streaming ответа
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id, Accept');
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('X-Session-Id', sessionId);
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Transfer-Encoding', 'chunked');

        // Обрабатываем запрос со streaming
        await processVoiceRequestStreaming(req.file.buffer, sessionId, res);

            const duration = Date.now() - requestStartTime;
        console.log(`[${new Date().toISOString()}] Request completed for session: ${sessionId} (took ${duration}ms)`);

    } catch (error) {
        const duration = Date.now() - requestStartTime;
        console.error(`[${new Date().toISOString()}] ERROR after ${duration}ms:`, {
            message: error.message,
            stack: error.stack
        });
        
        if (!res.headersSent) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.status(500).json({ 
                error: 'Failed to process voice request',
                message: error.message
            });
        }
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        openai_configured: !!process.env.OPENAI_API_KEY
    });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 OpenAI Voice Assistant Server running on port ${PORT}`);
    console.log(`🎤 Voice endpoint: http://localhost:${PORT}/api/voice`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    if (!process.env.OPENAI_API_KEY) {
        console.log(`⚠️  WARNING: Set OPENAI_API_KEY environment variable!`);
    }
});
