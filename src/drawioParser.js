import fs from 'fs'
import { XMLParser, XMLBuilder, XMLValidator } from 'fast-xml-parser'
import { logger } from './logger.js'
import { split } from './utils.js'

const STYLE_PARAM_DELIMETER = ';'
const STYLE_VALUE_DELIMETER = '='
const ATTR_PREFIX = '@_'
const TAG_PREFIX = '_'
const CLASS_TAG = TAG_PREFIX + 'класс'
const ATTR_TAG = TAG_PREFIX + 'атрибут'

const ATTR = {
  ID: 'id',
  PARENT: 'parent',
  TAGS: 'tags',
  STYLE: 'style',
  VALUE: 'value',
  LABEL: 'label',
  EN: 'EN',
  SOURCE: 'source',
  TARGET: 'target',
  COPY: TAG_PREFIX + 'копия',
  NULLABLE: 'NULLABLE',
  DATA_LENGTH: 'DATA_LENGTH',
  DATA_PRECISION: 'DATA_PRECISION',
  DATA_TYPE: 'DATA_TYPE',
  REF: 'Ref',
  REF_TO_CLASS: 'REF_TO_CLASS',
  REF_TO_ATTRIBUTE: 'REF_TO_ATTRIBUTE'
}

const usefulAttr = new Set(Object.values(ATTR))

const parseStyle = (styleAsString) => (
  styleAsString.split(STYLE_PARAM_DELIMETER).map(item => {
    const [param, value] = item.split(STYLE_VALUE_DELIMETER)
    return { param, value }
  })
)

const parseXml = (xmlAsString) => new XMLParser({ ignoreAttributes: false }).parse(xmlAsString)

const getAttr = (value) => value.startsWith(ATTR_PREFIX) ? value.slice(ATTR_PREFIX.length) : undefined

const isUsefulAttr = (attr) => usefulAttr.has(attr)

const parseObjects = (parsedXmlTree) => {
  const mxGraphModel = parsedXmlTree.mxfile.diagram.mxGraphModel  
  const parseTreeNode = (treeNode, acc) => {
    Object.entries(treeNode).forEach(([key, value]) => {
      const attr = getAttr(key)
      if (attr === undefined) {
        if (value instanceof Array) {
          value.forEach(item => parseTreeNode(item, acc))
        } else {
          parseTreeNode(value, acc)
        }
      } else {
        if (isUsefulAttr(attr)) {
          acc[attr] = attr === ATTR.STYLE ? parseStyle(value) : value ? value.trim() : value
        } else if (attr.toLocaleUpperCase() === attr) {
          // для имен таблиц указанных в полях в объектах стрелочах
          acc[ATTR.REF_TO_CLASS] = attr
          acc[ATTR.REF_TO_ATTRIBUTE] = value ? value.trim() : value
        }
      }
    })
    return acc
  }

  const parseListOfTrees = (list) => list.map(item => parseTreeNode(item, {}))
    
  let parsedCells = parseListOfTrees(mxGraphModel.root.mxCell)
  let parsedObjects = parseListOfTrees(mxGraphModel.root.object)
    .concat(parseListOfTrees(mxGraphModel.root.UserObject))

  // Ищем копии классов, запоминаем на что они ссылались и удаляем их
  const { filtered, originalId, usedIn } = parsedObjects.reduce((acc, item) => {
    item[ATTR.COPY] ? { ...acc, [item[ATTR.ID]]: { originalId: item[ATTR.COPY], parentOfCopy: item[ATTR.PARENT] } } : acc
    if (item[ATTR.COPY]) {
      acc.originalId[item[ATTR.ID]] = item[ATTR.COPY]
      acc.usedIn[item[ATTR.COPY]] = (acc.usedIn[item[ATTR.COPY]] || []).concat(item[ATTR.PARENT])
    } else {
      acc.filtered.push(item)
    }
    return acc
  }, { filtered: [], originalId: {}, usedIn: {} })
  parsedObjects = filtered;

  // Везде заменяем ссылки на копии ссылками на оригинальные классы, а также где использовалась копия (в каких группах\фичах)
  [...parsedCells, ...parsedObjects].forEach(item => {
    [ATTR.PARENT, ATTR.SOURCE, ATTR.TARGET].forEach(key => {
      if (originalId[item[key]]) {
        item[key] = originalId[item[key]] || item[key]
      }
    })
    if (usedIn[item[ATTR.ID]]) {
      item.usedIn = usedIn[item[ATTR.ID]]
    }
  })

  const [classes, _rest] = split(parsedObjects, (item) => item.tags === CLASS_TAG)
  let [attributes, restObjects] = split(_rest, (item) => item.tags === ATTR_TAG)

  if (restObjects.length > 0) {
    // logger.warning('При парсинге диаграммы остались неучтенные объекты, хотя на результат это может не повлиять:')
    // logger.write(JSON.stringify(restObjects))
    // logger.write('')
  }

  // Исключаем промежуточные связи между атрибутами и классами
  const classesById = classes.reduce((acc, item) => (
    acc[item[ATTR.ID]] = item, acc
  ), {})
  const allObjectsById = {
    ...classesById, 
    ...[...attributes, ...restObjects].reduce((acc, item) => (
      acc[item[ATTR.ID]] = item, acc
    ), {})
  }

  const getParentClass = (element, objects, mediators) => {
    const parent = objects[element[ATTR.PARENT]]
    if (parent) {
      if (parent[ATTR.TAGS] === CLASS_TAG) {
        return [parent, mediators]
      } else {
        return getParentClass(parent, objects, mediators.concat(parent))
      }
    } else {
      return [element, mediators]
    }
  }

  const allMediatorIds = new Set()

  attributes.forEach(item => {
    const [parentClass, mediators] = getParentClass(item, allObjectsById, [])
    if (parentClass[ATTR.ID] !== item[ATTR.ID] && parentClass[ATTR.ID] !== item[ATTR.PARENT] && parentClass[ATTR.TAGS] === CLASS_TAG) {
      item[ATTR.PARENT] = parentClass[ATTR.ID]
      mediators.forEach((mediator) => allMediatorIds.add(mediator[ATTR.ID]))
    }

    const classObject = classesById[item[ATTR.PARENT]]
    if (classObject) {
      classObject.attributes = (classObject.attributes || []).concat(item)
      item.parentObject = classObject
    } else {
      logger.error(`Не найден класс на который ссылается атрибут "${item[ATTR.LABEL]}"\n`)
    }
  })

  restObjects = restObjects.filter(item => !allMediatorIds.has(item[ATTR.ID]))

  const relations = [...parsedCells, ...restObjects].reduce((acc, { id, parent, source, target, style, ...rest }) => {
    if (style) {
      const endArrow = style.find(({ param }) => param === 'endArrow')?.value
      const startArrow = style.find(({ param }) => param === 'startArrow')?.value
      if (endArrow || startArrow) {
        console.log(startArrow, endArrow)
        acc.push({
          source: { id: source, type: startArrow, object: allObjectsById[source] },
          target: { id: target, type: endArrow, object: allObjectsById[target] },
          refAttribute: rest[ATTR.REF],
          refToClass: rest[ATTR.REF_TO_CLASS],
          refToAttribute: rest[ATTR.REF_TO_ATTRIBUTE],
        })
      }
    }
    return acc
  }, [])

  return {
    relations,
    classes: classes.filter(({ EN, label }) => {
      if (!EN) {
        logger.error(`Класс "${label}" не имеет идентификатора (свойство EN пустое), таблица не будет добавлена\n`)
      }
      return EN
    })
  }

}

export const parseDiagramFromFile = (filepath) => {
  const buffer = fs.readFileSync(filepath)
  const fileContent = buffer.toString()
  return parseObjects(parseXml(fileContent))
}
