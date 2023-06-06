import fetch from 'node-fetch'
import config from './config.json' assert { type: 'json' }

// const loadJSON = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));
// const countries = loadJSON('./data/countries.json');

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
  .then(response => {
    return response.ok ? response.json() : Promise.reject(response)
  })
)

export const fetchTables = async () => {
  return request('tables')
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
  return request(`tables/${tableId}/columns`)
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
