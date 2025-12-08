/**
 * Маппинг инструментов из конфигурации n8n в определения OpenAI Realtime API
 */

// Определения инструментов для OpenAI Realtime API
const toolDefinitions = {
    calendar: {
        type: 'function',
        name: 'calendar',
        description: 'Управление календарем: создание, просмотр и изменение событий',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['create', 'read', 'update', 'delete'],
                    description: 'Действие с календарем'
                },
                title: {
                    type: 'string',
                    description: 'Название события'
                },
                date: {
                    type: 'string',
                    description: 'Дата события в формате ISO 8601'
                }
            },
            required: ['action']
        }
    },
    crm: {
        type: 'function',
        name: 'crm',
        description: 'Работа с CRM системой: получение информации о клиентах, создание записей',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['get_client', 'create_client', 'update_client', 'search'],
                    description: 'Действие с CRM'
                },
                client_id: {
                    type: 'string',
                    description: 'ID клиента'
                },
                query: {
                    type: 'string',
                    description: 'Поисковый запрос'
                }
            },
            required: ['action']
        }
    },
    weather: {
        type: 'function',
        name: 'weather',
        description: 'Получение информации о погоде для указанного города',
        parameters: {
            type: 'object',
            properties: {
                city: {
                    type: 'string',
                    description: 'Название города'
                },
                date: {
                    type: 'string',
                    description: 'Дата для прогноза (опционально)'
                }
            },
            required: ['city']
        }
    }
};

/**
 * Маппит массив имен инструментов из конфигурации n8n в определения инструментов OpenAI Realtime
 * @param {string[]} configTools - Массив имен инструментов из конфига (например, ["calendar", "crm", "weather"])
 * @returns {Array} Массив объектов инструментов, совместимых с Realtime API
 */
function mapToolsToDefinitions(configTools) {
    if (!Array.isArray(configTools) || configTools.length === 0) {
        return [];
    }

    const tools = [];
    
    for (const toolName of configTools) {
        if (toolDefinitions[toolName]) {
            const toolDef = { ...toolDefinitions[toolName] };
            tools.push(toolDef);
        } else {
            console.warn(`[Tools] Unknown tool "${toolName}" in configuration, skipping`);
        }
    }

    return tools;
}

module.exports = {
    mapToolsToDefinitions,
    toolDefinitions
};


