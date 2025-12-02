require('dotenv').config();
const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// OpenAI клиент
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// CORS для всех запросов
app.use(cors({
    origin: '*',
    methods: ['GET','POST','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','X-Session-Id','Accept'],
    exposedHeaders: ['X-Session-Id','Transfer-Encoding']
}));
app.options('*', (req, res) => res.sendStatus(200));

app.use(express.json());

// Multer для файлов в памяти
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// История разговоров
const conversations = new Map();
const getConversationHistory = (sessionId) => {
    if (!conversations.has(sessionId)) conversations.set(sessionId, []);
    return conversations.get(sessionId);
};
const addToHistory = (sessionId, role, content) => {
    const history = getConversationHistory(sessionId);
    history.push({ role, content });
    if (history.length > 10) history.shift();
};

// Streaming TTS
async function streamTTS(text, res) {
    const ttsResp = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'alloy',
        input: text,
        response_format: 'mp3'
    });
    const audioChunk = Buffer.from(await ttsResp.arrayBuffer());
    res.write(audioChunk);
}

async function processVoice(req, res) {
    const sessionId = req.body.sessionId || req.headers['x-session-id'] || 'default';
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

    // Заголовки streaming
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Session-Id', sessionId);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
        // 1️⃣ Транскрибируем голос
        const audioFile = new File([req.file.buffer], 'voice.webm', { type: 'audio/webm' });
        const transcription = await openai.audio.transcriptions.create({
            file: audioFile,
            model: 'whisper-1',
            language: 'ru',
            response_format: 'text'
        });
        const userText = transcription.toString().trim();
        if (!userText) throw new Error('Speech not recognized');
        addToHistory(sessionId, 'user', userText);

        // 2️⃣ GPT ответ
        const messages = [
            { role: 'system', content: 'Ты голосовой ассистент. Кратко, по делу, на русском.' },
            ...getConversationHistory(sessionId)
        ];

        const stream = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            stream: true,
            max_tokens: 150
        });

        let accumulatedText = '';
        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (!content) continue;
            accumulatedText += content;

            // Отправляем на TTS каждые 15 символов или при знаке препинания
            if (accumulatedText.length >= 15 || /[.!?]/.test(accumulatedText.slice(-1))) {
                const textToTTS = accumulatedText.trim();
                accumulatedText = '';
                await streamTTS(textToTTS, res);
            }
        }

        // Остаток текста
        if (accumulatedText.trim()) await streamTTS(accumulatedText.trim(), res);

        addToHistory(sessionId, 'assistant', accumulatedText.trim());
        res.end();
    } catch (err) {
        console.error(err);
        res.end();
    }
}

// POST /api/voice
app.post('/api/voice', upload.single('file'), processVoice);

// Health
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
