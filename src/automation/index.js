const { N8N_CONFIG_WEBHOOK_URL } = require('../config');
const { mapToolsToDefinitions } = require('../../tools');

let automationConfig = null;
let automationConfigPromise = Promise.resolve(null);

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
        voice: 'alloy',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: {
            type: 'semantic_vad'
        }
    };

    if (!config) {
        return defaultConfig;
    }

    const sessionConfig = {
        instructions: config.systemPrompt || defaultConfig.instructions,
        voice: config.voice || defaultConfig.voice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: {
            type: 'semantic_vad'
        }
    };

    // Добавляем скорость воспроизведения аудио (от 0.25 до 4.0, по умолчанию 1.0)
    if (config.speed !== undefined) {
        const speed = parseFloat(config.speed);
        if (speed >= 0.25 && speed <= 4.0) {
            sessionConfig.speed = speed;
            console.log(`[Config] Audio speed set to: ${speed}`);
        } else {
            console.warn(`[Config] Invalid speed value ${speed}, must be between 0.25 and 4.0, using default 1.0`);
        }
    }

    // Маппим инструменты из конфига в определения Realtime API
    if (config.tools && Array.isArray(config.tools) && config.tools.length > 0) {
        const toolDefinitions = mapToolsToDefinitions(config.tools);
        if (toolDefinitions.length > 0) {
            sessionConfig.tools = toolDefinitions;
            sessionConfig.tool_choice = config.tool_choice || 'auto';
            console.log(`[Config] Mapped ${toolDefinitions.length} tools to Realtime API, tool_choice: ${sessionConfig.tool_choice}`);
        }
    }

    console.log(`[Config] Built session config from n8n:`, {
        hasInstructions: !!sessionConfig.instructions,
        voice: sessionConfig.voice,
        toolsCount: sessionConfig.tools ? sessionConfig.tools.length : 0
    });

    return sessionConfig;
}

async function loadAutomationConfig(automationId) {
    // Сохраняем промис, чтобы другие части кода могли ждать загрузку
    automationConfigPromise = (async () => {
        try {
            automationConfig = await fetchAutomationConfig(automationId);
            if (automationConfig) {
                console.log(`✅ Automation config loaded successfully`);
                console.log(`[Config] Config content:`, JSON.stringify(automationConfig, null, 2));
            } else if (automationId) {
                console.log(`⚠️  Failed to load automation config, using default`);
            }
            return automationConfig;
        } catch (error) {
            console.error(`[Config] Error loading automation config:`, error);
            return null;
        }
    })();
    return automationConfigPromise;
}

function waitForAutomationConfig() {
    console.log(`[Config] Waiting for automation config...`);
    return automationConfigPromise.then(config => {
        console.log(`[Config] Config wait completed, config:`, config ? 'loaded' : 'default');
        return config;
    }).catch(() => {
        console.log(`[Config] Config wait failed, using default`);
        return null;
    });
}

function getAutomationConfig() {
    return automationConfig;
}

module.exports = {
    fetchAutomationConfig,
    buildSessionConfig,
    loadAutomationConfig,
    getAutomationConfig,
    waitForAutomationConfig
};

