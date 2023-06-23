import fetch from 'node-fetch'
import config from './config.json' assert { type: 'json' }
import { logger } from './logger.js'

const BASE_URL = `https://docs.getgrist.com/api/docs/${config.grist.docId}/`

const request = (url, params = {}) => (
  fetch(BASE_URL + url, {
    ...params,
    ...params.body ? {
      body: JSON.stringify(params.body)
    } : {},
    headers: {
      ...params.headers || {},
      Authorization: `Bearer ${config.grist.authToken}`,
      ...params.body ? { 
        'content-type': 'application/json',
      } : {},
    }
  })
  .then(async (response) => {
    if (response.ok) {
      return response.json()
    } else {
      const error = await response.json()
      logger.error(`Ошибка ${params.method || 'GET'} запроса ${BASE_URL + url}`)
      if (params.body) {
        logger.write(`Body: ${JSON.stringify(params.body)}`)
      }
      logger.write(`Response: ${error}\n`)
      return Promise.reject(response)
    }
  })
)

export const fetchTables = async () => {
  try {
    const { tables } = await request('tables')
    return tables
  } catch(e) {
    throw e
  }
}

export const addTables = async (tables) => {
  return request(
    'tables',
    {
      method: 'POST',
      body: { tables }
    }
  )
}

export const fetchColumns = async (tableId) => {
  try {
    const { columns } = await request(`tables/${tableId}/columns`)
    return columns.filter(column => !column.id.startsWith('c'))
  } catch(e) {
    throw e
  }
}

export const addColumns = async (tableId, columns) => {
  return request(
    `tables/${tableId}/columns`,
    {
      method: 'POST',
      body: { columns }
    }
  )
}

export const updateColumns = async (tableId, columns) => {
  return request(
    `tables/${tableId}/columns`,
    {
      method: 'PATCH',
      body: { columns }
    }
  )
}
