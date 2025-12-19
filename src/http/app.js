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
        const format = req.query.format || 'pretty'; // 'raw', 'pretty' или 'dialog'
        const filterType = req.query.type; // Фильтр по типу события
        const filterSessionId = req.query.sessionId; // Фильтр по sessionId
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

        function parseLogLine(line) {
            // Пытаемся найти JSON в строке
            const jsonMatch = line.match(/\{.*\}/);
            if (jsonMatch) {
                try {
                    const json = JSON.parse(jsonMatch[0]);
                    return {
                        raw: line,
                        parsed: json,
                        isJson: true
                    };
                } catch (e) {
                    // Не валидный JSON
                }
            }
            return {
                raw: line,
                parsed: null,
                isJson: false
            };
        }

        function extractUserQuestion(json) {
            // Вопрос пользователя может быть в разных событиях
            if (json.type === 'conversation.item.input_audio_transcription.completed') {
                return json.transcript || json.item?.transcript || null;
            }
            if (json.type === 'conversation.item.input_audio_transcription.delta') {
                return json.delta || null;
            }
            if (json.type === 'input_audio_buffer.committed') {
                // Может содержать транскрипцию
                return json.transcript || null;
            }
            return null;
        }

        function extractAssistantAnswer(json) {
            // Ответ ИИ может быть в разных событиях
            if (json.type === 'response.output_text.done') {
                return json.output?.[0]?.content?.[0]?.text || null;
            }
            if (json.type === 'response.output_text.delta') {
                return json.delta || null;
            }
            if (json.type === 'response.output_audio_transcript.done' || json.type === 'response.audio_transcript.done') {
                return json.transcript || null;
            }
            if (json.type === 'response.done') {
                // Ищем текст в output
                const textOutput = json.response?.output?.find(out => out.type === 'output_text');
                if (textOutput?.content?.[0]?.text) {
                    return textOutput.content[0].text;
                }
                // Или транскрипцию аудио
                const audioOutput = json.response?.output?.find(out => out.type === 'output_audio');
                if (audioOutput?.transcript) {
                    return audioOutput.transcript;
                }
            }
            return null;
        }
        
        function getAllSessionIds(logs) {
            const sessionIds = new Set();
            logs.forEach(entry => {
                if (entry.isJson && entry.parsed.sessionId) {
                    sessionIds.add(entry.parsed.sessionId);
                }
            });
            return Array.from(sessionIds).sort();
        }

        function formatLogEntry(entry) {
            if (!entry.isJson || format === 'raw') {
                return entry.raw;
            }

            const json = entry.parsed;
            
            // Специальный режим для диалога - только response.audio_transcript.done
            if (format === 'dialog') {
                // Показываем только response.audio_transcript.done или response.output_audio_transcript.done
                if (json.type === 'response.audio_transcript.done' || json.type === 'response.output_audio_transcript.done') {
                    const assistantAnswer = json.transcript || null;
                    const dialogEntry = {
                        timestamp: json.timestamp || new Date().toISOString(),
                        type: json.type,
                        user: null, // В режиме dialog показываем только ответы ИИ
                        assistant: assistantAnswer,
                        response_id: json.response_id,
                        event_id: json.event_id,
                        sessionId: json.sessionId || null // Всегда включаем sessionId (может быть null)
                    };
                    return dialogEntry;
                }
                // Пропускаем все остальные события в режиме dialog
                return null;
            }

            // Обычное форматирование
            const formatted = {
                type: json.type || 'unknown',
                timestamp: json.timestamp || new Date().toISOString(),
                event_id: json.event_id,
                response_id: json.response_id,
                item_id: json.item_id
            };

            // Извлекаем вопросы и ответы для обычного режима тоже
            const userQuestion = extractUserQuestion(json);
            const assistantAnswer = extractAssistantAnswer(json);
            
            if (userQuestion) {
                formatted.user_question = userQuestion;
            }
            if (assistantAnswer) {
                formatted.assistant_answer = assistantAnswer;
            }
            
            // Добавляем sessionId если есть
            if (json.sessionId) {
                formatted.sessionId = json.sessionId;
            }

            // Обработка разных типов событий
            if (json.type === 'response.audio.delta' || json.type === 'response.output_audio.delta') {
                formatted.audio_delta = {
                    output_index: json.output_index,
                    content_index: json.content_index,
                    delta_size: json.delta ? Buffer.from(json.delta, 'base64').length : 0
                };
            } else if (json.type === 'response.created') {
                formatted.response = {
                    id: json.response?.id,
                    status: json.response?.status
                };
            } else if (json.type === 'response.done') {
                formatted.response = {
                    id: json.response?.id,
                    status: json.response?.status
                };
            } else if (json.type === 'error') {
                formatted.error = {
                    code: json.code,
                    message: json.message,
                    param: json.param
                };
            } else if (json.type === 'input_audio_buffer.speech_started') {
                formatted.speech_started = true;
            } else if (json.type === 'input_audio_buffer.speech_stopped') {
                formatted.speech_stopped = true;
            }

            return formatted;
        }

        function processLogs(rawLogs) {
            // Сначала фильтруем сырые строки, содержащие response.audio.delta
            const filteredRaw = rawLogs.filter(line => {
                // Пропускаем строки, которые содержат response.audio.delta
                if (line.includes('"type":"response.audio.delta"') || 
                    line.includes('"type":"response.output_audio.delta"')) {
                    return false;
                }
                return true;
            });
            
            const parsed = filteredRaw.map(parseLogLine);
            
            // Дополнительная фильтрация на случай, если что-то пропустили
            const withoutAudioDeltas = parsed.filter(entry => {
                if (!entry.isJson) return true;
                const type = entry.parsed.type;
                return type !== 'response.audio.delta' && type !== 'response.output_audio.delta';
            });
            
            // В режиме dialog показываем только response.audio_transcript.done
            let filtered = withoutAudioDeltas;
            if (format === 'dialog') {
                filtered = withoutAudioDeltas.filter(entry => {
                    if (!entry.isJson) return false;
                    const type = entry.parsed.type;
                    return type === 'response.audio_transcript.done' || type === 'response.output_audio_transcript.done';
                });
            }
            
            // Фильтрация по типу события (если не режим dialog)
            if (filterType && filterType.trim() && format !== 'dialog') {
                filtered = filtered.filter(entry => 
                    entry.isJson && entry.parsed.type === filterType.trim()
                );
            }
            
            // Фильтрация по sessionId
            if (filterSessionId && filterSessionId.trim()) {
                filtered = filtered.filter(entry => {
                    if (!entry.isJson) return false;
                    return entry.parsed.sessionId === filterSessionId.trim();
                });
            }

            const formatted = filtered.map(formatLogEntry);
            
            // В режиме dialog фильтруем null значения
            if (format === 'dialog') {
                return formatted.filter(entry => entry !== null);
            }
            
            return formatted;
        }

        const rawOutLogs = readLastLines(outLogPath, lines);
        const rawErrLogs = readLastLines(errLogPath, lines);

        // Парсим для получения списка sessionId
        const parsedOutLogs = rawOutLogs.map(parseLogLine);
        const allSessionIds = getAllSessionIds(parsedOutLogs);

        const processedOutLogs = processLogs(rawOutLogs);
        const processedErrLogs = processLogs(rawErrLogs);

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            lines_requested: lines,
            format: format,
            filter_type: filterType || null,
            filter_session_id: filterSessionId || null,
            available_session_ids: allSessionIds,
            logs: {
                out: processedOutLogs,
                err: processedErrLogs
            },
            stats: {
                out_total: rawOutLogs.length,
                out_parsed: processedOutLogs.filter(l => typeof l === 'object').length,
                err_total: rawErrLogs.length,
                err_parsed: processedErrLogs.filter(l => typeof l === 'object').length
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

