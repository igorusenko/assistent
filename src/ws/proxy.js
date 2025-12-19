const WebSocket = require('ws');

function attachRealtimeProxy({ server, apiKey, getAutomationConfig, buildSessionConfig, waitForAutomationConfig }) {
    const wss = new WebSocket.Server({ server, path: '/realtime' });

    // WebSocket для проксирования в OpenAI Realtime API
    wss.on('connection', async (ws) => {
        console.log(`[${new Date().toISOString()}] 🔗 New WS client connected`);

        // Каждый браузерный клиент -> отдельное realtime-соединение к OpenAI
        let openaiWs;

        try {
            // Ждем, пока загрузится конфигурация (или завершится с ошибкой/дефолтом)
            await waitForAutomationConfig();

            const url = `wss://api.openai.com/v1/realtime?model=gpt-realtime`;

            openaiWs = new WebSocket(url, {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'OpenAI-Beta': 'realtime=v1'
                }
            });

            // Флаг, что session.created уже получен
            let sessionCreated = false;
            // Сохраняем sessionId из OpenAI
            let sessionId = null;
            
            // Функция для отправки конфигурации сессии
            const sendSessionConfig = () => {
                if (!sessionCreated) {
                    console.log(`[Config] Waiting for session.created before sending config`);
                    return;
                }
                
                const automationConfig = getAutomationConfig();
                const sessionConfig = buildSessionConfig(automationConfig);
                
                const sessionUpdate = {
                    type: 'session.update',
                    session: sessionConfig
                };
                
                console.log(`[Config] Using ${automationConfig ? 'automation' : 'default'} config for session`);
                console.log(`[Config] Session config:`, JSON.stringify(sessionConfig, null, 2));
                
                if (openaiWs.readyState === WebSocket.OPEN) {
                    openaiWs.send(JSON.stringify(sessionUpdate));
                }
            };

            openaiWs.on('open', () => {
                console.log(`[${new Date().toISOString()}] ▶️ Connected to OpenAI Realtime`);
                // Не отправляем конфигурацию сразу - ждем session.created
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
                        ws.send(buffer);
                    }
                    return;
                }

                // Пытаемся вытащить понятный текст-транскрипт и отправить его браузеру
                let audioDeltaProcessed = false;
                try {
                    const evt = JSON.parse(asString);

                    // Обрабатываем session.created - после этого можно отправлять session.update
                    if (evt.type === 'session.created') {
                        sessionCreated = true;
                        sessionId = evt.session?.id || null;
                        console.log(`[Config] Session created, sending config update`);
                        // Отправляем конфигурацию после получения session.created
                        const automationConfig = getAutomationConfig();
                        const sessionConfig = buildSessionConfig(automationConfig);
                        
                        const sessionUpdate = {
                            type: 'session.update',
                            session: sessionConfig
                        };
                        
                        console.log(`[Config] Using ${automationConfig ? 'automation' : 'default'} config for session`);
                        console.log(`[Config] Session config:`, JSON.stringify(sessionConfig, null, 2));
                        
                        if (openaiWs.readyState === WebSocket.OPEN) {
                            openaiWs.send(JSON.stringify(sessionUpdate));
                        }
                    }

                    // Обработка аудио-чанков (поддерживаем оба варианта: response.output_audio.delta и response.audio.delta)
                    if ((evt.type === 'response.output_audio.delta' || evt.type === 'response.audio.delta') && evt.delta) {
                        try {
                            // Декодируем base64 в бинарные данные
                            const audioBuffer = Buffer.from(evt.delta, 'base64');
                            if (audioBuffer.length > 0 && audioBuffer.length % 2 === 0) {
                                // Отправляем как бинарные данные
                                ws.send(audioBuffer);
                                audioDeltaProcessed = true;
                            }
                        } catch (e) {
                            // Ошибка декодирования - пропускаем
                        }
                    }

                    // 1) Если Realtime прислал текстовый вывод
                    if (evt.type === 'response.output_text.done' && evt.output && evt.output[0]?.content?.[0]?.text) {
                        ws.send(JSON.stringify({
                            type: 'assistant.text',
                            text: evt.output[0].content[0].text
                        }));
                    }

                    // 2) Если есть готовая расшифровка аудио ответа
                    if ((evt.type === 'response.output_audio_transcript.done' || evt.type === 'response.audio_transcript.done') && evt.transcript) {
                        ws.send(JSON.stringify({
                            type: 'assistant.text',
                            text: evt.transcript
                        }));
                        
                        // Логируем только response.audio_transcript.done с sessionId
                        if (evt.type === 'response.audio_transcript.done') {
                            const logEntry = {
                                type: 'response.audio_transcript.done',
                                timestamp: new Date().toISOString(),
                                sessionId: sessionId || null, // Всегда записываем sessionId (может быть null если еще не получен)
                                response_id: evt.response_id,
                                item_id: evt.item_id,
                                transcript: evt.transcript
                            };
                            console.log(JSON.stringify(logEntry));
                        }
                    }
                } catch (e) {
                    // не JSON — пропускаем
                }

                // Отправляем исходное событие в браузер (на случай дополнительной отладки)
                // Пропускаем response.output_audio.delta, так как уже отправили бинарные данные
                if (!audioDeltaProcessed) {
                    ws.send(asString);
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
}

module.exports = {
    attachRealtimeProxy
};

