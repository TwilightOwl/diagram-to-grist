import pluralize from 'pluralize'
import { parseDiagramFromFile } from './drawioParser.js'
import * as GristApi from './gristApi.js'
import { logger } from './logger.js'
import { split } from './utils.js'

export const parseDiagramAndSaveToGrist = async ({
  inputFile = 'graph.xml', 
  logFile = 'log.txt',
  updateGrist = false, 
}) => {

  logger.initialize(logFile)

  logger.write('======== Обработка классов и атрибутов ========\n')

  const { classes: diagramClasses, relations: diagramRelations } = parseDiagramFromFile(inputFile)
  let gristTables = await GristApi.fetchTables()
  
  let tables = {}

  for await (const classData of diagramClasses) {
    classData.attributes = classData.attributes || []

    const columns = Object.values(classData.attributes.reduce((acc, attr) => {
      if (attr.EN) {
        if (acc[attr.EN]) {
          if (!acc[attr.EN].error) {
            acc[attr.EN] = {
              id: attr.EN,
              error: 'duplicate',
              labels: [acc[attr.EN].fields.label]
            }
          }
          acc[attr.EN].labels.push(attr.label)
        } else {
          acc[attr.EN] = {
            id: attr.EN === 'ID' ? pluralize(classData.EN, 1) + '_ID' : attr.EN,
            fields: {
              label: attr.label,
              type: attr.DATA_TYPE === 'NUMBER' ? 'Int' : 'Any'
            }
          }
        }
      } else {
        logger.error(`В классе "${classData.label}" атрибут "${attr.label}" не имеет идентификатора (поле EN пустое), поле не будет добавлено в таблицу\n`)
      }
      return acc
    }, {})).reduce((acc, column) => {
      if (column.error) {
        logger.error(`В классе "${classData.label}" найдено более одного атрибута с идентификатором (поле EN) ${column.id}, ни одно из этих полей не будет добавлено в таблицу:`)
        column.labels.forEach(label => logger.write(`- "${label}"`))
        logger.write('')
      } else {
        acc.push(column)
      }
      return acc
    }, [])

    if (tables[classData.EN]) {
      if (!tables[classData.EN].error) {
        tables[classData.EN] = {
          id: classData.EN,
          error: 'duplicate',
          labels: [tables[classData.EN].label]
        }
      }
      tables[classData.EN].labels.push(classData.label)
    } else {
      if (columns.length) {
        tables[classData.EN] = {
          id: classData.EN,
          // TODO: API Grist не дает возможности задать названия для колонок, поизучать этот вопрос еще
          // label: classData.label
          // fields: {
          //   label: classData.label,
          // },
          columns
        }
      } else {
        logger.error(`Таблица ${classData.EN} "${classData.label}" не будет добавлена, т.к. в соответсвующем классе нет атрибутов\n`)
      }
    }
        
  }

  const [existedTables, newTables] = split(
    Object.values(tables).reduce((acc, table) => {
      if (table.error) {
        logger.error(`Найдено более одного класса с идентификатором (поле EN) ${table.id}, ни одна из этих таблиц не будет добавлена:`)
        table.labels.forEach(label => logger.write(`- "${label}"`))
        logger.write('')
      } else {
        acc.push(table)
      }
      return acc
    }, []),
    (table) => gristTables.find(({ id }) => id === table.id)
  )

  if (newTables.length) {
    newTables.forEach(table => {
      logger.write(`Добавляется новая таблица ${table.id} "${table.label}" с полями:`)
      table.columns.forEach(column => {
        logger.write(`+  ${column.fields.type}  ${column.id}  "${column.fields.label}"`)
      })
      logger.write('')
    })
    updateGrist && await GristApi.addTables(newTables)
  }

  if (existedTables.length) {
    for await (const table of existedTables) {
      const existedColumns = await GristApi.fetchColumns(table.id)
      const commonColumns = new Set()
      const columnsToAdd = table.columns.filter(column => {
        if (column.id === 'ID') return false
        const foundColumn = existedColumns.find(existed => existed.id === column.id)
        if (foundColumn) commonColumns.add(foundColumn.id)
        return !foundColumn
      })
      const columnsToDelete = existedColumns.filter(existed => !commonColumns.has(existed.id) && existed.id !== table.id + '_ID' && existed.id !== table.id.slice(0, table.id.length - 1) + '_ID')

      if (columnsToAdd.length) {
        logger.write(`В существующую таблицу ${table.id} добавляются следующие поля:`)
        columnsToAdd.forEach(column => {
          logger.write(`+  ${column.fields.type}  ${column.id}  "${column.fields.label}"`)
        })
        logger.write('')
        updateGrist && await GristApi.addColumns(table.id, columnsToAdd)
      }
    }
  }

  // ================== Обработка связей

  logger.write('======== Обработка связей ========\n')

  gristTables = await GristApi.fetchTables()
  for await (const table of gristTables) {
    const columns = await GristApi.fetchColumns(table.id)
    table.columns = columns
  }

  for await (const relation of diagramRelations) {
    // не задаю здесь дефолтных значений, чтобы потом разобраться с каждым кейсом отдельно
    let fromTable, fromColumn, toTable, toColumn

    // Проверка корректности диаграммы:
    if (!relation.source.id || !relation.target.id) {
      logger.error(`Обноружена некорректная связь в диаграмме, отсутствуют данные о связанных сущностях (стрелка не соеденена корректно с таблицами):`)
      logger.write(`Source: ${relation.source?.object?.label}\nTarget: ${relation.target?.object?.label}\n`)
      continue
    }
    if (!relation.source.object || !relation.target.object) {
      logger.error(`Не найдена сущность, на которую ссылается связь:`)
      logger.write(`Source: ${relation.source.id} ${relation.source?.object?.label}\nTarget: ${relation.target.id} ${relation.target?.object?.label}\n`)
      continue
    }

    // 1. Напраление: Для определения направления связи нужно анализировать и саму связь и оба объекта которые она соединяет
    let from, to
    // Если есть стрелки, то доверяем им
    if (
      relation.source.type === 'ERoneToMany' && relation.target.type === undefined ||
      relation.source.type === undefined && relation.target.type === 'ERoneToMany'
    ) {
      from = relation.source.type === 'ERoneToMany' ? relation.source.object : relation.target.object
      to = relation.source.type === 'ERoneToMany' ? relation.target.object : relation.source.object
    // Если стрелок нет или по ним нельзя определить направление или они поставлены некорректно, то:
    } else {
      // Если в метаданных указано на какую таблицу и атрибут ссылаемся, то это однозначно TO
      if (relation.refToClass && relation.refToAttribute) {
        const sourceTable = relation.source.object.attributes ? relation.source.object.parentObject : relation.source.object
        const targetTable = relation.target.object.attributes ? relation.target.object.parentObject : relation.target.object
        if (
          sourceTable.EN !== targetTable.EN && 
          (sourceTable.EN === relation.refToClass || targetTable.EN === relation.refToClass)
        ) {
          if (sourceTable.EN === relation.refToClass) {
            from = relation.target.object
            to = relation.source.object
          } else {
            from = relation.source.object
            to = relation.target.object
          }
        } else {
          logger.error(`Невозможно однозначно определить направление связи: ${relation.source.object.EN}  --  ${relation.target.object.EN}\n`)
          continue
        }
      // Если в метаданных нет информации на что ссылаемся, но есть откуда ссылаемся, то:
      } else {
        // Если связь установлена с двух концов с атрибутами а не таблицами, и один из атрибутов совпадает с метаданными а другой атрибут отличается, то:
        if (
          !relation.source.object.attributes && 
          !relation.target.object.attributes && 
          relation.source.object.EN !== relation.target.object.EN &&
          (relation.source.object.EN === relation.refAttribute || relation.target.object.EN === relation.refAttribute)
        ) {
          if (relation.source.object.EN === relation.refAttribute) {
            from = relation.source.object
            to = relation.target.object
          } else {
            from = relation.target.object
            to = relation.source.object
          }
        } else {
          logger.error(`Невозможно однозначно определить направление связи: ${relation.source.object.EN}  --  ${relation.target.object.EN}\n`)
          continue
        }

      }
    }

    // 2. Определение полей для связи (логика одна и для from и для to)
    // Если связь уже идет от поля а не таблицы, то эта информация в приоритете, иначе смотрим в метаданные

    const getIdentifiers = (object) => {
      // если связь идет от таблицы
      if (object.attributes) {
        // пробуем найти информацию о поле от которого идет связь
        if (relation.refAttribute) {
          return { table: object.EN, column: relation.refAttribute }
        } else {
          logger.error(`Не задано поле для связи, вместо этого связь установлена с таблицей ${object.EN} "${object.label}"\n`)
          return
        }
      // если связь идет от поля
      } else {
        return { 
          table: object.parentObject.EN, 
          column: object.EN === 'ID' ? pluralize(object.parentObject.EN, 1) + '_ID' : object.EN,
        }
      }
    }

    const fromIdentifiers = getIdentifiers(from)
    const toIdentifiers = getIdentifiers(to)
    if (!fromIdentifiers || !toIdentifiers) {
      continue
    }

    // 3. Проверка существования таблиц и полей в гристе и если существует, то какого типа поле

    const findExisted = (tableEN, columnEN) => {
      let existedColumnType
      let areTableAndColumnExist = gristTables.some(table => {
        return table.id === tableEN && table.columns.some(column => {
          const found = column.id === columnEN
          if (found) {
            existedColumnType = column.fields.type
          }
          return found
        })
      })
      return existedColumnType
    }

    if (!findExisted(toIdentifiers.table, toIdentifiers.column)) {
      logger.error(`В Grist не найдено поле ${toIdentifiers.column} в таблице ${toIdentifiers.table}\n`)
      continue
    }
    const linkType = `Ref:${toIdentifiers.table}`

    const existedColumnType = findExisted(fromIdentifiers.table, fromIdentifiers.column)
    if (existedColumnType) {
      if (existedColumnType === linkType) {
        logger.write(`В Grist в таблице ${fromIdentifiers.table} в поле ${fromIdentifiers.column} уже установлена ссылка на таблицу ${toIdentifiers.table}, в Grist ничего не меняется\n`)
        continue
      }
    } else {
      logger.error(`В Grist не найдено поле ${fromIdentifiers.column} в таблице ${fromIdentifiers.table}\n`)
      continue
    }

    // 4. Все проверки пройдены, добавляем связь в Grist

    logger.write(`Добавляется связь: ${fromIdentifiers.table} поле ${fromIdentifiers.column}  -->  ${toIdentifiers.table}\n`)
    await GristApi.updateColumns(fromIdentifiers.table, [{
      id: fromIdentifiers.column,
      fields: {
        type: linkType
      }
    }])
  }
  
  logger.finalize()
  return 0
}