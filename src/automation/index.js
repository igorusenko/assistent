const { N8N_CONFIG_WEBHOOK_URL } = require('../config');
const { mapToolsToDefinitions } = require('../../tools');

let automationConfig = null;

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

async function loadAutomationConfig(automationId) {
    automationConfig = await fetchAutomationConfig(automationId);
    if (automationConfig) {
        console.log(`✅ Automation config loaded successfully`);
    } else if (automationId) {
        console.log(`⚠️  Failed to load automation config, using default`);
    }
    return automationConfig;
}

function getAutomationConfig() {
    return automationConfig;
}

module.exports = {
    fetchAutomationConfig,
    buildSessionConfig,
    loadAutomationConfig,
    getAutomationConfig
};

